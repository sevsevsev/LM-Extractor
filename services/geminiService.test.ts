import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractLogicModel } from './geminiService.ts';
import type { DocumentBundle } from '../types.ts';

const bundle: DocumentBundle = {
  images: ['imgA'],
  textTrack: 'hello',
  warnings: [],
  sourceFormat: 'pdf',
};

function stubFetch(answers: { status: number; body: unknown }[]): () => number {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const answer = answers[Math.min(calls, answers.length - 1)];
    calls++;
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    } as Response;
  }) as typeof fetch;
  test.after(() => {
    globalThis.fetch = original;
  });
  return () => calls;
}

/**
 * The 504 report of 2026-11-10. The browser used to retry every 5xx three more times. For a
 * document that reaches the server's deadline every time, that is four waits of about a minute
 * ending in the same sentence, with one of the two batch slots held throughout. When the server
 * says the answer is not worth retrying, the browser asks once.
 */
test('a server answer marked not retryable is reported after one request', async () => {
  const calls = stubFetch([
    { status: 504, body: { error: 'The AI did not answer this document within 50 seconds.', code: 'model_timeout', retryable: false } },
  ]);
  await assert.rejects(extractLogicModel(bundle), /did not answer this document/);
  assert.equal(calls(), 1);
});

test('an ordinary transient failure is still retried', async () => {
  const calls = stubFetch([
    { status: 503, body: { error: 'unavailable' } },
    { status: 200, body: { model: { programName: 'x' } } },
  ]);
  const result = await extractLogicModel(bundle);
  assert.ok(result.model);
  assert.equal(calls(), 2);
});
