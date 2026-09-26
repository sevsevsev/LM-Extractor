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
import type { LogicModel, LogicModelGroup } from '../types.ts';

const documentsDir = path.resolve(import.meta.dirname, '..', 'fixtures', 'benchmark', 'documents');

function loadAll(): BenchmarkDocument[] {
  return readdirSync(documentsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => parseBenchmarkDocument(JSON.parse(readFileSync(path.join(documentsDir, f), 'utf8')), f));
}

/** Build the extraction a perfect run would produce, straight from the spec. */
function perfectExtraction(doc: BenchmarkDocument): LogicModel {
  const model: Record<string, { content: LogicModelGroup[] }> = {};
  for (const domain of SCORED_DOMAINS) model[domain] = { content: [] };
  for (const slide of doc.slides) {
    for (const column of slide.columns) {
      if (column.domain === null) continue;
      model[column.domain].content.push({ name: column.heading, items: column.items.map(text => ({ text })) });
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
