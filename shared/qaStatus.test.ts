import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel } from '../types.ts';
import { needsQaReview, qaStatusLabel } from './qaStatus.ts';

function baseModel(overrides: Partial<LogicModel> = {}): LogicModel {
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: 'Students' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    impact: { content: [] },
    ...overrides,
  };
}

test('a clean extraction needs no QA review', () => {
  const model = baseModel();
  assert.equal(needsQaReview(model), false);
  assert.equal(qaStatusLabel(model), 'Successfully Processed');
});

test('partial/medium-confidence extraction needs QA review', () => {
  const model = baseModel({ extractionStatus: 'partial', extractionConfidence: 'medium' });
  assert.equal(needsQaReview(model), true);
  assert.equal(qaStatusLabel(model), 'Needs Review');
});
