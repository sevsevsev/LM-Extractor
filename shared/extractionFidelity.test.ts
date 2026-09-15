import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import {
  FIDELITY_BLOCKERS,
  countExtractionItems,
  formatHardStopMessage,
  reconcileExtractionFidelity,
  shouldHardStopExtraction,
  shouldShowFidelityBanner,
  shouldSoftGateCodingExport,
} from './extractionFidelity.js';

function item(text: string, verbatim?: boolean): LogicModelItem {
  return verbatim === undefined ? { text } : { text, verbatim };
}

function groups(items: LogicModelItem[], name = 'General'): LogicModelGroup[] {
  return [{ name, items }];
}

function baseModel(overrides: Partial<LogicModel> = {}): LogicModel {
  const empty = { content: [] as LogicModelGroup[] };
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: empty,
    activities: empty,
    outputs: empty,
    shortTermOutcomes: empty,
    mediumTermOutcomes: empty,
    longTermOutcomes: empty,
    impact: empty,
    layoutFamily: 'vertical_columns',
    ...overrides,
  };
}

function manyItems(n: number, nonVerbatim: number): LogicModelItem[] {
  const items: LogicModelItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push(item(`Item ${i}`, i < nonVerbatim ? false : true));
  }
  return items;
}

test('ok + few non-verbatim → high', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'ok');
  assert.equal(model.extractionConfidence, 'high');
  assert.equal(shouldShowFidelityBanner(model), false);
  assert.equal(shouldSoftGateCodingExport(model), false);
});

test('V_f/N >= 0.15 upgrades ok → partial and medium', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(10, 2)) }, // 0.20
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.nonVerbatimShare));
  assert.equal(shouldSoftGateCodingExport(model), true);
  assert.equal(shouldShowFidelityBanner(model), true);
});

test('V_f/N >= 0.40 on partial → low hard-stop', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(10, 5)) }, // 0.50
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.highNonVerbatim));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('small low-legibility extract with non-verbatim → low hard-stop', () => {
  const model = baseModel({
    activities: { content: groups([item('A', false), item('B', true), item('C', true)]) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.equal(shouldHardStopExtraction(model), true);
});

test('L + high non-verbatim share → low', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(8, 3)) }, // 0.375 >= 0.25
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.some(b => /low-resolution|dense grid/i.test(b)));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('mismatch true → partial upgrade + medium', () => {
  // N>=8 and U/N >= 0.30
  const mapped = manyItems(6, 0);
  const unmapped = manyItems(4, 0);
  const model = baseModel({
    activities: { content: groups(mapped) },
    unmapped: {
      content: [
        { name: 'Assumptions', items: unmapped.slice(0, 2) },
        { name: 'External Factors', items: unmapped.slice(2) },
      ],
    },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.ok(
    model.extractionConfidence === 'medium' || model.extractionConfidence === 'low'
  );
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.mismatch));
});

test('unknown layoutFamily upgrades ok → partial', () => {
  const model = baseModel({
    layoutFamily: 'unknown',
    activities: { content: groups(manyItems(6, 0)) },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.unknownLayout));
});

test('abstained sticky with low confidence', () => {
  const model = baseModel({
    extractionStatus: 'abstained',
    extractionBlockers: ['Not a logic model'],
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'abstained');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.abstained));
  assert.ok(model.extractionBlockers?.includes('Not a logic model'));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('never downgrade partial → ok when signals clear', () => {
  const model = baseModel({
    extractionStatus: 'partial',
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(shouldSoftGateCodingExport(model), true);
  assert.equal(shouldHardStopExtraction(model), false);
});

test('no content → partial + low + blocker', () => {
  const model = baseModel();
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noContent));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('shouldHardStopExtraction on low even if status ok', () => {
  const model = baseModel({
    extractionStatus: 'ok',
    extractionConfidence: 'low',
    activities: { content: groups(manyItems(3, 0)) },
  });
  assert.equal(shouldHardStopExtraction(model), true);
  assert.equal(shouldSoftGateCodingExport(model), false);
});

test('dense low-legibility grid forces low even when all verbatim (Oxford-class)', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(10, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.lowLegibilityDense));
  assert.equal(shouldHardStopExtraction(model), true);
  assert.equal(shouldShowFidelityBanner(model), false); // never reaches editor
});

test('formatHardStopMessage', () => {
  assert.match(formatHardStopMessage([]), /stopped/i);
  assert.match(formatHardStopMessage(['Illegible grid']), /Illegible grid/);
});

test('countExtractionItems includes unmapped', () => {
  const model = baseModel({
    activities: { content: groups([item('a', true)]) },
    unmapped: { content: groups([item('b', false)], 'Other') },
  });
  assert.deepEqual(countExtractionItems(model), { total: 2, nonVerbatim: 1 });
});

test('possiblyIncomplete alone upgrades ok -> partial and confidence to medium (never low)', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(3, 0)) },
  });
  const sourceText = Array.from({ length: 20 }, (_, i) => `- Bullet item ${i}`).join('\n');
  reconcileExtractionFidelity(model, { sourceText });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.possiblyIncomplete));
  assert.equal(shouldHardStopExtraction(model), false);
});

