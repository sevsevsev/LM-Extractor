import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLogicModelResponse, validateLogicModel } from './logicModelValidate.ts';

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

test('validateLogicModel accepts optional impactStatement', () => {
  const result = validateLogicModel({
    ...sample,
    impactStatement: { content: 'Through sustained participation...' },
  });
  assert.equal(result.impactStatement?.content, 'Through sustained participation...');
});
