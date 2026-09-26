import test from 'node:test';
import assert from 'node:assert/strict';
import { regressionOutcome, type RegressionTally } from './regressionOutcome.ts';

const tally = (partial: Partial<RegressionTally> = {}): RegressionTally => ({
  total: 17,
  unchanged: 14,
  changed: 0,
  missingBundles: 3,
  failures: 0,
  update: false,
  requireBundles: false,
  ...partial,
});

/** The regression this module exists for: the repository's ordinary state is a pass. */
test('a clean run with some bundles uncaptured passes and says what it skipped', () => {
  const outcome = regressionOutcome(tally());
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.summary, /14 document\(s\) measured, all unchanged/);
  assert.match(outcome.summary, /3 document\(s\) skipped/);
});

test('a clean run with every bundle present says nothing about skipping', () => {
  const outcome = regressionOutcome(tally({ unchanged: 17, missingBundles: 0 }));
  assert.equal(outcome.exitCode, 0);
  assert.ok(!outcome.summary.includes('skipped'));
});

test('a changed document still fails the run', () => {
  const outcome = regressionOutcome(tally({ unchanged: 13, changed: 1 }));
  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.summary, /--update/);
});

test('a change accepted with --update is not a failure', () => {
  assert.equal(regressionOutcome(tally({ unchanged: 13, changed: 1, update: true })).exitCode, 0);
});

/** The case the old rule was really protecting, and the only one that has to be an error. */
test('measuring nothing at all is an error, not a pass', () => {
  const outcome = regressionOutcome(tally({ unchanged: 0, changed: 0, missingBundles: 17 }));
  assert.equal(outcome.exitCode, 2);
  assert.match(outcome.summary, /Nothing was tested/);
  assert.match(outcome.summary, /17 document\(s\)/);
});

test('measuring nothing with no bundles missing either is still an error', () => {
  const outcome = regressionOutcome(tally({ total: 0, unchanged: 0, changed: 0, missingBundles: 0 }));
  assert.equal(outcome.exitCode, 2);
  assert.match(outcome.summary, /Nothing was tested/);
});

test('an errored extract call outranks everything — the run did not really happen', () => {
  const outcome = regressionOutcome(tally({ failures: 1, changed: 2 }));
  assert.equal(outcome.exitCode, 2);
  assert.match(outcome.summary, /GEMINI_API_KEY/);
});

test('--require-bundles restores the strict behaviour for a machine that should have them all', () => {
  const outcome = regressionOutcome(tally({ requireBundles: true }));
  assert.equal(outcome.exitCode, 2);
  assert.match(outcome.summary, /--require-bundles/);
});

test('--require-bundles is satisfied when every bundle is present', () => {
  assert.equal(
    regressionOutcome(tally({ unchanged: 17, missingBundles: 0, requireBundles: true })).exitCode,
    0
  );
});

test('a real change outranks a missing bundle, so a regression is never reported as a skip', () => {
  const outcome = regressionOutcome(tally({ unchanged: 13, changed: 1, missingBundles: 3 }));
  assert.equal(outcome.exitCode, 1);
});
