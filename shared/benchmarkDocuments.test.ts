import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  documentItemCount,
  documentTextTrack,
  goldenFromDocument,
  parseBenchmarkDocument,
  type BenchmarkDocument,
} from './benchmarkDocuments.ts';
import { appearsInSource, normalizeForMatch, scoreExtraction, SCORED_DOMAINS } from './extractionScore.ts';
import { splitRunOnCell } from './listItemSplit.ts';
import type { LogicModel, LogicModelGroup } from '../types.ts';

const documentsDir = path.resolve(import.meta.dirname, '..', 'fixtures', 'benchmark', 'documents');

function loadAll(): BenchmarkDocument[] {
  return readdirSync(documentsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => parseBenchmarkDocument(JSON.parse(readFileSync(path.join(documentsDir, f), 'utf8')), f));
}

/**
 * Build the extraction a perfect run would produce, straight from the spec. `asPrinted` builds the
 * cells exactly as the slide prints them instead, which is what the pipeline sees BEFORE
 * `shared/listItemSplit.ts` runs — the two differ only on a document with run-on cells.
 */
function perfectExtraction(doc: BenchmarkDocument, asPrinted = false): LogicModel {
  const model: Record<string, { content: LogicModelGroup[] }> = {};
  for (const domain of SCORED_DOMAINS) model[domain] = { content: [] };
  for (const slide of doc.slides) {
    for (const column of slide.columns) {
      if (column.domain === null) continue;
      const texts = asPrinted
        ? column.items
        : column.items.flatMap(item => column.splits?.[item] ?? [item]);
      model[column.domain].content.push({ name: column.heading, items: texts.map(text => ({ text })) });
    }
  }
  return {
    organization: doc.organization ?? '',
    program: doc.program ?? '',
    mission: { content: '' },
    targetPopulation: { content: '' },
    documentTypeAssessment: doc.documentTypeAssessment ?? 'logic_model',
    ...model,
  } as unknown as LogicModel;
}

test('every committed benchmark document parses and declares what it covers', () => {
  const docs = loadAll();
  assert.ok(docs.length >= 6, `expected a set, found ${docs.length}`);
  for (const doc of docs) {
    assert.ok(doc.covers && doc.covers.length > 40, `${doc.id} must say what failure mode it covers`);
    assert.ok(doc.label, `${doc.id} needs a label`);
    assert.ok(documentItemCount(doc) > 0, `${doc.id} prints nothing`);
  }
});

test('document ids are unique and match their filenames', () => {
  const files = readdirSync(documentsDir).filter(f => f.endsWith('.json'));
  const ids = new Set<string>();
  for (const file of files) {
    const doc = parseBenchmarkDocument(JSON.parse(readFileSync(path.join(documentsDir, file), 'utf8')), file);
    assert.equal(`${doc.id}.json`, file);
    assert.ok(!ids.has(doc.id), `duplicate id ${doc.id}`);
    ids.add(doc.id);
  }
});

/**
 * The scorer must score a correct extraction as correct. Without this the benchmark could report a
 * failure that is really a bug in the measuring instrument — the mistake this project has made
 * three times with weaker probes (see scripts/audit-coverage.mjs).
 */
test('a perfect extraction of every benchmark document scores 100% on every axis', () => {
  for (const doc of loadAll()) {
    const score = scoreExtraction(goldenFromDocument(doc), perfectExtraction(doc), {
      sourceText: documentTextTrack(doc),
    });
    assert.equal(score.recall, 1, `${doc.id} recall`);
    assert.equal(score.precision, 1, `${doc.id} precision`);
    assert.equal(score.placement, 1, `${doc.id} placement`);
    assert.equal(score.unsourced, 0, `${doc.id} unsourced`);
    assert.equal(score.documentTypeMismatch, undefined, `${doc.id} document type`);
  }
});

test('every expected item is findable in the document text the deck is built from', () => {
  for (const doc of loadAll()) {
    const source = normalizeForMatch(documentTextTrack(doc));
    for (const list of Object.values(goldenFromDocument(doc).items)) {
      for (const item of list ?? []) {
        assert.ok(appearsInSource(item, source), `${doc.id}: "${item}" is expected but not printed`);
      }
    }
  }
});

