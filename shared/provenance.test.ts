import assert from 'node:assert/strict';
import { test } from 'node:test';
import { itemNeedsReview } from './provenance.ts';

test('itemNeedsReview flags non-verbatim and noted items', () => {
  assert.equal(itemNeedsReview({ text: 'x', verbatim: false }), true);
  assert.equal(itemNeedsReview({ text: 'x', sourceNote: 'clipped' }), true);
  assert.equal(itemNeedsReview({ text: 'x', verbatim: true }), false);
  assert.equal(itemNeedsReview({ text: 'x' }), false);
});
