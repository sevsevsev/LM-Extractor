import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import {
  applyCausalChainGuardrail,
  countCausalLeaks,
  countPresentOutcomeHorizons,
} from './causalChain.js';

function item(text: string, causalRole?: LogicModelItem['causalRole']): LogicModelItem {
  return causalRole === undefined ? { text } : { text, causalRole };
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
    overallQuality: { rating: 'Strong', rationale: ['Chain is coherent.', 'Domains present are well-formed.'] },
    ...overrides,
  };
}

test('countCausalLeaks ignores absent outcome domains and non-outcome domains', () => {
  const model = baseModel({
    activities: { content: groups([item('Deliver workshops', 'mechanism_leak')]) },
    shortTermOutcomes: { content: groups([item('Participants report increased confidence', 'outcome')]) },
  });
  const { total, leaks } = countCausalLeaks(model);
  assert.equal(total, 1);
  assert.equal(leaks, 0);
});

test('countCausalLeaks counts mechanism_leak and context_leak across present outcome domains', () => {
  const model = baseModel({
    shortTermOutcomes: {
      content: groups([
        item('Deliver case management services', 'mechanism_leak'),
        item('Participants gain awareness of resources', 'outcome'),
      ]),
    },
    longTermOutcomes: {
      content: groups([item('Family has stable housing (precondition for program)', 'context_leak')]),
    },
  });
  const { total, leaks } = countCausalLeaks(model);
  assert.equal(total, 3);
  assert.equal(leaks, 2);
});

test('countPresentOutcomeHorizons counts only non-empty horizons', () => {
  const model = baseModel({
    shortTermOutcomes: { content: groups([item('x')]) },
    longTermOutcomes: { content: groups([item('y')]) },
  });
  assert.equal(countPresentOutcomeHorizons(model), 2);
});

test('guardrail leaves non-Strong ratings untouched (downgrade-only)', () => {
  const model = baseModel({
    overallQuality: { rating: 'Weak', rationale: ['a', 'b'] },
    shortTermOutcomes: {
      content: groups([item('leak one', 'mechanism_leak'), item('leak two', 'context_leak')]),
    },
  });
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rating, 'Weak');
  assert.deepEqual(result.overallQuality?.rationale, ['a', 'b']);
});

test('guardrail downgrades Strong to Adequate when leak count threshold hit', () => {
  const model = baseModel({
    shortTermOutcomes: {
      content: groups([
        item('Deliver case management', 'mechanism_leak'),
        item('Provide referrals', 'context_leak'),
        item('Participants gain awareness', 'outcome'),
      ]),
    },
  });
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rating, 'Adequate');
  assert.ok(result.overallQuality?.rationale.some(b => b.includes('Causal-chain check')));
  assert.ok(result.overallQuality!.rationale.length <= 4);
});

test('guardrail downgrades Strong to Adequate when leak ratio threshold hit even under count threshold', () => {
  const model = baseModel({
    shortTermOutcomes: {
      content: groups([
        item('Deliver case management', 'mechanism_leak'),
        item('Participants gain awareness', 'outcome'),
        item('Participants report confidence', 'outcome'),
      ]),
    },
  });
  // 1 leak / 3 total = 0.33 >= 0.25 ratio threshold, even though count (1) < minLeakCount (2)
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rating, 'Adequate');
});

test('guardrail does not downgrade when leaks are below both thresholds', () => {
  const model = baseModel({
    shortTermOutcomes: {
      content: groups([
        item('Deliver case management', 'mechanism_leak'),
        ...Array.from({ length: 9 }, (_, i) => item(`Outcome ${i}`, 'outcome')),
      ]),
    },
  });
  // 1 leak / 10 = 0.10 ratio, 1 count — both below thresholds
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rating, 'Strong');
});

test('guardrail downgrades on broken coherence even with zero leaks, only when >=2 horizons present', () => {
  const model = baseModel({
    shortTermOutcomes: { content: groups([item('Participants gain awareness', 'outcome')]) },
    longTermOutcomes: { content: groups([item('Community conditions improve', 'outcome')]) },
    causalChainAssessment: { coherence: 'broken', evidence: ['Long-term does not follow from short-term.'] },
  });
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rating, 'Adequate');
});

test('guardrail ignores a broken-coherence claim with fewer than 2 present horizons (defensive)', () => {
  const model = baseModel({
    shortTermOutcomes: { content: groups([item('Participants gain awareness', 'outcome')]) },
    causalChainAssessment: { coherence: 'broken', evidence: ['spurious'] },
  });
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rating, 'Strong');
});

test('guardrail keeps rationale within 2-4 bullets, guaranteeing the causal-chain bullet is present', () => {
  const model = baseModel({
    overallQuality: {
      rating: 'Strong',
      rationale: ['bullet 1', 'bullet 2', 'bullet 3', 'bullet 4'],
    },
    shortTermOutcomes: {
      content: groups([item('leak one', 'mechanism_leak'), item('leak two', 'context_leak')]),
    },
  });
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality?.rationale.length, 4);
  assert.ok(result.overallQuality?.rationale[3].includes('Causal-chain check'));
});

test('guardrail is a no-op when overallQuality is absent', () => {
  const model = baseModel({ overallQuality: undefined });
  const result = applyCausalChainGuardrail(model);
  assert.equal(result.overallQuality, undefined);
});
