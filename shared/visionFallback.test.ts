import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TEXT_ONLY_FALLBACK_WARNING,
  textOnlyFallbackWarning,
  VisionUnavailableError,
  isVisionUnavailable,
} from './visionFallback.ts';

/**
 * The extraction log's `warnings` column is what a reviewer reads weeks later. Nine hosted rows on
 * 2026-09-22 carried the sentence with no reason, and the cause had to be found from a browser
 * console instead.
 */
test('the reason travels with the warning', () => {
  const warning = textOnlyFallbackWarning(new Error('Server LibreOffice convert failed (status 503).'));
  assert.ok(warning.startsWith(TEXT_ONLY_FALLBACK_WARNING));
  assert.match(warning, /Reason: Server LibreOffice convert failed \(status 503\)\./);
});

test('no reason leaves the warning exactly as it was', () => {
  assert.equal(textOnlyFallbackWarning(undefined), TEXT_ONLY_FALLBACK_WARNING);
  assert.equal(textOnlyFallbackWarning(new Error('   ')), TEXT_ONLY_FALLBACK_WARNING);
});

test('a reason stays one bounded line, so a CSV cell stays readable', () => {
  const warning = textOnlyFallbackWarning(new Error(`multi\nline   reason ${'x'.repeat(400)}`));
  assert.ok(!warning.includes('\n'));
  assert.ok(warning.length < TEXT_ONLY_FALLBACK_WARNING.length + 200);
  assert.ok(warning.endsWith('…'));
});

test('isVisionUnavailable survives the dynamic-import boundary', () => {
  assert.equal(isVisionUnavailable(new VisionUnavailableError('no vision here')), true);
  // Same class from a second module instance: structurally identical, different constructor.
  const fromAnotherRealm = Object.assign(new Error('no vision here'), {
    name: 'VisionUnavailableError',
  });
  assert.equal(isVisionUnavailable(fromAnotherRealm), true);
  assert.equal(isVisionUnavailable(new Error('ordinary failure')), false);
});
