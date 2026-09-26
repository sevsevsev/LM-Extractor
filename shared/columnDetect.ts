/**
 * Pure column-band detection for dense, image-only logic-model grids.
 *
 * The input is a per-x "ink profile": for each pixel column x, the fraction of
 * rows (0..1) that contain non-background ink. Column gutters show up as sustained
 * low-ink valleys between higher-ink content bands. This module is intentionally
 * free of any canvas / DOM dependency so it can be unit-tested directly.
 *
 * See docs/specs/extraction-provenance-and-color.md (column tiling section).
 */

export interface ColumnBand {
  /** Inclusive start x (pixels). */
  start: number;
  /** Exclusive end x (pixels). */
  end: number;
}

export interface ColumnBandOptions {
  /** A column with normalized ink <= this is treated as a gutter. */
  gutterMaxInk?: number;
  /** Minimum band width as a fraction of total width. */
  minBandFrac?: number;
  /** Gutters narrower than this fraction of total width are merged (not real separators). */
  minGutterFrac?: number;
  /** Plausible band counts; anything outside means "not a grid" → return []. */
  minBands?: number;
  maxBands?: number;
}

const DEFAULTS: Required<ColumnBandOptions> = {
  gutterMaxInk: 0.08,
  minBandFrac: 0.04,
  minGutterFrac: 0.012,
  minBands: 3,
  maxBands: 9,
};

/** Normalize an ink array to [0,1] using a high percentile so a thin full-width banner doesn't dominate. */
export function normalizeInk(ink: number[]): number[] {
  if (ink.length === 0) return [];
  const sorted = [...ink].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
  const denom = p95 > 0 ? p95 : Math.max(...ink) || 1;
  return ink.map(v => Math.min(1, v / denom));
}

/**
 * Detect vertical content bands (candidate logic-model columns) from an ink profile.
 * Returns [] when the profile does not look like a clean multi-column grid.
 */
export function findColumnBands(ink: number[], options: ColumnBandOptions = {}): ColumnBand[] {
  const opts = { ...DEFAULTS, ...options };
  const width = ink.length;
  if (width < 10) return [];

  const norm = normalizeInk(ink);
  const minBand = Math.max(1, Math.floor(width * opts.minBandFrac));
  const minGutter = Math.max(1, Math.floor(width * opts.minGutterFrac));

  // 1. Raw runs of non-gutter columns.
  const rawBands: ColumnBand[] = [];
  let runStart = -1;
  for (let x = 0; x < width; x++) {
    const isContent = norm[x] > opts.gutterMaxInk;
    if (isContent && runStart === -1) {
      runStart = x;
    } else if (!isContent && runStart !== -1) {
      rawBands.push({ start: runStart, end: x });
      runStart = -1;
    }
  }
  if (runStart !== -1) rawBands.push({ start: runStart, end: width });

  if (rawBands.length === 0) return [];

  // 2. Merge bands separated by gutters narrower than minGutter.
  const merged: ColumnBand[] = [rawBands[0]];
  for (let i = 1; i < rawBands.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = rawBands[i];
    if (cur.start - prev.end < minGutter) {
      prev.end = cur.end;
    } else {
      merged.push({ ...cur });
    }
  }

  // 3. Drop bands too narrow to be a real column.
  const bands = merged.filter(b => b.end - b.start >= minBand);

  if (bands.length < opts.minBands || bands.length > opts.maxBands) return [];
  return bands;
}
