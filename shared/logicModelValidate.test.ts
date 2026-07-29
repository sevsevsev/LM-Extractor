import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseLogicModelResponse,
  parseOverallQuality,
  validateLogicModel,
} from './logicModelValidate.ts';

const sample = {
  organization: 'Org',
  program: 'Prog',
  mission: { content: 'Mission' },
  targetPopulation: { content: 'Youth' },
  inputs: { content: [] },
  activities: { content: [] },
  outputs: { content: [] },
  shortTermOutcomes: { content: [] },
  mediumTermOutcomes: { content: [] },
  longTermOutcomes: { content: [] },
  impact: { content: [] },
};

test('validateLogicModel accepts a complete object', () => {
  const result = validateLogicModel(sample);
  assert.equal(result.organization, 'Org');
});

test('validateLogicModel rejects missing fields', () => {
  assert.throws(() => validateLogicModel({ organization: 'Org' }), /missing required/);
});

test('parseLogicModelResponse parses JSON', () => {
  const result = parseLogicModelResponse(JSON.stringify(sample));
  assert.equal(result.program, 'Prog');
});

test('parseLogicModelResponse rejects invalid JSON', () => {
  assert.throws(() => parseLogicModelResponse('{'), /not valid JSON/);
});

test('requireOverallQuality rejects missing overallQuality', () => {
  assert.throws(
    () => validateLogicModel(sample, { requireOverallQuality: true }),
    /missing overallQuality/
  );
});

test('requireOverallQuality accepts valid overallQuality', () => {
  const result = validateLogicModel(
    {
      ...sample,
      overallQuality: {
        rating: 'Adequate',
        rationale: ['Outputs mix in outcomes.', 'Short-term includes behavior change.'],
      },
    },
    { requireOverallQuality: true }
  );
  assert.equal(result.overallQuality?.rating, 'Adequate');
  assert.equal(result.overallQuality?.rationale.length, 2);
});

test('parseOverallQuality trims and caps rationale at 4', () => {
  const oq = parseOverallQuality(
    {
      rating: 'Weak',
      rationale: [' a ', 'b', 'c', 'd', 'e', ''],
    },
    true
  );
  assert.deepEqual(oq?.rationale, ['a', 'b', 'c', 'd']);
});

test('parseOverallQuality rejects fewer than 2 bullets', () => {
  assert.throws(
    () => parseOverallQuality({ rating: 'Strong', rationale: ['Only one'] }, true),
    /at least 2/
  );
});

test('validateLogicModel accepts optional impactStatement', () => {
  const result = validateLogicModel({
    ...sample,
    impactStatement: { content: 'Through sustained participation...' },
  });
  assert.equal(result.impactStatement?.content, 'Through sustained participation...');
});
