import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeLogicModelPageGroups } from './logicModelPageGroups.ts';

test('normalizeLogicModelPageGroups accepts valid contiguous, full-coverage groups', () => {
  const groups = normalizeLogicModelPageGroups(
    [
      { startPage: 1, endPage: 3, label: 'Org A' },
      { startPage: 4, endPage: 7, label: 'Org B' },
    ],
    7
  );
  assert.deepEqual(groups, [
    { startPage: 1, endPage: 3, label: 'Org A' },
    { startPage: 4, endPage: 7, label: 'Org B' },
  ]);
});

test('normalizeLogicModelPageGroups falls back to one group on empty/missing input', () => {
  assert.deepEqual(normalizeLogicModelPageGroups(undefined, 5), [{ startPage: 1, endPage: 5 }]);
  assert.deepEqual(normalizeLogicModelPageGroups([], 5), [{ startPage: 1, endPage: 5 }]);
  assert.deepEqual(normalizeLogicModelPageGroups('not an array', 5), [{ startPage: 1, endPage: 5 }]);
});

test('normalizeLogicModelPageGroups falls back to one group on a gap between ranges', () => {
  const groups = normalizeLogicModelPageGroups(
    [
      { startPage: 1, endPage: 2 },
      { startPage: 4, endPage: 5 }, // page 3 missing
    ],
    5
  );
  assert.deepEqual(groups, [{ startPage: 1, endPage: 5 }]);
});

test('normalizeLogicModelPageGroups falls back to one group on overlapping ranges', () => {
  const groups = normalizeLogicModelPageGroups(
    [
      { startPage: 1, endPage: 3 },
      { startPage: 3, endPage: 5 }, // page 3 double-counted
    ],
    5
  );
  assert.deepEqual(groups, [{ startPage: 1, endPage: 5 }]);
});

test('normalizeLogicModelPageGroups falls back to one group when coverage does not start at 1', () => {
  const groups = normalizeLogicModelPageGroups([{ startPage: 2, endPage: 5 }], 5);
  assert.deepEqual(groups, [{ startPage: 1, endPage: 5 }]);
});

test('normalizeLogicModelPageGroups falls back to one group when coverage does not reach pageCount', () => {
  const groups = normalizeLogicModelPageGroups([{ startPage: 1, endPage: 3 }], 5);
  assert.deepEqual(groups, [{ startPage: 1, endPage: 5 }]);
});

test('normalizeLogicModelPageGroups falls back to one group on an out-of-bounds or malformed entry', () => {
  assert.deepEqual(normalizeLogicModelPageGroups([{ startPage: 1, endPage: 99 }], 5), [
    { startPage: 1, endPage: 5 },
  ]);
  assert.deepEqual(normalizeLogicModelPageGroups([{ startPage: 3, endPage: 1 }], 5), [
    { startPage: 1, endPage: 5 },
  ]);
  assert.deepEqual(normalizeLogicModelPageGroups([{ startPage: 'x', endPage: 5 }], 5), [
    { startPage: 1, endPage: 5 },
  ]);
  assert.deepEqual(normalizeLogicModelPageGroups(['not an object'], 5), [{ startPage: 1, endPage: 5 }]);
});

test('normalizeLogicModelPageGroups sorts out-of-order groups before validating coverage', () => {
  const groups = normalizeLogicModelPageGroups(
    [
      { startPage: 4, endPage: 5 },
      { startPage: 1, endPage: 3 },
    ],
    5
  );
  assert.deepEqual(groups, [
    { startPage: 1, endPage: 3, label: undefined },
    { startPage: 4, endPage: 5, label: undefined },
  ]);
});

test('normalizeLogicModelPageGroups trims and caps an overlong label', () => {
  const longLabel = 'x'.repeat(300);
  const groups = normalizeLogicModelPageGroups([{ startPage: 1, endPage: 5, label: longLabel }], 5);
  assert.equal(groups[0].label?.length, 120);
});

test('normalizeLogicModelPageGroups drops a blank label rather than keep an empty string', () => {
  const groups = normalizeLogicModelPageGroups([{ startPage: 1, endPage: 5, label: '   ' }], 5);
  assert.equal(groups[0].label, undefined);
});