test('possiblyIncomplete does not fire when extraction matches the source reasonably well', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(9, 0)) },
  });
  const sourceText = Array.from({ length: 10 }, (_, i) => `- Bullet item ${i}`).join('\n');
  reconcileExtractionFidelity(model, { sourceText });
  assert.equal(model.extractionStatus, 'ok');
  assert.equal(model.extractionConfidence, 'high');
  assert.ok(!model.extractionBlockers?.includes(FIDELITY_BLOCKERS.possiblyIncomplete));
});

test('possiblyIncomplete without page markers (e.g. DOCX Track A) sets no possiblyMissedRegions', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(3, 0)) },
  });
  const sourceText = Array.from({ length: 20 }, (_, i) => `- Bullet item ${i}`).join('\n');
  reconcileExtractionFidelity(model, { sourceText });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.possiblyMissedRegions, undefined);
});

test('possiblyIncomplete with page markers points at the gappiest page', () => {
  const items: LogicModelItem[] = [
    { text: 'Item 1', sourcePage: 1 },
    { text: 'Item 2', sourcePage: 1 },
  ];
  const model = baseModel({ activities: { content: groups(items) } });
  const page1 = Array.from({ length: 3 }, (_, i) => `- Page 1 bullet ${i}`).join('\n');
  const page2 = Array.from({ length: 10 }, (_, i) => `- Page 2 bullet ${i}`).join('\n');
  const sourceText = `## Page 1\n\n${page1}\n\n## Page 2\n\n${page2}`;
  reconcileExtractionFidelity(model, { sourceText });
  assert.equal(model.extractionStatus, 'partial');
  assert.deepEqual(model.possiblyMissedRegions, [{ page: 2, note: FIDELITY_BLOCKERS.possiblyIncomplete }]);
});

test('Gemini-reported possiblyMissedRegions are normalized, deduped, and merged with heuristic pages', () => {
  const items: LogicModelItem[] = [{ text: 'Item 1', sourcePage: 1 }];
  const model = baseModel({
    activities: { content: groups(items) },
    possiblyMissedRegions: [
      { page: 2, xStart: 0.1, xEnd: 0.3, note: 'Left column looks cut off' },
      { page: 0, note: 'invalid page, must be dropped' },
      { page: 2, xStart: 0.1, xEnd: 0.3, note: 'duplicate of the first entry, must be deduped' },
      { page: 3, xStart: 0.5, xEnd: 0.2, note: 'invalid span (end before start), span must be dropped' },
    ],
  });
  const page2 = Array.from({ length: 8 }, (_, i) => `- Page 2 bullet ${i}`).join('\n');
  const sourceText = `## Page 1\n\n- one\n\n## Page 2\n\n${page2}`;
  reconcileExtractionFidelity(model, { sourceText });
  assert.equal(model.extractionStatus, 'partial');
  // Gemini already covered page 2 — the heuristic's own page-2 entry is not added on top of it.
  assert.deepEqual(model.possiblyMissedRegions, [
    { page: 2, xStart: 0.1, xEnd: 0.3, note: 'Left column looks cut off' },
    { page: 3, note: 'invalid span (end before start), span must be dropped' },
  ]);
});
