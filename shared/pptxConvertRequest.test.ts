import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestPptxPdfBase64, type ConvertResponseLike } from './pptxConvertRequest.ts';
import { isVisionUnavailable, VisionConversionFailedError } from './visionFallback.ts';

const noSleep = async () => {};
const ok = (pdfBase64 = 'UERG'): ConvertResponseLike => ({
  ok: true,
  status: 200,
  json: async () => ({ pdfBase64 }),
});
const failing = (status: number, body: unknown = {}): ConvertResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const unreadable = (status: number): ConvertResponseLike => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON at position 0');
  },
});

function queue(responses: (ConvertResponseLike | Error)[]) {
  const calls: number[] = [];
  const send = async () => {
    const next = responses[calls.length];
    calls.push(1);
    if (next instanceof Error) throw next;
    return next;
  };
  return { send, count: () => calls.length };
}

test('a good response comes straight back, with no retry', async () => {
  const q = queue([ok('QUJD')]);
  assert.equal(await requestPptxPdfBase64(q.send, { sleep: noSleep }), 'QUJD');
  assert.equal(q.count(), 1);
});

/**
 * The reported failure, 2026-09-24: a deck converts alone and fails in a batch. Conversion
 * requests are serial, so a second attempt lands on a server in a different state from the first.
 */
test('a 500 is retried once and the second attempt is kept', async () => {
  const q = queue([failing(500, { error: 'Conversion failed: worker exited' }), ok('T0s=')]);
  assert.equal(await requestPptxPdfBase64(q.send, { sleep: noSleep }), 'T0s=');
  assert.equal(q.count(), 2);
});

test('a gateway timeout answering in HTML is retried, not read as a missing LibreOffice', async () => {
  const q = queue([unreadable(504), ok()]);
  await requestPptxPdfBase64(q.send, { sleep: noSleep });
  assert.equal(q.count(), 2);
});

test('a dropped connection is retried', async () => {
  const q = queue([new TypeError('NetworkError when attempting to fetch resource.'), ok()]);
  await requestPptxPdfBase64(q.send, { sleep: noSleep });
  assert.equal(q.count(), 2);
});

/**
 * 503 is this app's own answer from the convert route when the deployment has no LibreOffice.
 * Retrying it only makes the user wait for the same sentence.
 */
test('a 503 fails immediately as unavailable, without a second attempt', async () => {
  const q = queue([failing(503, { error: 'LibreOffice is not available in this deployment' })]);
  await assert.rejects(
    () => requestPptxPdfBase64(q.send, { sleep: noSleep }),
    (error: unknown) => {
      assert.ok(isVisionUnavailable(error));
      assert.match((error as Error).message, /not available on this deployment/);
      return true;
    }
  );
  assert.equal(q.count(), 1);
});

/**
 * The bug this split exists to fix: every failure used to say "not available on this deployment",
 * which is plainly false to a user whose next upload of the same deck works.
 */
test('an exhausted retry reports a failed conversion, not an unavailable deployment', async () => {
  const q = queue([failing(500, { error: 'worker exited' }), failing(500, { error: 'worker exited' })]);
  await assert.rejects(
    () => requestPptxPdfBase64(q.send, { sleep: noSleep }),
    (error: unknown) => {
      assert.ok(error instanceof VisionConversionFailedError);
      assert.ok(!isVisionUnavailable(error));
      assert.match((error as Error).message, /already retried once/);
      assert.match((error as Error).message, /worker exited/);
      return true;
    }
  );
  assert.equal(q.count(), 2);
});

test('a refused request is not retried and does not promise that retrying helps', async () => {
  const q = queue([failing(413)]);
  await assert.rejects(
    () => requestPptxPdfBase64(q.send, { sleep: noSleep }),
    (error: unknown) => {
      assert.match((error as Error).message, /refused the request/);
      assert.match((error as Error).message, /HTTP 413/);
      assert.ok(!/already retried/.test((error as Error).message));
      return true;
    }
  );
  assert.equal(q.count(), 1);
});

test('a 200 carrying no PDF is treated as a failure, not as success', async () => {
  const q = queue([failing(200, { filename: 'deck.pdf' }), failing(200, {})]);
  await assert.rejects(
    () => requestPptxPdfBase64(q.send, { sleep: noSleep }),
    (error: unknown) => {
      assert.match((error as Error).message, /carried no PDF/);
      return true;
    }
  );
  assert.equal(q.count(), 2);
});

test('the retry waits before trying again', async () => {
  const waits: number[] = [];
  const q = queue([failing(500), ok()]);
  await requestPptxPdfBase64(q.send, { sleep: async ms => void waits.push(ms) });
  assert.deepEqual(waits, [1500]);
});
