import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDocumentBundle } from './apiCore.ts';

test('parseDocumentBundle passes imageRefs through when valid', () => {
  // Regression: the server used to rebuild DocumentBundle from only images/textTrack/warnings/
  // sourceFormat, silently dropping imageRefs even though the client always sends it — so every
  // Track B image lost its page/column label downstream in geminiLogicModel.ts.
  const bundle = parseDocumentBundle({
    sourceFormat: 'pdf',
    images: ['img1', 'img2'],
    imageRefs: [{ page: 1 }, { page: 1, column: 2 }],
    textTrack: '',
    warnings: [],
  });
  assert.deepEqual(bundle?.imageRefs, [{ page: 1 }, { page: 1, column: 2 }]);
});

test('parseDocumentBundle omits imageRefs when absent (backward compatible)', () => {
  const bundle = parseDocumentBundle({
    sourceFormat: 'pdf',
    images: ['img1'],
    textTrack: '',
    warnings: [],
  });
  assert.equal(bundle?.imageRefs, undefined);
});

test('parseDocumentBundle falls back to undefined for a malformed imageRefs array rather than partially repairing it', () => {
  // A partial fix (dropping only the bad entries) would silently misalign imageRefs[i] with
  // images[i] for every index after the bad one — worse than the no-label fallback.
  const bundle = parseDocumentBundle({
    sourceFormat: 'pdf',
    images: ['img1', 'img2'],
    imageRefs: [{ page: 1 }, { page: 'not-a-number' }],
    textTrack: '',
    warnings: [],
  });
  assert.equal(bundle?.imageRefs, undefined);
});

test('parseDocumentBundle accepts an entry with only page, no column', () => {
  const bundle = parseDocumentBundle({
    sourceFormat: 'pdf',
    images: ['img1'],
    imageRefs: [{ page: 3 }],
    textTrack: '',
    warnings: [],
  });
  assert.deepEqual(bundle?.imageRefs, [{ page: 3 }]);
});

test('parseDocumentBundle still requires images or textTrack, unaffected by imageRefs', () => {
  const bundle = parseDocumentBundle({
    sourceFormat: 'pdf',
    images: [],
    imageRefs: [],
    textTrack: '',
    warnings: [],
  });
  assert.equal(bundle, null);
});
