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

test('synonymToDomain maps a bare "Outcomes" header to generalOutcomes, not a specific horizon', () => {
  assert.equal(synonymToDomain('Outcomes'), 'generalOutcomes');
  assert.equal(synonymToDomain('Program Outcomes'), 'generalOutcomes');
  // A qualified horizon still wins over the bare fallback.
  assert.equal(synonymToDomain('Short-Term Outcomes'), 'shortTermOutcomes');
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

test('applySourceAwareMapping routes a bare "Outcomes" header to generalOutcomes, not shortTermOutcomes', () => {
  const m = applySourceAwareMapping(
    baseModel({
      // Gemini put these under shortTermOutcomes (its only real option pre-fix), but the group
      // header it also recorded says the source column was just "Outcomes" — synonym-based
      // remap should move it to generalOutcomes rather than leaving it mislabeled as short-term.
      shortTermOutcomes: {
        content: [{ name: 'Outcomes', items: [{ text: 'Participants report increased confidence' }] }],
      },
    })
  );
  assert.ok(
    m.generalOutcomes?.content.some(g => g.items.some(i => /increased confidence/.test(i.text)))
  );
  assert.ok(!m.shortTermOutcomes.content.some(g => g.items.some(i => /increased confidence/.test(i.text))));
});

test('applySourceAwareMapping initializes an empty generalOutcomes even when the source never used it', () => {
  const m = applySourceAwareMapping(baseModel());
  assert.deepEqual(m.generalOutcomes?.content, []);
});

test('applySourceAwareMapping preserves an alternate outcome taxonomy (Attitudes/Behaviors/Conditions) as group names under generalOutcomes, not "General"', () => {
  const m = applySourceAwareMapping(
    baseModel({
      generalOutcomes: {
        content: [
          { name: 'Attitudes', items: [{ text: 'Volunteers feel more confident' }] },
          { name: 'Behaviors', items: [{ text: 'Volunteers attend more sessions' }] },
          { name: 'Conditions', items: [{ text: 'Fewer students falling behind' }] },
        ],
      },
    })
  );
  const groupNames = m.generalOutcomes?.content.map(g => g.name).sort();
  assert.deepEqual(groupNames, ['Attitudes', 'Behaviors', 'Conditions']);
  assert.ok(
    m.generalOutcomes?.content.some(g => g.name === 'Attitudes' && g.items.some(i => /more confident/.test(i.text)))
  );
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

test('reassignItemDomain moves an item into generalOutcomes, then a coder assigns the real horizon later', () => {
  const start = applySourceAwareMapping(
    baseModel({
      unmapped: {
        content: [{ name: 'Outcomes', items: [{ text: 'Volunteers feel more confident' }] }],
      },
    })
  );

  const step1 = reassignItemDomain(start, {
    fromDomain: 'unmapped',
    fromGroupIndex: 0,
    itemIndex: 0,
    toDomain: 'generalOutcomes',
  });
  assert.ok(
    step1.model.generalOutcomes?.content.some(g => g.items.some(i => /more confident/.test(i.text)))
  );

  // Later, during coding, a human determines this is actually short-term and reassigns it —
  // this must not throw or silently lose the item, even though generalOutcomes started out unset
  // on the very first baseModel() before applySourceAwareMapping ran.
  const step2 = reassignItemDomain(step1.model, {
    fromDomain: 'generalOutcomes',
    fromGroupIndex: 0,
    itemIndex: 0,
    toDomain: 'shortTermOutcomes',
  });
  assert.ok(
    step2.model.shortTermOutcomes.content.some(g => g.items.some(i => /more confident/.test(i.text)))
  );
  assert.equal(step2.model.generalOutcomes?.content.length, 0);
});
