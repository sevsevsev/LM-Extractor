import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRawRequestBody, describeReceivedBody } from './rawBody.ts';
import type { FnRequest } from './fnTypes.ts';

function streamingRequest(chunks: (Uint8Array | string)[], rest: Partial<FnRequest> = {}): FnRequest {
  return {
    ...rest,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  } as unknown as FnRequest;
}

test('readRawRequestBody joins the chunks a host left unparsed', async () => {
  const bytes = await readRawRequestBody(
    streamingRequest([new Uint8Array([1, 2]), new Uint8Array([3])])
  );
  assert.deepEqual(bytes, new Uint8Array([1, 2, 3]));
});

test('readRawRequestBody returns null for a drained or non-streaming request', async () => {
  assert.equal(await readRawRequestBody(streamingRequest([])), null);
  assert.equal(await readRawRequestBody({ method: 'POST' }), null);
});

/**
 * The line that would have identified the hosted failure from the log alone, instead of from a
 * console message in someone's browser.
 */
test('describeReceivedBody names the content type and what the host parsed', () => {
  const described = describeReceivedBody({
    method: 'POST',
    headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
    body: undefined,
  });
  assert.match(described, /presentationml/);
  assert.match(described, /body undefined/);
});
