import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coercePptxRequestBytes,
  handlePptxConvertProbeRequest,
  handlePptxToPdfRequest,
} from './pptxConvertApi.ts';

const present = () => true;
const absent = () => false;
const fakeConvert = async () => ({
  data: new Uint8Array([1, 2, 3]),
  duration: 5,
  filename: 'deck.pdf',
});

/**
 * Regression, hosted run 2026-09-22: nine decks in a row reported "Couldn't read this document as
 * images". The route was answering 400 — the browser sent the file under its own OOXML content
 * type, and a serverless host parses the body by content type and hands the function `undefined`
 * for anything outside its short list. Nothing ever reached LibreOffice.
 *
 * `coercePptxRequestBytes` is what the serverless entry point asks before falling back to reading
 * the request stream, so a body it wrongly accepts is a 400 nobody can explain, and one it wrongly
 * rejects is a needless stream read.
 */
test('coercePptxRequestBytes takes every shape a host may hand over, and nothing else', () => {
  assert.deepEqual(coercePptxRequestBytes(Buffer.from([1, 2])), new Uint8Array([1, 2]));
  assert.deepEqual(coercePptxRequestBytes(new Uint8Array([3])), new Uint8Array([3]));
  assert.deepEqual(coercePptxRequestBytes(new Uint8Array([4]).buffer), new Uint8Array([4]));
  assert.deepEqual(
    coercePptxRequestBytes({ data: Buffer.from([9, 9]).toString('base64') }),
    new Uint8Array([9, 9])
  );
  // The hosted failure's actual shape, plus the near misses that must not pass for bytes.
  assert.equal(coercePptxRequestBytes(undefined), null);
  assert.equal(coercePptxRequestBytes(null), null);
  assert.equal(coercePptxRequestBytes(''), null);
  assert.equal(coercePptxRequestBytes({}), null);
  assert.equal(coercePptxRequestBytes({ data: '' }), null);
  assert.equal(coercePptxRequestBytes(Buffer.alloc(0)), null);
});

test('an empty body 400s and says what it did receive', async () => {
  const result = await handlePptxToPdfRequest(
    undefined,
    'deck.pptx',
    { wasmAvailable: present, convert: fakeConvert },
    'content-type "application/vnd.openxmlformats-officedocument.presentationml.presentation", body undefined'
  );
  assert.equal(result.status, 400);
  const error = (result.body as { error: string }).error;
  assert.match(error, /raw PPTX bytes/);
  // The diagnosis the hosted run could not give us: the content type it arrived under.
  assert.match(error, /presentationml/);
});

/**
 * Without this the loader fails deep inside the worker, the caller gets a 500 carrying a stack
 * trace, and the browser reports a generic conversion failure. The WASM assets are absent whenever
 * the deployment config does not name them: nothing imports them by path, so bundlers that ship a
 * function by tracing its imports leave all 237MB behind.
 */
test('missing WASM assets are a 503 that names the cause, before any init cost', async () => {
  let converted = false;
  const result = await handlePptxToPdfRequest(Buffer.from([1, 2, 3]), 'deck.pptx', {
    wasmAvailable: absent,
    convert: async () => {
      converted = true;
      return fakeConvert();
    },
  });
  assert.equal(result.status, 503);
  assert.match((result.body as { error: string }).error, /includeFiles/);
  assert.equal(converted, false, 'LibreOffice must not be started when its assets are missing');
});

test('a well-formed request converts and comes back as base64', async () => {
  const result = await handlePptxToPdfRequest(Buffer.from([1, 2, 3]), 'deck.pptx', {
    wasmAvailable: present,
    convert: fakeConvert,
  });
  assert.equal(result.status, 200);
  assert.equal((result.body as { pdfBase64: string }).pdfBase64, Buffer.from([1, 2, 3]).toString('base64'));
});

test('the probe answers without starting LibreOffice, both ways', () => {
  const ready = handlePptxConvertProbeRequest({ wasmAvailable: present });
  assert.deepEqual(ready.body, { ok: true, libreOfficeWasm: true });

  const missing = handlePptxConvertProbeRequest({ wasmAvailable: absent });
  assert.equal((missing.body as { libreOfficeWasm: boolean }).libreOfficeWasm, false);
  assert.match((missing.body as { error: string }).error, /WASM assets were not shipped/);
});
