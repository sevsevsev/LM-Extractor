/**
 * What a rendered page LOOKS like, decided from its pixels: where the ink is, whether it splits
 * into columns, and how densely to render it.
 *
 * Extracted from `services/fileService.ts`, which had no test file at all despite being the layer
 * behind the renderer bug (#8). Nothing here touches a canvas or the DOM — `analyzeCanvasPixels`
 * takes the pixel array a caller already read out — so all of it is testable in Node, which is
 * the point of the move. Behaviour is unchanged; the code is the code that was there.
 */
import { findColumnBands } from './columnDetect.js';

const CONTENT_PAD_FRAC = 0.01; // padding around the detected content box
const ENABLE_COLUMN_TILING = true;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Base64 chars ≈ payload bytes, so summing lengths approximates the upload size. */
export const totalPayloadBytes = (images: string[]): number =>
  images.reduce((sum, img) => sum + img.length, 0);

/** Detect the ink bounding box + per-column ink profile from a rendered canvas. */
export function analyzeCanvasPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number
): { bbox: Box | null; inkProfile: number[] } {
  const ink = new Array(width).fill(0);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;

  const stepY = Math.max(1, Math.floor(height / 1000));
  let sampledRows = 0;

  for (let y = 0; y < height; y += stepY) {
    sampledRows++;
    const rowOff = y * width * 4;
    for (let x = 0; x < width; x++) {
      const o = rowOff + x * 4;
      const a = data[o + 3];
      // Treat near-white / transparent as background.
      if (a > 10 && (data[o] < 245 || data[o + 1] < 245 || data[o + 2] < 245)) {
        ink[x]++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }

  const inkProfile = ink.map(c => c / Math.max(1, sampledRows));
  const bbox = x1 >= x0 && y1 >= y0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null;
  return { bbox, inkProfile };
}

/** Content bbox (pixels) → padded fractional bbox against a canvas/probe of the given size. */
export function computeBboxFrac(bbox: Box | null, width: number, height: number): Box | null {
  if (!bbox) return null;
  const pad = CONTENT_PAD_FRAC;
  return {
    x0: Math.max(0, bbox.x0 / width - pad),
    y0: Math.max(0, bbox.y0 / height - pad),
    x1: Math.min(1, bbox.x1 / width + pad),
    y1: Math.min(1, bbox.y1 / height + pad),
  };
}

/**
 * Column bands: only meaningful for wide, image-dominant grid pages — splitting a page into
 * per-column TRACK B crops raises the effective resolution Gemini sees per column, which only
 * matters when the page is a flattened raster bounded by its own pixel density. A vector/text page
 * already renders at whatever scale the pipeline chooses, so tiling it adds column-provenance
 * labeling without a legibility benefit. Shared by the PDF and DOCX analyzers, which previously
 * duplicated this block with a divergent gate (DOCX omitted the `imageDominant` check) — found via
 * codebase audit (docs/specs/codebase-audit-2026-09-19.md #13).
 */
export function computeColumnFracs(
  imageDominant: boolean,
  bbox: Box | null,
  inkProfile: number[]
): { start: number; end: number }[] | null {
  if (!ENABLE_COLUMN_TILING || !imageDominant || !bbox) return null;
  const cropX0 = bbox.x0;
  const cropX1 = bbox.x1;
  const cropWidth = cropX1 - cropX0;
  const aspect = (bbox.x1 - bbox.x0) / Math.max(1, bbox.y1 - bbox.y0);
  if (cropWidth <= 40 || aspect <= 0.7) return null;
  const cropped = inkProfile.slice(cropX0, cropX1);
  const bands = findColumnBands(cropped);
  if (bands.length < 3) return null;
  return bands.map(b => ({ start: b.start / cropWidth, end: b.end / cropWidth }));
}

/**
 * Shared by the PDF and DOCX renderers: image-dominant content stays denser under budget
 * pressure — softened by `scaleFactor` but never below `dominantMin`, so Track-B-only content
 * keeps usable glyph density regardless of source format.
 */
export function resolveContentScale(
  imageDominant: boolean,
  scaleFactor: number,
  base: number,
  dominant: number,
  dominantMin: number,
  max: number
): number {
  if (imageDominant) {
    return Math.min(max, Math.max(dominantMin, dominant * scaleFactor));
  }
  return Math.min(max, Math.max(1, base * scaleFactor));
}
