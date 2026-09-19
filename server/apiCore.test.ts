import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDocumentBundle, parseDetectLogicModelGroupsInput } from './apiCore.ts';

const base = {
  sourceFormat: 'pdf',
  images: ['imgA', 'imgB'],
  textTrack: 'hello',
  warnings: [],
};

/**
 * Regression: `parseDocumentBundle` used to drop `imageRefs` entirely.
 *
 * `extractLogicModelOnServer` labels each Track B image with its real document page/column from
 * this field, and the extraction prompt's SOURCE LOCATION rules tell Gemini to read `sourcePage`
 * off that label. With the field dropped, every label degraded to a bare ordinal ("TRACK B image
 * 1 of 2") and every `sourcePage` the model returned was a guess — which then drove the
 * source-review page jump and the spot-check chips.
 */
test('parseDocumentBundle preserves imageRefs parallel to images', () => {
  const bundle = parseDocumentBundle({
    ...base,
    imageRefs: [{ page: 7, column: 2 }, { page: 8 }],
  });
  assert.ok(bundle);
  assert.deepEqual(bundle!.imageRefs, [{ page: 7, column: 2 }, { page: 8 }]);
});

test('parseDocumentBundle survives a JSON string body (non-Vercel hosts)', () => {
  const bundle = parseDocumentBundle(
    JSON.stringify({ ...base, imageRefs: [{ page: 3 }, { page: 4 }] })
  );
  assert.ok(bundle);
  assert.deepEqual(bundle!.imageRefs, [{ page: 3 }, { page: 4 }]);
});

test('parseDocumentBundle drops imageRefs that are not parallel to images', () => {
  // A misaligned ref is worse than none: it would label image 2 with image 1's page number and
  // teach the model a confidently wrong `sourcePage`.
  const bundle = parseDocumentBundle({ ...base, imageRefs: [{ page: 1 }] });
  assert.ok(bundle);
  assert.equal(bundle!.imageRefs, undefined);
});

test('parseDocumentBundle drops malformed imageRefs rather than guessing', () => {
  for (const bad of [
    [{ page: 'one' }, { page: 2 }],
    [{ page: 0 }, { page: 2 }],
    [{ page: 1 }, null],
    [{ page: 1 }, { page: Number.NaN }],
    'not-an-array',
  ]) {
    const bundle = parseDocumentBundle({ ...base, imageRefs: bad });
    assert.ok(bundle, `expected a bundle for imageRefs=${JSON.stringify(bad)}`);
    assert.equal(bundle!.imageRefs, undefined, `expected refs dropped for ${JSON.stringify(bad)}`);
  }
});

test('parseDocumentBundle rounds fractional page/column and omits an absent column', () => {
  const bundle = parseDocumentBundle({
    ...base,
    imageRefs: [{ page: 2.4, column: 3.6 }, { page: 5, column: 0 }],
  });
  assert.ok(bundle);
  assert.deepEqual(bundle!.imageRefs, [{ page: 2, column: 4 }, { page: 5 }]);
});

test('parseDocumentBundle omits imageRefs for a text-only bundle', () => {
  const bundle = parseDocumentBundle({
    sourceFormat: 'docx',
    images: [],
    textTrack: 'text only',
    warnings: [],
    imageRefs: [],
  });
  assert.ok(bundle);
  assert.equal(bundle!.imageRefs, undefined);
  assert.deepEqual(bundle!.images, []);
});

test('parseDocumentBundle rejects a bundle with neither images nor text', () => {
  assert.equal(parseDocumentBundle({ sourceFormat: 'pdf', images: [], textTrack: '  ' }), null);
  assert.equal(parseDocumentBundle({ images: ['a'], textTrack: 'x' }), null); // no sourceFormat
});

test('parseDetectLogicModelGroupsInput requires previewImages and a source format', () => {
  assert.equal(
    parseDetectLogicModelGroupsInput({ sourceFormat: 'pdf', previewImages: [], textTrack: '' }),
    null
  );
  assert.equal(parseDetectLogicModelGroupsInput({ previewImages: ['a'] }), null);
  const ok = parseDetectLogicModelGroupsInput({
    sourceFormat: 'pdf',
    previewImages: ['a', 'b'],
    textTrack: 't',
  });
  assert.deepEqual(ok, { previewImages: ['a', 'b'], textTrack: 't', sourceFormat: 'pdf' });
});
