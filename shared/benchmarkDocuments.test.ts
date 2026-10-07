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
        // prose paragraph) and a column expected in `unmapped` (a restated pass) never reach the
        // splitter however their sentences are punctuated.
        if (column.domain === null || column.domain === 'unmapped') continue;
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
  const columns = doc.slides.flatMap(s => s.columns);
  const headed = columns.filter(c => c.domain !== null && c.domain !== 'unmapped' && c.heading);
  const headerless = columns.filter(c => c.domain === 'unmapped' && !c.heading);
  assert.ok(headed.length >= 5, 'the first pass is a headed grid, expected in the columns');
  assert.ok(headerless.length >= 5, 'the restating pass prints no headings at all');
  // Both passes are expected somewhere, so dropping either still shows up as lost recall — the
  // restatement is set aside in `unmapped`, not defined away.
  const golden = goldenFromDocument(doc);
  const expected = Object.values(golden.items).flat();
  assert.equal(expected.length, headed.concat(headerless).reduce((n, c) => n + c.items.length, 0));
  assert.equal(
    golden.items.unmapped?.length,
    headerless.reduce((n, c) => n + c.items.length, 0),
    'every item of the restating pass is expected in unmapped'
  );
});

/**
 * The owner's 2026-09-28 decision, written down where a run is graded against it: a programme
 * printed twice reaches the reader once. Before this, both documents that print a second pass
 * expected it in the grid columns, so a run that set the restatement aside — the behaviour he
 * chose — scored as a failure, and a run that mapped it in scored as a pass. Two captures of
 * `two-templates-one-content` from byte-identical input did one each.
 */
test('a restated pass is expected in unmapped, never a second time in the columns', () => {
  const ids = ['two-templates-one-content', 'two-versions-one-model'];
  for (const id of ids) {
    const doc = loadAll().find(d => d.id === id);
    assert.ok(doc, `${id} must stay in the set`);
    const golden = goldenFromDocument(doc);
    const restated = golden.items.unmapped ?? [];
    assert.ok(restated.length >= 5, `${id}: its restating pass is what the document is for`);
    const grid = SCORED_DOMAINS.filter(d => d !== 'unmapped').flatMap(d => golden.items[d] ?? []);
    assert.ok(grid.length >= 5, `${id}: the first pass is still expected in the columns`);
    for (const item of restated) {
      assert.ok(!grid.includes(item), `${id}: "${item}" cannot be expected in two places at once`);
    }
  }
});

/**
 * Written after prompt `2026-09-28.1` was shown, by a same-bundle control arm, to cost unmapped
 * content on two real documents with no second printing at all — a reference list and an
 * organisation's own self-description stopped arriving. The benchmark scored 100% throughout,
 * because no document in it expected enough unmapped content to lose.
 *
 * It does NOT reproduce that failure: measured on both prompts, it scores 100% on the one that
 * loses the real documents' sections as well as on the one that keeps them. So whatever drives the
 * real loss is not a headed section and a long list on their own, and this document is not a guard
 * against that regression — saying otherwise in a later change would be false. What it does pin is
 * the expectation nothing else in the set carried: a headed non-standard section belongs in
 * `unmapped` IN FULL, so a change that truncates one is lost recall rather than a clean sheet.
 */
test('the set prints long headed sections that belong in unmapped and nowhere else', () => {
  const doc = loadAll().find(d => d.id === 'headed-sections-no-restatement');
  assert.ok(doc, 'headed-sections-no-restatement must stay in the set');
  const golden = goldenFromDocument(doc);
  const unmapped = golden.items.unmapped ?? [];
  assert.ok(unmapped.length >= 10, 'a short section could be lost without moving the number much');
  const headed = doc.slides.flatMap(s => s.columns).filter(c => c.domain === 'unmapped');
  assert.ok(headed.length >= 2, 'two sections, so one surviving does not hide the other');
  for (const column of headed) assert.ok(column.heading, 'these sections are headed, not loose prose');
  // No second printing anywhere: the restatement rule must have nothing to act on here.
  const grid = SCORED_DOMAINS.filter(d => d !== 'unmapped').flatMap(d => golden.items[d] ?? []);
  assert.equal(new Set(grid).size, grid.length, 'the grid prints each item once');
  for (const item of unmapped) {
    assert.ok(!grid.includes(item), `${item} is a section entry, not a restated grid item`);
  }
});

test('a column can mix cells that split with cells that must survive whole', () => {
  const doc = loadAll().find(d => d.id === 'mixed-separators');
  assert.ok(doc, 'mixed-separators must stay in the set');
  const mixed = doc.slides[0].columns.filter(
    c => Object.keys(c.splits ?? {}).length > 0 && c.items.some(i => !(c.splits ?? {})[i])
  );
  assert.ok(mixed.length >= 3, 'the point is both kinds side by side, not one shape per column');
});

