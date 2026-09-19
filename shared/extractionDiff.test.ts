import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffExtractions, formatExtractionDiff } from './extractionDiff.ts';
import type { LogicModel, LogicModelGroup } from '../types.ts';

function groups(entries: [string, string[]][]): LogicModelGroup[] {
  return entries.map(([name, items]) => ({ name, items: items.map(text => ({ text })) }));
}

function model(overrides: Partial<LogicModel> = {}): LogicModel {
  return {
    organization: 'Healthy NewsWorks',
    program: 'Core Reporter Program',
    mission: { content: '' },
    targetPopulation: { content: 'Elementary students' },
    inputs: { content: groups([['General', ['Website', 'Program staff']]]) },
    activities: { content: groups([['General', ['Weekly newsroom sessions']]]) },
    outputs: { content: groups([['General', ['Number of students served']]]) },
    shortTermOutcomes: { content: groups([['General', ['Increased health knowledge']]]) },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    impact: { content: [] },
    layoutFamily: 'vertical_columns',
    extractionStatus: 'ok',
    extractionConfidence: 'high',
    ...overrides,
  };
}

test('an identical extraction reports unchanged', () => {
  const diff = diffExtractions(model(), model());
  assert.equal(diff.unchanged, true);
  assert.deepEqual(diff.fieldChanges, []);
  assert.equal(diff.itemCountBefore, 5);
  assert.equal(diff.itemCountAfter, 5);
  assert.match(formatExtractionDiff('doc.pdf', diff), /unchanged/);
});

test('casing and whitespace differences are not reported as changes', () => {
  const after = model({
    inputs: { content: groups([['General', ['  WEBSITE ', 'Program   staff']]]) },
  });
  assert.equal(diffExtractions(model(), after).unchanged, true);
});

/**
 * The distinction this module exists for: a placement change must read as one move, not as a
 * removal plus an unrelated addition, or the signal a prompt change is being judged on is lost.
 */
test('an item relocated between domains is reported as a move, not add+remove', () => {
  const after = model({
    outputs: { content: [] },
    shortTermOutcomes: {
      content: groups([['General', ['Increased health knowledge', 'Number of students served']]]),
    },
  });
  const diff = diffExtractions(model(), after);
  assert.equal(diff.itemsMoved.length, 1);
  assert.deepEqual(diff.itemsMoved[0].from, { domain: 'Outputs', group: 'General' });
  assert.deepEqual(diff.itemsMoved[0].to, { domain: 'Short-Term Outcomes', group: 'General' });
  assert.equal(diff.itemsAdded.length, 0);
  assert.equal(diff.itemsRemoved.length, 0);
  assert.match(formatExtractionDiff('d', diff), /moved\s+Outputs\/General -> Short-Term Outcomes\/General/);
});

test('a regrouped item within one domain is also a move', () => {
  const after = model({
    inputs: { content: groups([['Frontline Staff', ['Program staff']], ['General', ['Website']]]) },
  });
  const diff = diffExtractions(model(), after);
  assert.equal(diff.itemsMoved.length, 1);
  assert.equal(diff.itemsMoved[0].text, 'Program staff');
  assert.equal(diff.itemsMoved[0].to.group, 'Frontline Staff');
});

test('genuinely new and lost items are reported as added and removed', () => {
  const after = model({
    inputs: { content: groups([['General', ['Website', 'Volunteer mentors']]]) },
  });
  const diff = diffExtractions(model(), after);
  assert.deepEqual(diff.itemsRemoved.map(i => i.text), ['Program staff']);
  assert.deepEqual(diff.itemsAdded.map(i => i.text), ['Volunteer mentors']);
  assert.equal(diff.itemsMoved.length, 0);
});

test('a duplicated item is reported as one addition, not a wholesale rewrite', () => {
  // Real pattern from the 2026-09-19 batch: the same cell text landing in two columns.
  const after = model({
    longTermOutcomes: { content: groups([['General', ['Increased health knowledge']]]) },
  });
  const diff = diffExtractions(model(), after);
  assert.equal(diff.itemsAdded.length, 1);
  assert.deepEqual(diff.itemsAdded[0], {
    text: 'Increased health knowledge',
    domain: 'Long-Term Outcomes',
    group: 'General',
  });
  assert.equal(diff.itemsRemoved.length, 0);
  assert.equal(diff.itemsMoved.length, 0);
});

test('fidelity, document-type and overview changes are reported as field changes', () => {
  const after = model({
    extractionStatus: 'partial',
    extractionConfidence: 'medium',
    extractionBlockers: ['Layout/label mismatch — review unmapped items'],
    documentTypeAssessment: 'not_logic_model',
    impactStatement: { content: 'Every child thrives.' },
  });
  const diff = diffExtractions(model(), after);
  const byField = Object.fromEntries(diff.fieldChanges.map(c => [c.field, c]));
  assert.equal(byField.extractionStatus.after, 'partial');
  assert.equal(byField.extractionConfidence.after, 'medium');
  assert.equal(byField.documentTypeAssessment.after, 'not_logic_model');
  assert.equal(byField.impactStatement.before, '');
  assert.equal(byField.impactStatement.after, 'Every child thrives.');
  assert.ok(byField.extractionBlockers.after.includes('Layout/label mismatch'));
  assert.equal(diff.unchanged, false);
});

test('counts reflect every placement, including a duplicated text', () => {
  const before = model({ inputs: { content: groups([['General', ['Website']]]) } });
  const after = model({
    inputs: { content: groups([['A', ['Website']], ['B', ['Website']]]) },
  });
  assert.equal(diffExtractions(before, after).itemCountBefore, 4);
  assert.equal(diffExtractions(before, after).itemCountAfter, 5);
});

test('an empty extraction against a populated one reports every item as removed', () => {
  const empty = model({
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
  });
  const diff = diffExtractions(model(), empty);
  assert.equal(diff.itemsRemoved.length, 5);
  assert.equal(diff.itemsAdded.length, 0);
  assert.equal(diff.itemCountAfter, 0);
});

test('optional domains missing entirely do not crash the diff', () => {
  const sparse = { ...model() } as LogicModel;
  delete (sparse as Partial<LogicModel>).generalOutcomes;
  delete (sparse as Partial<LogicModel>).unmapped;
  assert.doesNotThrow(() => diffExtractions(sparse, sparse));
  assert.equal(diffExtractions(sparse, sparse).unchanged, true);
});
