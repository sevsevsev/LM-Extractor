import assert from 'node:assert/strict';
import test from 'node:test';
import { documentHashFromBytes, documentHashFromFile } from './documentHash.ts';

const bytesOf = (s: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(s);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
};

test('the hash is the leading 16 hex characters of the SHA-256 digest', async () => {
  // SHA-256('abc') is the standard test vector
  // ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad — so anyone can recompute a
  // cell of the CSV with `shasum -a 256 file | cut -c1-16` and get the same answer.
  assert.equal(await documentHashFromBytes(bytesOf('abc')), 'ba7816bf8f01cfea');
});

test('the same bytes hash the same and different bytes do not', async () => {
  const a = await documentHashFromBytes(bytesOf('a logic model'));
  const again = await documentHashFromBytes(bytesOf('a logic model'));
  const other = await documentHashFromBytes(bytesOf('a logic model '));
  assert.equal(a, again);
  assert.notEqual(a, other);
});

test('an empty document still hashes, rather than reading as unknown', async () => {
  // '' and "could not be computed" must not collapse to the same cell: an empty upload is a real
  // document that can be a duplicate of another empty upload.
  assert.equal(typeof (await documentHashFromBytes(bytesOf(''))), 'string');
});

test('a blob that cannot be read yields no hash instead of throwing', async () => {
  // A fingerprint is a diagnostic; failing to take one must never fail the extraction behind it.
  const unreadable = {
    arrayBuffer: () => Promise.reject(new Error('blob is gone')),
  } as unknown as Blob;
  assert.equal(await documentHashFromFile(unreadable), undefined);
});
