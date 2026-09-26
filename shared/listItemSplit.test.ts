import test from 'node:test';
import assert from 'node:assert/strict';
import type { LogicModel } from '../types.ts';
import {
  hasBalancedDelimiters,
  isSentenceTerminator,
  sentenceParts,
  splitRunOnCell,
  splitRunOnItems,
  MIN_CELL_CHARS,
} from './listItemSplit.ts';

/**
 * Every string below is invented. The shapes come from the blessed snapshots, but no cell of a
 * real client document is quoted here — see fixtures/regression-set/README.md.
 */

const SEMICOLON_LIST =
  'After-school and weekend programming; neighbourhood school partnerships; seasonal field trips';

const TWO_SENTENCES =
  'Partnerships confirmed with a memorandum of understanding, contracts, insurance information. ' +
  'Attend orientation evenings, submit curriculum and programme description to school leadership';

test('a three-part semicolon list becomes three items', () => {
  assert.deepEqual(splitRunOnCell(SEMICOLON_LIST), [
    'After-school and weekend programming',
    'neighbourhood school partnerships',
    'seasonal field trips',
  ]);
});

test('a single semicolon is left alone, because it usually joins a clause to its qualifier', () => {
  const text =
    'Curriculum aligned to recognised educational standards and levelled; updated annually';
  assert.ok(text.length > MIN_CELL_CHARS);
  assert.equal(splitRunOnCell(text), null);
});

test('two sentences become two items, each without the terminal stop', () => {
  assert.deepEqual(splitRunOnCell(TWO_SENTENCES), [
    'Partnerships confirmed with a memorandum of understanding, contracts, insurance information',
    'Attend orientation evenings, submit curriculum and programme description to school leadership',
  ]);
});

test('a bare comma never splits, however list-like the cell reads', () => {
  const text =
    'Increased artistic skills, improved physical activity levels, and stronger goal-setting habits';
  assert.equal(splitRunOnCell(text), null);
});

test('an initial inside a bracketed attribution is not a sentence end', () => {
  const text = 'Part-time therapist provided under contract (Avery R. Nolan Counselling Center)';
  assert.ok(text.length > MIN_CELL_CHARS);
  assert.equal(splitRunOnCell(text), null);
});

test('a known abbreviation is not a sentence end', () => {
  const text =
    'Avg. Workshop sessions delivered per week across every participating partner school site';
  assert.ok(text.length > MIN_CELL_CHARS);
  assert.equal(splitRunOnCell(text), null);
});

test('a labelled cell is left to the inline-label promoter', () => {
  const text = 'Participants: attendance records; retention rates; demographic intake forms';
  assert.equal(splitRunOnCell(text), null);
});

test('a short cell is left alone even when it holds separators', () => {
  assert.equal(splitRunOnCell('Staff; space; funds'), null);
});

test('a semicolon list with a bare fragment in it is refused whole', () => {
  const text = 'Recruitment of families across the catchment area; outreach; x; partner liaison';
  assert.equal(splitRunOnCell(text), null);
});

test('a split that would leave a bracket unclosed is refused', () => {
  const text =
    'Sessions delivered weekly (mornings; afternoons; evenings) across the partner network';
  assert.equal(splitRunOnCell(text), null);
});

test('a sentence part too short to read as a statement blocks the split', () => {
  const text =
    'Workshops run every week throughout the programme year at each site. Twelve in total.';
  assert.equal(splitRunOnCell(text), null);
});

test('splitting is idempotent: the parts of a split cell do not split again', () => {
  for (const source of [SEMICOLON_LIST, TWO_SENTENCES]) {
    for (const part of splitRunOnCell(source)!) {
      assert.equal(splitRunOnCell(part), null, `re-split: ${part}`);
    }
  }
});

test('a single-letter initial does not terminate a sentence', () => {
  assert.equal(isSentenceTerminator('Provided by Avery R.'), false);
});

test('a known abbreviation does not terminate a sentence, whatever its case', () => {
  assert.equal(isSentenceTerminator('Counted as Avg.'), false);
  assert.equal(isSentenceTerminator('Delivered by ABC Inc.'), false);
});

test('an ordinary word does terminate a sentence', () => {
  assert.equal(isSentenceTerminator('Sessions are delivered weekly.'), true);
});

test('sentence parts keep every character of the original', () => {
  assert.equal(sentenceParts(TWO_SENTENCES).join(' '), TWO_SENTENCES);
});

test('a cell with no boundary yields one sentence part', () => {
  assert.equal(sentenceParts('One statement only, with no terminator').length, 1);
});

test('balanced brackets and quotes pass the delimiter check', () => {
  assert.equal(hasBalancedDelimiters('Sessions (weekly) and "workshops"'), true);
});

test('an unclosed or stray bracket fails the delimiter check', () => {
  assert.equal(hasBalancedDelimiters('Sessions (weekly'), false);
  assert.equal(hasBalancedDelimiters('weekly) and workshops'), false);
});

function modelWith(text: string): LogicModel {
  return {
    organization: 'Example',
    program: 'Example',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: { content: [] },
    activities: {
      content: [{ name: 'General', items: [{ text, sourcePage: 2, mappedBy: 'auto' }] }],
    },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    generalOutcomes: { content: [] },
    impact: { content: [] },
  } as unknown as LogicModel;
}

test('a run-on item is replaced by its parts, and the change is reported', () => {
  const model = modelWith(SEMICOLON_LIST);
  assert.equal(splitRunOnItems(model), true);
  const items = (model.activities.content as never as Array<{ items: unknown[] }>)[0].items;
  assert.equal(items.length, 3);
});

test('every part carries the parent item provenance', () => {
  const model = modelWith(SEMICOLON_LIST);
  splitRunOnItems(model);
  const items = (model.activities.content as never as Array<{
    items: Array<{ sourcePage: number; mappedBy: string }>;
  }>)[0].items;
  for (const item of items) {
    assert.equal(item.sourcePage, 2);
    assert.equal(item.mappedBy, 'auto');
  }
});

test('a model with nothing to split is untouched', () => {
  const model = modelWith('One ordinary activity statement that runs a little long but is one');
  assert.equal(splitRunOnItems(model), false);
});
