import assert from 'node:assert/strict';
import test from 'node:test';
import { modelChangeNote } from './modelChangeNote.ts';

test('same model is silent, so an unchanged run keeps a short header', () => {
  assert.equal(modelChangeNote('gemini-3.8-flash', 'gemini-3.8-flash'), '');
});

test('a rotation is named in both directions', () => {
  assert.equal(
    modelChangeNote('gemini-3.7-flash', 'gemini-3.8-flash'),
    ' · model gemini-3.7-flash -> gemini-3.8-flash'
  );
});

/**
 * The case that made this function necessary: every snapshot committed before `modelVersion`
 * existed. The diff cannot say whether the model moved, and must not imply that it didn't.
 */
test('a baseline with no recorded model says so instead of staying silent', () => {
  assert.equal(
    modelChangeNote(undefined, 'gemini-3.8-flash'),
    ' · model gemini-3.8-flash, baseline recorded none'
  );
});

test('a run where Gemini reported no version says so too', () => {
  assert.equal(
    modelChangeNote('gemini-3.8-flash', undefined),
    ' · model unreported, baseline was gemini-3.8-flash'
  );
});

test('knowing nothing about either side adds nothing to the header', () => {
  assert.equal(modelChangeNote(undefined, undefined), '');
});
