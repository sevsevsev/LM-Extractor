import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bundleImpliesLowLegibility, bundleUsedTextOnlyFallback } from './types.ts';

test('bundleImpliesLowLegibility matches the flattened-raster warning', () => {
  assert.equal(
    bundleImpliesLowLegibility({ warnings: ['Source includes flattened-raster page(s); small text may be misread.'] }),
    true
  );
});

test('bundleImpliesLowLegibility matches "low resolution" (space)', () => {
  assert.equal(
    bundleImpliesLowLegibility({
      warnings: ['Page 3 of this document is a flattened image at low resolution, so small text may be misread.'],
    }),
    true
  );
});

test('bundleImpliesLowLegibility matches "low-resolution" (hyphen) — regression for a real batch-run gap', () => {
  // Found via a real 112-file batch: services/fileService.ts's DOCX embedded-image warning uses
  // the hyphenated form, but the old regex (`/low resolution/i`, space only) never matched it, so
  // this signal silently never fired for any DOCX with a low-res embedded image.
  assert.equal(
    bundleImpliesLowLegibility({
      warnings: ['Page 2 of this Word document contains a low-resolution embedded image, so small text may be misread.'],
    }),
    true
  );
});

test('bundleImpliesLowLegibility is false with no matching warnings', () => {
  assert.equal(bundleImpliesLowLegibility({ warnings: [] }), false);
  assert.equal(bundleImpliesLowLegibility({ warnings: ['Some unrelated note.'] }), false);
});

test('bundleUsedTextOnlyFallback is true when Track B has no images', () => {
  assert.equal(bundleUsedTextOnlyFallback({ images: [] }), true);
});

test('bundleUsedTextOnlyFallback is false when Track B has images', () => {
  assert.equal(bundleUsedTextOnlyFallback({ images: ['base64img'] }), false);
});