/**
 * Written on 2026-10-07, after a request-parameter change (PR #36, reverted by #37) was proven by a
 * paired same-bundle run to rewrite a real document's one-word activity labels into four-to-nine
 * word phrases, losing all ten while the item count held at 33. The benchmark passed that change at
 * 100%, because the shortest activities column in the set was four words at its shortest and the
 * only one-word cells anywhere were a budget's cost centres, which are not expected in a column at
 * all. The benchmark was not wrong, it was blind.
 *
 * This document is the eye. It is deliberately scored as well as declared: the second half asserts
 * that paraphrasing its cells actually COSTS recall, so the document cannot be weakened into
 * something that merely looks like a guard. An item count is held equal across both arms to show
 * why nothing counting items could have caught this.
 */
test('the set prints an activities column of one- and two-word cells', () => {
  const doc = loadAll().find(d => d.id === 'terse-activity-labels');
  assert.ok(doc, 'terse-activity-labels must stay in the set');
  const activities = doc.slides[0].columns.find(c => c.domain === 'activities');
  assert.ok(activities, 'its activities column is the point of the document');
  const words = activities.items.map(i => i.split(/\s+/).length).sort((a, b) => a - b);
  assert.ok(words.filter(n => n === 1).length >= 5, `five single-word cells at least, got ${words}`);
  assert.ok(words.every(n => n <= 2), `every cell one or two words, got ${words}`);
  // Expected as items, not set aside as labels — a label would be unscored and lose nothing.
  const expected = goldenFromDocument(doc).items.activities ?? [];
  assert.equal(expected.length, activities.items.length);
});

test('paraphrasing the terse cells costs recall even when the item count holds', () => {
  const doc = loadAll().find(d => d.id === 'terse-activity-labels');
  assert.ok(doc, 'terse-activity-labels must stay in the set');
  const golden = goldenFromDocument(doc);
  const sourceText = documentTextTrack(doc);

  const perfect = scoreExtraction(golden, perfectExtraction(doc), { sourceText });
  assert.equal(perfect.recall, 1, 'the document must be scoreable before it is useful');

  // The observed failure: each terse cell comes back as a descriptive phrase built around it.
  const paraphrased = perfectExtraction(doc);
  for (const group of (paraphrased.activities as { content: LogicModelGroup[] }).content) {
    group.items = (group.items ?? []).map(item => ({
      ...item,
      text: `Weekly ${String(item.text).toLowerCase()} sessions for young people`,
    }));
  }
  const expanded = scoreExtraction(golden, paraphrased, { sourceText });

  assert.equal(expanded.actualCount, perfect.actualCount, 'the count is identical — that is the point');
  assert.ok(expanded.recall < 0.6, `expansion must cost recall, got ${expanded.recall}`);
  const lostActivities = expanded.misses.filter(m => m.domain === 'activities');
  assert.equal(lostActivities.length, (golden.items.activities ?? []).length, 'every terse cell is lost');
});

/**
 * The other half of 2026-10-07's lesson. PR #36 also cost a real review document eleven of its
 * items, every one of them in `unmapped`, and the benchmark could not see that either: a document
 * that expects no grid items scores `recall` 1 unconditionally, because there is nothing in the
 * expected answer to miss. `not-a-logic-model` and `assessment-report-third-party` are both that
 * shape, so a run returning a completely empty extraction scores a clean sheet on both — asserted
 * below, because it is the blindness this document exists to close rather than a thing to fix in
 * the scorer. Expecting the content in `unmapped` is the owner's 2026-09-28 decision written where
 * a run is graded against it: a review document fills no column and still loses nothing.
 */
test('a review document expects its content in unmapped, so losing it is lost recall', () => {
  const doc = loadAll().find(d => d.id === 'evaluator-report-content-preserved');
  assert.ok(doc, 'evaluator-report-content-preserved must stay in the set');
  const golden = goldenFromDocument(doc);
  const sourceText = documentTextTrack(doc);

  const grid = SCORED_DOMAINS.filter(d => d !== 'unmapped').flatMap(d => golden.items[d] ?? []);
  assert.equal(grid.length, 0, 'nothing in this document belongs in a column');
  assert.ok((golden.items.unmapped ?? []).length >= 10, 'a short document could be lost unnoticed');

  const empty = () => {
    const model: Record<string, { content: LogicModelGroup[] }> = {};
    for (const domain of SCORED_DOMAINS) model[domain] = { content: [] };
    return { organization: '', program: '', documentTypeAssessment: 'not_logic_model', ...model } as unknown as LogicModel;
  };

  assert.equal(scoreExtraction(golden, empty(), { sourceText }).recall, 0, 'returning nothing is total loss');

  // The pair already in the set, scored the same way: both give an empty run a perfect recall.
  for (const id of ['not-a-logic-model', 'assessment-report-third-party']) {
    const other = loadAll().find(d => d.id === id);
    assert.ok(other, `${id} must stay in the set`);
    const score = scoreExtraction(goldenFromDocument(other), empty(), {
      sourceText: documentTextTrack(other),
    });
    assert.equal(score.recall, 1, `${id} cannot see content loss — that is why the document above exists`);
  }
});
