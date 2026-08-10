import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconcileProvenance, itemNeedsReview } from './provenance.ts';
import type { LogicModel } from '../types.ts';

function model(overrides: Partial<LogicModel> = {}): LogicModel {
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

test('restores provenance/colour dropped by the critique pass', () => {
  const source = model({
    colorLegend: 'Orange = students; Purple = families',
    shortTermOutcomes: {
      content: [
        {
          name: 'General',
          items: [
            { text: 'Increased awareness', verbatim: true, fillColor: 'orange', borderColor: 'red' },
            { text: 'Clipped item', verbatim: false, sourceNote: 'text appears clipped' },
          ],
        },
      ],
    },
  });
  // Critique response keeps text + ratings but dropped provenance fields.
  const critiqued = model({
    shortTermOutcomes: {
      content: [
        {
          name: 'General',
          items: [
            { text: 'Increased awareness', critique: 'ok', rating: 'Adequate' },
            { text: 'Clipped item', critique: 'verify', rating: 'Weak' },
          ],
        },
      ],
    },
  });

  reconcileProvenance(critiqued, source);
  const items = critiqued.shortTermOutcomes.content[0].items;
  assert.equal(items[0].verbatim, true);
  assert.equal(items[0].fillColor, 'orange');
  assert.equal(items[0].borderColor, 'red');
  assert.equal(items[1].verbatim, false);
  assert.equal(items[1].sourceNote, 'text appears clipped');
  // Critique-added fields are preserved.
  assert.equal(items[0].rating, 'Adequate');
  // Model-level colour legend survives the critique pass.
  assert.equal(critiqued.colorLegend, 'Orange = students; Purple = families');
});

test('restores sourcePage/sourceColumn dropped by critique', () => {
  const source = model({
    activities: {
      content: [
        {
          name: 'General',
          items: [{ text: 'Workshops', sourcePage: 2, sourceColumn: 3 }],
        },
      ],
    },
  });
  const critiqued = model({
    activities: {
      content: [
        {
          name: 'General',
          items: [{ text: 'Workshops', critique: 'ok', rating: 'Adequate' }],
        },
      ],
    },
  });
  reconcileProvenance(critiqued, source);
  const item = critiqued.activities.content[0].items[0];
  assert.equal(item.sourcePage, 2);
  assert.equal(item.sourceColumn, 3);
});

test('does not overwrite provenance the critique kept', () => {
  const source = model({
    outputs: { content: [{ name: 'General', items: [{ text: 'A', fillColor: 'orange' }] }] },
  });
  const critiqued = model({
    outputs: { content: [{ name: 'General', items: [{ text: 'A', fillColor: 'purple' }] }] },
  });
  reconcileProvenance(critiqued, source);
  assert.equal(critiqued.outputs.content[0].items[0].fillColor, 'purple');
});

test('restores extraction fidelity fields dropped by critique', () => {
  const source = model({
    extractionStatus: 'partial',
    extractionConfidence: 'medium',
    extractionBlockers: ['Layout family unknown'],
    activities: {
      content: [{ name: 'General', items: [{ text: 'Workshops', verbatim: true }] }],
    },
  });
  const critiqued = model({
    activities: {
      content: [
        { name: 'General', items: [{ text: 'Workshops', critique: 'ok', rating: 'Adequate' }] },
      ],
    },
  });
  reconcileProvenance(critiqued, source);
  assert.equal(critiqued.extractionStatus, 'partial');
  assert.equal(critiqued.extractionConfidence, 'medium');
  assert.deepEqual(critiqued.extractionBlockers, ['Layout family unknown']);
});

test('itemNeedsReview flags non-verbatim and noted items', () => {
  assert.equal(itemNeedsReview({ text: 'x', verbatim: false }), true);
  assert.equal(itemNeedsReview({ text: 'x', sourceNote: 'clipped' }), true);
  assert.equal(itemNeedsReview({ text: 'x', verbatim: true }), false);
  assert.equal(itemNeedsReview({ text: 'x' }), false);
});
