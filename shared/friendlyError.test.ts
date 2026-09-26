import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from './friendlyError.ts';
import { VisionUnavailableError } from './visionFallback.ts';

test('a vision failure keeps its own wording, which is already written for the operator', () => {
  // Ordering matters: the patterns below would rewrite this into something vaguer.
  const failure = new VisionUnavailableError('PowerPoint conversion failed on this deployment. Try again.');
  assert.equal(friendlyError(failure), 'PowerPoint conversion failed on this deployment. Try again.');
});

test('a missing or rejected key names the file the operator has to edit', () => {
  for (const message of ['Invalid API key', 'HTTP 401', 'unauthorized']) {
    assert.match(friendlyError(new Error(message)), /GEMINI_API_KEY is set in \.env\.local/);
  }
});

test('rate limiting says to wait rather than to change anything', () => {
  for (const message of ['429 Too Many Requests', 'rate limit exceeded', 'quota exhausted']) {
    assert.match(friendlyError(new Error(message)), /rate-limiting/);
  }
});

test('a 404 points at the deployed functions, the usual cause on a hosted build', () => {
  assert.match(friendlyError(new Error('HTTP 404')), /\/api functions deployed/);
  assert.match(friendlyError(new Error('endpoint not found')), /\/api functions deployed/);
});

test('an upload that is too large suggests the two things that actually help', () => {
  for (const message of ['413', 'Payload Too Large', 'request entity too large']) {
    const out = friendlyError(new Error(message));
    assert.match(out, /shorter PDF/);
    assert.match(out, /run locally/);
  }
});

test('a conversion failure suggests a format that is more likely to work', () => {
  assert.match(friendlyError(new Error('Failed to convert the document')), /Try a PDF/);
  assert.match(friendlyError(new Error('Unsupported file format')), /Try a PDF/);
});

test('an error matching nothing is passed through rather than replaced with a shrug', () => {
  assert.equal(friendlyError(new Error('Disk quotum hit at byte 40')), 'Disk quotum hit at byte 40');
});

test('a thrown non-error still produces a sentence', () => {
  assert.equal(friendlyError('a bare string'), 'a bare string');
  assert.equal(friendlyError(null), 'Something went wrong');
  assert.equal(friendlyError(undefined), 'Something went wrong');
});

test('matching is case-insensitive, since these strings come from several services', () => {
  assert.match(friendlyError(new Error('API KEY missing')), /GEMINI_API_KEY/);
  assert.match(friendlyError(new Error('Quota')), /rate-limiting/);
});