test('no benchmark document names a real organisation from the project files', () => {
  // The benchmark is committed; every real logic model in this project is a client document. The
  // guard is crude on purpose — it catches a paste, which is how a real name would get in here.
  const forbidden = [
    'musicopia', 'harlem lacrosse', 'seamaac', 'philadelphia ballet', 'oxford circle',
    'healthy newsworks', 'cub reporter', 'trinity', 'rock school', 'ymca', 'achieve now',
    'designphiladelphia', 'a new dawn', 'performance garage', 'firsthand', 'upenn', 'bioeyes',
    'art thru youth', 'eureka',
  ];
  for (const doc of loadAll()) {
    const haystack = JSON.stringify(doc).toLowerCase();
    for (const name of forbidden) {
      assert.ok(!haystack.includes(name), `${doc.id} contains "${name}" — benchmark documents must be invented`);
    }
  }
});

test('the derived text track prints slide markers the page-coverage check can read', () => {
  const doc = loadAll().find(d => d.slides.length > 1);
  assert.ok(doc, 'the set needs at least one multi-slide document');
  assert.match(documentTextTrack(doc), /## Slide 1/);
  assert.match(documentTextTrack(doc), /## Slide 2/);
});

test('an in-column group heading is tolerated, not expected as an item', () => {
  const golden = goldenFromDocument({
    id: 'x', label: 'x', covers: 'x',
    slides: [{ title: 'T', columns: [{
      heading: 'ACTIVITIES', domain: 'activities',
      items: ['Youth Outcomes', 'Saturday football coaching'], labels: ['Youth Outcomes'],
    }] }],
  });
  assert.deepEqual(golden.items.activities, ['Saturday football coaching']);
  assert.ok(golden.tolerated?.includes('Youth Outcomes'));
});

test('a non-grid column is tolerated rather than expected anywhere', () => {
  const golden = goldenFromDocument({
    id: 'x', label: 'x', covers: 'x',
    slides: [{ title: 'T', columns: [{ heading: 'BUDGET', domain: null, items: ['14,200'] }] }],
  });
  assert.deepEqual(golden.items, {});
  assert.ok(golden.tolerated?.includes('14,200'));
});

test('a run-on cell is printed whole and expected as its parts', () => {
  const golden = goldenFromDocument({
    id: 'x', label: 'x', covers: 'x',
    slides: [{ title: 'T', columns: [{
      heading: 'INPUTS', domain: 'inputs',
      items: ['Staff time; room hire; a minibus', 'Grant funding'],
      splits: { 'Staff time; room hire; a minibus': ['Staff time', 'room hire', 'a minibus'] },
    }] }],
  });
  assert.deepEqual(golden.items.inputs, ['Staff time', 'room hire', 'a minibus', 'Grant funding']);
});

test('a splits entry must name a printed cell and cut only its own words', () => {
  const column = (splits: Record<string, string[]>) => ({
    id: 'x', label: 'x', covers: 'x',
    slides: [{ title: 'T', columns: [{ heading: 'INPUTS', domain: 'inputs', items: ['a; b'], splits }] }],
  });
  assert.throws(() => parseBenchmarkDocument(column({ 'c; d': ['c', 'd'] }), 'spec'), /not printed/);
  assert.throws(() => parseBenchmarkDocument(column({ 'a; b': ['a', 'z'] }), 'spec'), /not a substring/);
});

/**
 * The tie between the spec and the splitter. A spec declares what a run-on cell SHOULD become;
 * `shared/listItemSplit.ts` is what makes it so. If either moves without the other, the benchmark
 * would quietly start grading against an answer the pipeline can no longer reach — so both are
 * checked against every committed spec here, with no key and no Gemini call.
 */
test('the splitter produces exactly the parts every committed spec declares', () => {
  for (const doc of loadAll()) {
    for (const slide of doc.slides) {
      for (const column of slide.columns) {
        // `splitRunOnItems` walks the grid domains only, so a non-grid column (a budget line, a
        // prose paragraph) never reaches the splitter however its sentences are punctuated.
        if (column.domain === null) continue;
        for (const item of column.items) {
          const declared = column.splits?.[item] ?? null;
          assert.deepEqual(
            splitRunOnCell(item),
            declared,
            `${doc.id} / ${column.heading}: ${item}`
          );
        }
      }
    }
  }
});

test('the set exercises a run-on cell at all', () => {
  const declared = loadAll()
    .flatMap(d => d.slides.flatMap(s => s.columns.flatMap(c => Object.keys(c.splits ?? {}))));
  assert.ok(declared.length >= 4, 'no committed spec prints a run-on cell');
});

/**
 * The benchmark could only ever catch a regression while every document scored 100%. This is the
 * first document in the set that a correct-but-unsplit pipeline gets WRONG, so the number can now
 * move upward as well as down.
 */
test('leaving run-on cells whole costs recall on the document written to catch it', () => {
  const doc = loadAll().find(d => d.id === 'run-on-cells');
  assert.ok(doc, 'run-on-cells must stay in the set');
  const golden = goldenFromDocument(doc);
  const sourceText = documentTextTrack(doc);
  const asPrinted = scoreExtraction(golden, perfectExtraction(doc, true), { sourceText });
  const split = scoreExtraction(golden, perfectExtraction(doc), { sourceText });
  assert.ok(asPrinted.recall < 0.75, `unsplit recall should be poor, got ${asPrinted.recall}`);
  assert.equal(split.recall, 1);
});

/**
 * The set's hard shapes, asserted so they cannot be weakened by editing a spec. Each names the
 * real failure it stands in for; a document that stops exercising it should be replaced, not
 * quietly flattened.
 */
test('the set prints a column nested two heading levels deep', () => {
  const doc = loadAll().find(d => d.id === 'nested-outcome-sections');
  assert.ok(doc, 'nested-outcome-sections must stay in the set');
  const outcomes = doc.slides[0].columns.find(c => c.domain === 'generalOutcomes');
  assert.ok(outcomes, 'its outcomes column is the point of the document');
  // A section, a sub-section under it, then the bullets: two levels above the item, which is one
  // more than the schema's Group.name can hold. Neither level is an expected item.
  assert.ok((outcomes.labels?.length ?? 0) >= 4, 'two heading levels means several labels');
  const expected = goldenFromDocument(doc).items.generalOutcomes ?? [];
  for (const label of outcomes.labels ?? []) {
    assert.ok(!expected.includes(label), `${label} is a heading, not an item`);
  }
  assert.ok(expected.length >= 6, 'the bullets under both levels are all expected');
});

test('the set prints one programme twice in two different templates', () => {
  const doc = loadAll().find(d => d.id === 'two-templates-one-content');
  assert.ok(doc, 'two-templates-one-content must stay in the set');
  const headed = doc.slides.flatMap(s => s.columns).filter(c => c.domain !== null && c.heading);
  const headerless = doc.slides.flatMap(s => s.columns).filter(c => c.domain !== null && !c.heading);
  assert.ok(headed.length >= 5, 'one pass is a headed grid');
  assert.ok(headerless.length >= 5, 'the other pass prints no headings at all');
  // Both passes are expected in full, so dropping either shows up as lost recall.
  const expected = Object.values(goldenFromDocument(doc).items).flat();
  assert.equal(expected.length, headed.concat(headerless).reduce((n, c) => n + c.items.length, 0));
});

test('a column can mix cells that split with cells that must survive whole', () => {
  const doc = loadAll().find(d => d.id === 'mixed-separators');
  assert.ok(doc, 'mixed-separators must stay in the set');
  const mixed = doc.slides[0].columns.filter(
    c => Object.keys(c.splits ?? {}).length > 0 && c.items.some(i => !(c.splits ?? {})[i])
  );
  assert.ok(mixed.length >= 3, 'the point is both kinds side by side, not one shape per column');
});
