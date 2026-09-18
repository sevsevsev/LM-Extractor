import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayFileName } from './processingFileDisplay.ts';

test('displayFileName returns the plain filename when there is no split part label', () => {
  assert.equal(displayFileName({ file: { name: 'org-programs.pdf' } as File }), 'org-programs.pdf');
});

test('displayFileName appends the split part label when present', () => {
  assert.equal(
    displayFileName({ file: { name: 'org-programs.pdf' } as File, splitPartLabel: 'Part 2 of 7' }),
    'org-programs.pdf — Part 2 of 7'
  );
});
