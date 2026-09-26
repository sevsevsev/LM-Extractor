import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findColumnBands, normalizeInk } from './columnDetect.ts';

/** Build an ink profile: `bands` are [start,end] filled with `fill`, gutters get `base`. */
function profile(width: number, bands: [number, number][], fill = 1, base = 0): number[] {
  const ink = new Array(width).fill(base);
  for (const [s, e] of bands) {
    for (let x = s; x < e; x++) ink[x] = fill;
  }
  return ink;
}

test('detects six evenly spaced columns with clear gutters', () => {
  const width = 600;
  const cols: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const start = i * 100 + 10;
    cols.push([start, start + 80]);
  }
  const bands = findColumnBands(profile(width, cols));
  assert.equal(bands.length, 6);
  assert.ok(bands[0].start >= 8 && bands[0].start <= 12);
});

test('ignores a thin full-width banner baseline', () => {
  // Simulate a top banner adding a low baseline of ink to every column.
  const width = 600;
  const cols: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const start = i * 100 + 10;
    cols.push([start, start + 80]);
  }
  const ink = profile(width, cols, 1, 0.05); // 5% baseline everywhere
  const bands = findColumnBands(ink);
  assert.equal(bands.length, 6);
});

test('returns [] when there are no clear gutters (solid ink)', () => {
  const ink = new Array(400).fill(1);
  assert.deepEqual(findColumnBands(ink), []);
});

test('returns [] when band count is implausible (too few)', () => {
  const ink = profile(400, [[10, 380]]);
  assert.deepEqual(findColumnBands(ink), []);
});

test('merges narrow intra-column gaps but keeps wide gutters', () => {
  // Three columns, each split by a 2px hairline that should NOT count as a gutter.
  const width = 600;
  const ink = new Array(width).fill(0);
  const paint = (s: number, e: number) => { for (let x = s; x < e; x++) ink[x] = 1; };
  paint(20, 99); paint(101, 180); // col 1 with hairline at 100
  paint(220, 299); paint(301, 380); // col 2 with hairline at 300
  paint(420, 580); // col 3
  const bands = findColumnBands(ink);
  assert.equal(bands.length, 3);
});

test('normalizeInk scales by the 95th percentile', () => {
  const ink = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
  const norm = normalizeInk(ink);
  assert.ok(norm[9] <= 1);
  assert.ok(Math.max(...norm) <= 1);
});
