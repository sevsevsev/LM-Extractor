import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleDocumentBundle } from './documentBundleAssembly.ts';
import { LOW_LEGIBILITY_WARNING, bundleImpliesLowLegibility } from '../types.ts';

test('a bundle carries its images, warnings, text and format through unchanged', () => {
  const bundle = assembleDocumentBundle('pdf', ['aaa', 'bbb'], ['some warning'], false, 'Track A');
  assert.deepEqual(bundle.images, ['aaa', 'bbb']);
  assert.deepEqual(bundle.warnings, ['some warning']);
  assert.equal(bundle.textTrack, 'Track A');
  assert.equal(bundle.sourceFormat, 'pdf');
});

test('low legibility adds the warning that downstream code reads', () => {
  const bundle = assembleDocumentBundle('pdf', ['a'], [], true, 'text');
  assert.ok(bundle.warnings.includes(LOW_LEGIBILITY_WARNING));
  assert.equal(bundleImpliesLowLegibility(bundle), true);
});

test('the low-legibility warning is not added twice when a converter already said it', () => {
  // The dedupe asks `bundleImpliesLowLegibility` rather than matching the string itself. A second,
  // independent matcher here once missed the DOCX wording and stacked two warnings on one bundle.
  const existing = ['This page rendered at low resolution and small print may be unreadable.'];
  const bundle = assembleDocumentBundle('docx', ['a'], existing, true, 'text');
  assert.equal(bundle.warnings.length, 1);
  assert.equal(bundleImpliesLowLegibility(bundle), true);
});

test('no low-legibility flag means no warning invented', () => {
  assert.deepEqual(assembleDocumentBundle('pdf', ['a'], [], false, 'text').warnings, []);
});

test('every Track A is stripped of binary payloads on the way out', () => {
  // The invariant is enforced here so it holds for every converter at once, not just the last one
  // someone fixed.
  const withPayload = `Real text\ndata:image/png;base64,${'A'.repeat(400)}\nMore text`;
  const bundle = assembleDocumentBundle('docx', [], [], false, withPayload);
  assert.ok(!bundle.textTrack.includes('A'.repeat(400)));
  assert.ok(bundle.textTrack.includes('Real text'));
  assert.ok(bundle.textTrack.includes('More text'));
});

test('preview images default to the extract images, and stay separate when supplied', () => {
  assert.deepEqual(assembleDocumentBundle('pdf', ['x'], [], false, '').previewImages, ['x']);
  assert.deepEqual(
    assembleDocumentBundle('pdf', ['x'], [], false, '', ['preview']).previewImages,
    ['preview']
  );
});

test('a text-only bundle has no images, previews or refs', () => {
  const bundle = assembleDocumentBundle('docx', [], [], false, 'only text');
  assert.deepEqual(bundle.images, []);
  assert.equal(bundle.previewImages, undefined);
  assert.equal(bundle.imageRefs, undefined);
});

test('image refs default to one page per image, in order', () => {
  const bundle = assembleDocumentBundle('pdf', ['a', 'b', 'c'], [], false, '');
  assert.deepEqual(bundle.imageRefs, [{ page: 1 }, { page: 2 }, { page: 3 }]);
});

test('supplied refs are kept only when there is one per image', () => {
  // A short ref list would silently mislabel provenance, so the safe default wins instead.
  const good = [{ page: 4, column: 1 }, { page: 4, column: 2 }];
  assert.deepEqual(assembleDocumentBundle('pdf', ['a', 'b'], [], false, '', undefined, good).imageRefs, good);
  assert.deepEqual(
    assembleDocumentBundle('pdf', ['a', 'b'], [], false, '', undefined, [{ page: 4 }]).imageRefs,
    [{ page: 1 }, { page: 2 }]
  );
});
