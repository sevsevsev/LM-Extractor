import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TEXT_ONLY_FALLBACK_WARNING,
  textOnlyFallbackWarning,
  VisionConversionFailedError,
  VisionUnavailableError,
  isRetryableConvertStatus,
  isVisionFailure,
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

/**
 * App.tsx asks one question of an error: may this file quietly become a text extraction? Both
 * vision failures answer no, and only `isVisionFailure` covers both — a check that missed the
 * transient one would put the silent downgrade back for exactly the case that is most common.
 */
test('isVisionFailure covers both vision errors and nothing else', () => {
  assert.equal(isVisionFailure(new VisionUnavailableError('no LibreOffice')), true);
  assert.equal(isVisionFailure(new VisionConversionFailedError('failed this time')), true);
  assert.equal(isVisionFailure(new Error('ordinary render failure')), false);

  // Only the permanent one means "this deployment cannot do PowerPoint".
  assert.equal(isVisionUnavailable(new VisionConversionFailedError('failed this time')), false);
});

test('a transient failure from another module instance is still recognised', () => {
  const fromAnotherRealm = Object.assign(new Error('failed this time'), {
    name: 'VisionConversionFailedError',
  });
  assert.equal(isVisionFailure(fromAnotherRealm), true);
});

test('only a refusal or a missing LibreOffice skips the retry', () => {
  assert.equal(isRetryableConvertStatus(500), true);
  assert.equal(isRetryableConvertStatus(502), true);
  assert.equal(isRetryableConvertStatus(504), true);
  assert.equal(isRetryableConvertStatus(200), true, 'a 200 with no PDF is worth another attempt');
  assert.equal(isRetryableConvertStatus(503), false, "503 is this app's own no-LibreOffice answer");
  assert.equal(isRetryableConvertStatus(413), false);
  assert.equal(isRetryableConvertStatus(400), false);
});
