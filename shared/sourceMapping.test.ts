import assert from 'node:assert/strict';
import { test } from 'node:test';
import { synonymToDomain, isKnownInputSubBucket } from './domainSynonyms.ts';
import {
  applySourceAwareMapping,
  shouldSuggestMismatch,
  reassignItemDomain,
  countMappedItems,
} from './sourceMapping.ts';
import type { LogicModel } from '../types.ts';

function baseModel(overrides: Partial<LogicModel> = {}): LogicModel {
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: '' },
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

test('synonymToDomain maps conservative headers only', () => {
  assert.equal(synonymToDomain('Resources'), 'inputs');
  assert.equal(synonymToDomain('Short-Term Outcomes'), 'shortTermOutcomes');
  assert.equal(synonymToDomain('Deliverables'), 'outputs');
  assert.equal(synonymToDomain('Assumptions'), null);
  assert.equal(synonymToDomain('Summer Intensive'), null);
  assert.equal(synonymToDomain('Goals'), null);
});

test('isKnownInputSubBucket recognizes Resources buckets', () => {
  assert.equal(isKnownInputSubBucket('Frontline Staff'), true);
  assert.equal(isKnownInputSubBucket('Partners'), true);
  assert.equal(isKnownInputSubBucket('Summer Intensive'), false);
});

test('applySourceAwareMapping remaps synonym mismatch and keeps track groups', () => {
  const m = applySourceAwareMapping(
    baseModel({
      activities: {
        content: [
          {
            name: 'Outputs',
            items: [{ text: 'Misplaced under Activities header that says Outputs' }],
          },
          { name: 'Summer Intensive', items: [{ text: 'Pilates' }] },
        ],
      },
    })
  );
  assert.ok(m.outputs.content.some(g => g.items.some(i => /Misplaced/.test(i.text))));
  assert.ok(m.activities.content.some(g => g.name === 'Summer Intensive'));
  assert.equal(m.layoutFamily, 'vertical_columns');
});

test('shouldSuggestMismatch when many items unmapped', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ text: `Item ${i}` }));
  const m = baseModel({
    unmapped: { content: [{ name: 'Assumptions', items }] },
  });
  applySourceAwareMapping(m);
  const { total, unmapped } = countMappedItems(m);
  assert.equal(total, 8);
  assert.equal(unmapped, 8);
  assert.equal(shouldSuggestMismatch(m), true);
});

test('reassignItemDomain moves unmapped to inputs and logs correction', () => {
  const start = applySourceAwareMapping(
    baseModel({
      unmapped: {
        content: [{ name: 'Assumptions', items: [{ text: 'Staff capacity is limited' }] }],
      },
    })
  );
  const { model, event } = reassignItemDomain(start, {
    fromDomain: 'unmapped',
    fromGroupIndex: 0,
    itemIndex: 0,
    toDomain: 'inputs',
    note: 'treated as input constraint',
  });
  assert.ok(event);
  assert.equal(event!.action, 'assign_domain');
  assert.ok(model.inputs.content.some(g => g.items.some(i => /Staff capacity/.test(i.text))));
  assert.equal(countMappedItems(model).unmapped, 0);
  assert.ok((model.mappingCorrections?.length ?? 0) >= 1);
});
