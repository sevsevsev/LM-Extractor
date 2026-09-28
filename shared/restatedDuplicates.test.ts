import test from 'node:test';
import assert from 'node:assert/strict';
import { dropRestatedDuplicates } from './restatedDuplicates.ts';
import type { LogicModel } from '../types.ts';

function model(parts: Record<string, { name: string; items: string[] }[]>): LogicModel {
  const out: Record<string, { content: unknown[] }> = {};
  for (const [domain, groups] of Object.entries(parts)) {
    out[domain] = { content: groups.map(g => ({ name: g.name, items: g.items.map(text => ({ text })) })) };
  }
  return out as unknown as LogicModel;
}

function texts(m: LogicModel, domain: string): string[] {
  const groups = (m as unknown as Record<string, { content?: { items?: { text: string }[] }[] }>)[domain];
  return (groups?.content ?? []).flatMap(g => (g.items ?? []).map(i => i.text));
}

test('a restated copy printed word for word in a column is dropped from unmapped', () => {
  const m = model({
    inputs: [{ name: 'General', items: ['Two tutors employed for the season'] }],
    unmapped: [{ name: 'Restated — funder format', items: ['Two tutors employed for the season'] }],
  });
  const dropped = dropRestatedDuplicates(m);
  assert.deepEqual(texts(m, 'unmapped'), []);
  assert.deepEqual(dropped, [{ text: 'Two tutors employed for the season', keptIn: 'inputs' }]);
});

test('a restated line that diverges after the same opening is kept', () => {
  // Dropping this would lose the words the first printing does not carry, which is the whole
  // reason a later printing goes to unmapped rather than nowhere.
  const m = model({
    inputs: [{ name: 'General', items: ['Two tutors employed for the season'] }],
    unmapped: [
      { name: 'Restated', items: ['Two tutors employed for the season, both qualified to level 3'] },
    ],
  });
  assert.deepEqual(dropRestatedDuplicates(m), []);
  assert.equal(texts(m, 'unmapped').length, 1);
});

test('case and run-together spacing do not make two printings look different', () => {
  const m = model({
    activities: [{ name: 'General', items: ['Weekly reading sessions'] }],
    unmapped: [{ name: 'Restated', items: ['weekly   reading  sessions'] }],
  });
  assert.equal(dropRestatedDuplicates(m).length, 1);
  assert.deepEqual(texts(m, 'unmapped'), []);
});

test('nothing is ever removed from a grid column', () => {
  // Two columns legitimately holding the same wording is not this pass's business; it only ever
  // reads the columns and writes unmapped.
  const m = model({
    inputs: [{ name: 'General', items: ['Volunteer time'] }],
    activities: [{ name: 'General', items: ['Volunteer time'] }],
  });
  assert.deepEqual(dropRestatedDuplicates(m), []);
  assert.deepEqual(texts(m, 'inputs'), ['Volunteer time']);
  assert.deepEqual(texts(m, 'activities'), ['Volunteer time']);
});

test('two unmapped items repeating each other are both kept', () => {
  const m = model({
    inputs: [{ name: 'General', items: ['A minibus'] }],
    unmapped: [{ name: 'Notes', items: ['A grant from the trust', 'A grant from the trust'] }],
  });
  assert.deepEqual(dropRestatedDuplicates(m), []);
  assert.equal(texts(m, 'unmapped').length, 2);
});

test('a group left with no items is removed rather than shown as an empty heading', () => {
  const m = model({
    outputs: [{ name: 'General', items: ['Ninety-six places filled', 'Twenty mornings run'] }],
    unmapped: [
      { name: 'Restated — outputs', items: ['Ninety-six places filled', 'Twenty mornings run'] },
      { name: 'Notes and references', items: ['Adeyemi, O. (2019)'] },
    ],
  });
  assert.equal(dropRestatedDuplicates(m).length, 2);
  const groups = (m as unknown as { unmapped: { content: { name: string }[] } }).unmapped.content;
  assert.deepEqual(groups.map(g => g.name), ['Notes and references']);
});

test('a document with nothing in unmapped is returned untouched', () => {
  const m = model({ inputs: [{ name: 'General', items: ['A minibus'] }] });
  assert.deepEqual(dropRestatedDuplicates(m), []);
  assert.deepEqual(texts(m, 'inputs'), ['A minibus']);
});
