import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import {
  FIDELITY_BLOCKERS,
  countExtractionItems,
  formatAbstainMessage,
  reconcileExtractionFidelity,
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

test('V_f/N >= 0.40 on partial → low', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(10, 5)) }, // 0.50
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.highNonVerbatim));
});

test('low legibility + non-verbatim → at least medium', () => {
  const model = baseModel({
    activities: { content: groups([item('A', false), item('B', true), item('C', true)]) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionStatus, 'partial');
  assert.ok(
    model.extractionConfidence === 'medium' || model.extractionConfidence === 'low'
  );
});

test('L + high non-verbatim share → low', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(8, 3)) }, // 0.375 >= 0.25
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.some(b => /low-resolution/i.test(b)));
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
});

test('never downgrade partial → ok when signals clear', () => {
  const model = baseModel({
    extractionStatus: 'partial',
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(shouldSoftGateCodingExport(model), true);
});

test('no content → partial + low + blocker', () => {
  const model = baseModel();
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noContent));
});

test('shouldSoftGateCodingExport true for low even if status ok', () => {
  const model = baseModel({
    extractionStatus: 'ok',
    extractionConfidence: 'low',
    activities: { content: groups(manyItems(3, 0)) },
  });
  assert.equal(shouldSoftGateCodingExport(model), true);
});

test('formatAbstainMessage', () => {
  assert.match(formatAbstainMessage([]), /abstained/i);
  assert.match(formatAbstainMessage(['Illegible grid']), /Illegible grid/);
});

test('countExtractionItems includes unmapped', () => {
  const model = baseModel({
    activities: { content: groups([item('a', true)]) },
    unmapped: { content: groups([item('b', false)], 'Other') },
  });
  assert.deepEqual(countExtractionItems(model), { total: 2, nonVerbatim: 1 });
});
