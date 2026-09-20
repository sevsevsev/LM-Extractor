import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sliceDocumentBundle } from './documentBundleSlicing.ts';
import type { DocumentBundle } from '../types.ts';

function baseBundle(overrides: Partial<DocumentBundle> = {}): DocumentBundle {
  return {
    images: ['p1', 'p2', 'p3', 'p4'],
    imageRefs: [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }],
    previewImages: ['prev1', 'prev2', 'prev3', 'prev4'],
    textTrack: '## Page 1\n\nOrg A overview\n\n## Page 2\n\nOrg A grid\n\n## Page 3\n\nOrg B overview\n\n## Page 4\n\nOrg B grid',
    warnings: [],
    sourceFormat: 'pdf',
    ...overrides,
  };
}

test('sliceDocumentBundle renumbers previewImages to a fresh 1-based range', () => {
  const sliced = sliceDocumentBundle(baseBundle(), { start: 3, end: 4 });
  assert.deepEqual(sliced.previewImages, ['prev3', 'prev4']);
});

test('sliceDocumentBundle renumbers imageRefs pages relative to the slice', () => {
  const sliced = sliceDocumentBundle(baseBundle(), { start: 3, end: 4 });
  assert.deepEqual(sliced.images, ['p3', 'p4']);
  assert.deepEqual(sliced.imageRefs, [{ page: 1 }, { page: 2 }]);
});

test('sliceDocumentBundle preserves the column field on imageRefs while renumbering page', () => {
  const bundle = baseBundle({
    images: ['p3-c1', 'p3-c2'],
    imageRefs: [
      { page: 3, column: 1 },
      { page: 3, column: 2 },
    ],
  });
  const sliced = sliceDocumentBundle(bundle, { start: 3, end: 4 });
  assert.deepEqual(sliced.imageRefs, [
    { page: 1, column: 1 },
    { page: 1, column: 2 },
  ]);
});

test('sliceDocumentBundle keeps only the in-range textTrack sections, renumbered', () => {
  const sliced = sliceDocumentBundle(baseBundle(), { start: 3, end: 4 });
  assert.equal(sliced.textTrack, '## Page 1\n\nOrg B overview\n\n## Page 2\n\nOrg B grid');
});

test('sliceDocumentBundle slicing the first range starts at page 1 unchanged', () => {
  const sliced = sliceDocumentBundle(baseBundle(), { start: 1, end: 2 });
  assert.equal(sliced.textTrack, '## Page 1\n\nOrg A overview\n\n## Page 2\n\nOrg A grid');
  assert.deepEqual(sliced.previewImages, ['prev1', 'prev2']);
});

test('sliceDocumentBundle keeps the whole textTrack when it has no page markers at all (e.g. DOCX)', () => {
  const bundle = baseBundle({ textTrack: 'Flat continuous document text with no pagination.' });
  const sliced = sliceDocumentBundle(bundle, { start: 3, end: 4 });
  assert.equal(sliced.textTrack, 'Flat continuous document text with no pagination.');
});

test('sliceDocumentBundle preserves document-level (non-page-scoped) warnings and sourceFormat as-is', () => {
  const bundle = baseBundle({ warnings: ['Low resolution'], sourceFormat: 'pptx' });
  const sliced = sliceDocumentBundle(bundle, { start: 1, end: 2 });
  assert.deepEqual(sliced.warnings, ['Low resolution']);
  assert.equal(sliced.sourceFormat, 'pptx');
});

test('sliceDocumentBundle renumbers a page-scoped warning relative to the slice (audit #24 fix)', () => {
  const bundle = baseBundle({
    warnings: [
      'Page 4 of this document is a flattened image at low resolution, so small text may be misread. Verify the extracted wording against the original.',
    ],
  });
  const sliced = sliceDocumentBundle(bundle, { start: 3, end: 4 });
  assert.deepEqual(sliced.warnings, [
    'Page 2 of this document is a flattened image at low resolution, so small text may be misread. Verify the extracted wording against the original.',
  ]);
});

test('sliceDocumentBundle drops a page-scoped warning for a page outside this slice', () => {
  const bundle = baseBundle({
    warnings: ['Page 1 of this document is a flattened image at low resolution.'],
  });
  const sliced = sliceDocumentBundle(bundle, { start: 3, end: 4 });
  assert.deepEqual(sliced.warnings, []);
});

test('sliceDocumentBundle round-trips a single-page slice', () => {
  const sliced = sliceDocumentBundle(baseBundle(), { start: 2, end: 2 });
  assert.deepEqual(sliced.previewImages, ['prev2']);
  assert.deepEqual(sliced.imageRefs, [{ page: 1 }]);
  assert.equal(sliced.textTrack, '## Page 1\n\nOrg A grid');
});
