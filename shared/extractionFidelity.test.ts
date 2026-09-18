import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import {
  FIDELITY_BLOCKERS,
  countExtractionItems,
  documentTypeFlagLabel,
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

// The client-side text-line-counting heuristic that used to live here (comparing candidate
// bullet/numbered lines in Track A against extracted item counts) was removed after auditing a
// real 112-file batch: hand-verifying 3 flagged documents against their source PDFs found it
// firing on wrapped multi-column table lines, numbered academic references, and legitimate
// secondary sections (evaluation frameworks, stat-tile infographics) — 3 for 3 false positives,
// driving the majority of that batch's "Needs Review" flags. Gemini's own per-image self-report
// (tested via `possiblyMissedRegions` on the model directly, below) is the only remaining source.
test('possiblyMissedRegions on the model (Gemini self-report) drives possiblyIncomplete; a model with none never flags on its own', () => {
  const clean = baseModel({ activities: { content: groups(manyItems(9, 0)) } });
  reconcileExtractionFidelity(clean);
  assert.equal(clean.extractionStatus, 'ok');
  assert.equal(clean.extractionConfidence, 'high');
  assert.ok(!clean.extractionBlockers?.includes(FIDELITY_BLOCKERS.possiblyIncomplete));

  const flagged = baseModel({
    activities: { content: groups(manyItems(9, 0)) },
    possiblyMissedRegions: [{ page: 1, note: 'A labeled box on this image was not transcribed' }],
  });
  reconcileExtractionFidelity(flagged);
  assert.equal(flagged.extractionStatus, 'partial');
  assert.equal(flagged.extractionConfidence, 'medium');
  assert.ok(flagged.extractionBlockers?.includes(FIDELITY_BLOCKERS.possiblyIncomplete));
  assert.equal(shouldHardStopExtraction(flagged), false);
});

test('documentTypeAssessment "not_logic_model" flags for review, never hard-stops', () => {
  const model = baseModel({
    documentTypeAssessment: 'not_logic_model',
    documentTypeNote: 'Reads as a Theory of Change narrative',
    mission: { content: 'Through sustained investment, ...' },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.some(b => /may not be a logic model/i.test(b)));
  assert.ok(model.extractionBlockers?.some(b => b.includes('Theory of Change narrative')));
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
  assert.equal(documentTypeFlagLabel(model), 'Possibly Not a Logic Model');
});

test('documentTypeAssessment "unclear" also flags for review', () => {
  const model = baseModel({
    documentTypeAssessment: 'unclear',
    mission: { content: 'Overview text' },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(documentTypeFlagLabel(model), 'Unclear Document Type');
});

test('documentTypeAssessment "logic_model" (or absent) never flags', () => {
  const clean = baseModel({
    documentTypeAssessment: 'logic_model',
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(clean);
  assert.equal(clean.extractionStatus, 'ok');
  assert.equal(documentTypeFlagLabel(clean), '');

  const absent = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(absent);
  assert.equal(absent.extractionStatus, 'ok');
  assert.equal(documentTypeFlagLabel(absent), '');
});

test('textOnlyFallback flags for review, never hard-stops, even with clean-looking content', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { textOnlyFallback: true });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.textOnlyFallback));
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
});

test('textOnlyFallback: false (or absent) never flags on its own', () => {
  const model = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(model, { textOnlyFallback: false });
  assert.equal(model.extractionStatus, 'ok');

  const absent = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(absent);
  assert.equal(absent.extractionStatus, 'ok');
});

test('zero grid items with recovered overview text flags for review instead of passing as ok/high', () => {
  // Real gap found via a 112-file batch run: hasRecoveredLogicModelContent() is satisfied by
  // mission/target/impact text alone, so a document that extracted zero inputs/activities/
  // outputs/outcomes items could previously report "Successfully Processed" / high confidence.
  const model = baseModel({
    mission: { content: 'A real mission statement was recovered.' },
    targetPopulation: { content: 'Youth in grades 6-12' },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noGridItems));
  assert.equal(shouldHardStopExtraction(model), false);
});

test('a genuinely empty result (no overview text either) still gets the stricter noContent treatment', () => {
  const model = baseModel();
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noContent));
  assert.ok(!model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noGridItems));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('Gemini-reported possiblyMissedRegions are normalized and deduped', () => {
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
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.deepEqual(model.possiblyMissedRegions, [
    { page: 2, xStart: 0.1, xEnd: 0.3, note: 'Left column looks cut off' },
    { page: 3, note: 'invalid span (end before start), span must be dropped' },
  ]);
});
