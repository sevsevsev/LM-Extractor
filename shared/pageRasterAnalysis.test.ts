import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCanvasPixels,
  computeBboxFrac,
  computeColumnFracs,
  resolveContentScale,
  totalPayloadBytes,
} from './pageRasterAnalysis.ts';

/** Build an RGBA buffer and paint black rectangles onto a white page. */
function page(width: number, height: number, rects: [number, number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const o = (y * width + x) * 4;
        data[o] = 0;
        data[o + 1] = 0;
        data[o + 2] = 0;
      }
    }
  }
  return data;
}

test('a blank page has no content box', () => {
  const { bbox, inkProfile } = analyzeCanvasPixels(page(40, 40, []), 40, 40);
  assert.equal(bbox, null);
  assert.equal(inkProfile.length, 40);
  assert.ok(inkProfile.every(v => v === 0));
});

test('the content box is the ink bounds, with the far edge exclusive', () => {
  const { bbox } = analyzeCanvasPixels(page(40, 40, [[10, 12, 20, 25]]), 40, 40);
  assert.deepEqual(bbox, { x0: 10, y0: 12, x1: 20, y1: 25 });
});

test('near-white and transparent pixels count as background', () => {
  const width = 8;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  // A very pale pixel (above the 245 threshold) and a fully transparent black one.
  const pale = (1 * width + 1) * 4;
  data[pale] = 250;
  data[pale + 1] = 250;
  data[pale + 2] = 250;
  const ghost = (2 * width + 2) * 4;
  data[ghost] = 0;
  data[ghost + 1] = 0;
  data[ghost + 2] = 0;
  data[ghost + 3] = 0;
  assert.equal(analyzeCanvasPixels(data, width, height).bbox, null);
});

test('the ink profile is per-column and normalised by the rows actually sampled', () => {
  // Column 3 is inked on every row, column 5 on half of them.
  const { inkProfile } = analyzeCanvasPixels(page(8, 10, [[3, 0, 4, 10], [5, 0, 6, 5]]), 8, 10);
  assert.equal(inkProfile[3], 1);
  assert.equal(inkProfile[5], 0.5);
  assert.equal(inkProfile[0], 0);
});

test('row sampling steps on tall pages but still normalises to 1', () => {
  // Over 1000 rows the analyser samples every Nth row; a fully inked column must still read 1.
  const height = 2400;
  const { inkProfile } = analyzeCanvasPixels(page(4, height, [[1, 0, 2, height]]), 4, height);
  assert.equal(inkProfile[1], 1);
});

test('the fractional content box is padded and clamped to the page', () => {
  const frac = computeBboxFrac({ x0: 0, y0: 50, x1: 100, y1: 150 }, 100, 200);
  assert.deepEqual(frac, { x0: 0, y0: 0.24, x1: 1, y1: 0.76 });
});

test('no content box means no fractional box', () => {
  assert.equal(computeBboxFrac(null, 100, 100), null);
});

test('column bands are only cut on wide, image-dominant pages', () => {
  const bbox = { x0: 0, y0: 0, x1: 300, y1: 200 };
  // Three inked bands separated by clear gutters.
  const inkProfile = Array.from({ length: 300 }, (_, x) =>
    (x > 10 && x < 90) || (x > 110 && x < 190) || (x > 210 && x < 290) ? 1 : 0
  );
  const bands = computeColumnFracs(true, bbox, inkProfile);
  assert.ok(bands && bands.length >= 3, 'a three-column raster page should tile');
  assert.ok(bands.every(b => b.start >= 0 && b.end <= 1 && b.start < b.end));

  // A text page renders at whatever scale we choose, so tiling buys nothing.
  assert.equal(computeColumnFracs(false, bbox, inkProfile), null);
  // No content box means nothing to tile.
  assert.equal(computeColumnFracs(true, null, inkProfile), null);
});

test('a narrow or tall content box is not tiled', () => {
  const inkProfile = Array.from({ length: 300 }, () => 1);
  assert.equal(computeColumnFracs(true, { x0: 0, y0: 0, x1: 30, y1: 200 }, inkProfile), null);
  assert.equal(computeColumnFracs(true, { x0: 0, y0: 0, x1: 100, y1: 400 }, inkProfile), null);
});

test('image-dominant pages keep density under budget pressure; text pages give way', () => {
  // The contract that matters: a flattened raster never falls below its floor however hard the
  // global budget squeezes, because its glyphs have no other source of detail.
  assert.equal(resolveContentScale(true, 0.1, 2.5, 4.5, 3.2, 4.5), 3.2);
  assert.equal(resolveContentScale(true, 1, 2.5, 4.5, 3.2, 4.5), 4.5);
  assert.equal(resolveContentScale(false, 0.1, 2.5, 4.5, 3.2, 4.5), 1);
  assert.equal(resolveContentScale(false, 1, 2.5, 4.5, 3.2, 4.5), 2.5);
});

test('no scale ever exceeds the maximum', () => {
  assert.equal(resolveContentScale(true, 10, 2.5, 4.5, 3.2, 4.5), 4.5);
  assert.equal(resolveContentScale(false, 10, 2.5, 4.5, 3.2, 4.5), 4.5);
});

test('payload size sums the base64 lengths', () => {
  assert.equal(totalPayloadBytes([]), 0);
  assert.equal(totalPayloadBytes(['abcd', 'ef']), 6);
});
