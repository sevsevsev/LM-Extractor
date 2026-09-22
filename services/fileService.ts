import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import TurndownService from 'turndown';
import { stripBinaryPayloads } from '../shared/textTrackHygiene';
import { findColumnBands } from './columnDetect';
import {
  parseSharedStrings,
  parseSheetGrid,
  parseSheetNames,
  countMarkdownSheets,
  sheetsToMarkdown,
  type XlsxSheet,
} from '../shared/xlsxGrid';
import {
  bundleImpliesLowLegibility,
  DocumentBundle,
  LOW_LEGIBILITY_WARNING,
  type SourceImageRef,
} from '../types';
import { polyfilledPdfWorkerSrc } from './pdfWorkerSrc';

// Not pdf.js's own worker URL directly: that worker is a separate realm and needs `polyfills.ts`
// installed inside it, or `Dict.merge` throws and embedded fonts silently fail to load.
pdfjsLib.GlobalWorkerOptions.workerSrc = polyfilledPdfWorkerSrc();

const MAX_VISION_PAGES = 15;

// Deliberate headroom under Vercel's ~4.5MB serverless request-body limit (README.md's documented
// figure); server.ts's local Express path allows 40mb and isLocalHost() below bypasses this budget
// entirely there, so it only ever binds the deployed Vercel path — found duplicated three times
// (services/fileService.ts, PDF render + DOCX render) with no shared constant or explanation via
// codebase audit (docs/specs/codebase-audit-2026-09-19.md #12).
const VISION_PAYLOAD_BUDGET_BYTES = 3_800_000;

/**
 * Operator codes that paint an embedded raster (as opposed to vector fills/strokes or outlined
 * text). A page can be "image-dominant" (near-zero extractable text) for two very different
 * reasons: it's a genuine flattened scan/screenshot, or it's vector art with text converted to
 * outline paths (common from design tools) — pdfjs reports no text objects either way, but only
 * the former is actually resolution-limited. See analyzePdfPage's `hasEmbeddedRaster`.
 */
const IMAGE_PAINT_OPS = new Set<number>([
  pdfjsLib.OPS.paintImageMaskXObject,
  pdfjsLib.OPS.paintImageMaskXObjectGroup,
  pdfjsLib.OPS.paintImageXObject,
  pdfjsLib.OPS.paintInlineImageXObject,
  pdfjsLib.OPS.paintInlineImageXObjectGroup,
  pdfjsLib.OPS.paintImageXObjectRepeat,
  pdfjsLib.OPS.paintImageMaskXObjectRepeat,
  pdfjsLib.OPS.paintSolidColorImageMask,
]);

/** [a, b, c, d, e, f] — PDF content-stream matrix, row-vector convention. */
type PdfMatrix = [number, number, number, number, number, number];
const IDENTITY_MATRIX: PdfMatrix = [1, 0, 0, 1, 0, 0];

/** `m1` applied first, then `m2` (matches how a PDF `cm` operator prepends into the CTM). */
function multiplyPdfMatrix(m1: PdfMatrix, m2: PdfMatrix): PdfMatrix {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

interface RasterPlacement {
  id: string;
  /** Rendered size of the image's unit square under the CTM at paint time, in PDF points. */
  widthPt: number;
  heightPt: number;
}

/**
 * Replay `save`/`restore`/`transform` alongside each image paint op to recover the CTM in effect
 * at paint time, then derive the on-page rendered size (in points) of that image's unit square —
 * this is what lets `analyzePdfPage` compare a raster's native pixel count against how large it's
 * actually displayed, instead of assuming a fixed absolute pixel floor regardless of placement.
 */
function trackImagePlacements(opList: { fnArray: number[]; argsArray: unknown[][] }): RasterPlacement[] {
  const placements: RasterPlacement[] = [];
  const stack: PdfMatrix[] = [IDENTITY_MATRIX];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    if (fn === pdfjsLib.OPS.save) {
      stack.push(stack[stack.length - 1]);
    } else if (fn === pdfjsLib.OPS.restore) {
      if (stack.length > 1) stack.pop();
    } else if (fn === pdfjsLib.OPS.transform) {
      const args = opList.argsArray[i] as number[];
      if (args?.length === 6) {
        const cm = args as PdfMatrix;
        stack[stack.length - 1] = multiplyPdfMatrix(cm, stack[stack.length - 1]);
      }
    } else if (IMAGE_PAINT_OPS.has(fn)) {
      const objId = opList.argsArray[i]?.[0];
      if (typeof objId === 'string') {
        const ctm = stack[stack.length - 1];
        placements.push({
          id: objId,
          widthPt: Math.hypot(ctm[0], ctm[1]),
          heightPt: Math.hypot(ctm[2], ctm[3]),
        });
      }
    }
  }
  return placements;
}

/** Internal PDF render result before assembling DocumentBundle. */
interface PdfRenderResult {
  images: string[];
  imageRefs: SourceImageRef[];
  previewImages: string[];
  warnings: string[];
  lowLegibility: boolean;
}

// --- Rendering tuning (see docs/specs/extraction-provenance-and-color.md) ---
const BASE_SCALE = 2.5; // text-layer (vector) pages — memory-efficient default
/**
 * Flattened-raster / scanned pages (no usable pdf.js text layer) need denser pixels so the
 * VLM can resolve small print. Prefer MAX_SCALE; budget softening may reduce this but never
 * below IMAGE_DOMINANT_MIN_SCALE (vector pages may go lower via GLOBAL_SCALE_FACTORS).
 */
const IMAGE_DOMINANT_SCALE = 4.5;
const IMAGE_DOMINANT_MIN_SCALE = 3.2;
const MAX_SCALE = 4.5;
const PROBE_SCALE = 1.25; // cheap pass to find the content box + column gutters
const CONTENT_PAD_FRAC = 0.01; // padding around the detected content box
const TEXT_DOMINANT_MIN_CHARS = 40; // fewer real characters ⇒ page is essentially an image
const LEGIBILITY_FLOOR_PX = 1150; // image-page content narrower than this ⇒ warn the user
/**
 * Native pixels per rendered inch, below which a raster asset is treated as genuinely
 * resolution-limited (real scans/screenshots) rather than a crisp flattened export. See the
 * "high-fidelity raster" check in analyzePdfPage. 300 DPI is a good scan; 150 is comfortably
 * readable; below ~110 small print starts genuinely degrading — set conservatively above that.
 */
const RASTER_NATIVE_DPI_FLOOR = 120;
const ENABLE_COLUMN_TILING = true;
/**
 * A very tall, narrow column tile buries small print. Split such tiles into vertical bands so each
 * crop is closer to square, which materially improves reading of the densest column (e.g. Resources).
 */
const MAX_TILE_ASPECT = 3.0;
const MAX_TILE_BANDS = 3;
const TILE_BAND_OVERLAP_FRAC = 0.04; // overlap so a box split across the seam stays readable once

/** JPEG quality tiers then global scale multipliers, tried in order until payload fits. */
const QUALITY_TIERS = [0.95, 0.85, 0.78, 0.72];
const GLOBAL_SCALE_FACTORS = [1, 0.8, 0.65, 0.5];

/**
 * DOCX raster-aware rendering shares the PDF path's content-crop / image-dominance /
 * column-tiling / legibility-floor logic (see docs/specs/extraction-provenance-and-color.md and
 * the "DOCX ingestion parity" follow-up). DOCX pages are DOM/CSS renders (docx-preview +
 * html2canvas) rather than pdfjs's native vector render, so unlike the PDF path's full
 * scale×quality budget grid, this does one analysis-informed render per section plus at most one
 * downgrade retry — html2canvas is materially more expensive per call than re-rendering a PDF
 * page from its vector source, so an exhaustive tier grid isn't worth the added latency here.
 */
const DOCX_PROBE_SCALE = 1.0;
const DOCX_IMAGE_DOMINANT_SCALE = 3.2;
const DOCX_IMAGE_DOMINANT_MIN_SCALE = 2.4;
const DOCX_MAX_SCALE = 3.5;
/** Embedded <img> area / section area at or above this fraction ⇒ treat the section as image-dominant. */
const DOCX_IMAGE_AREA_DOMINANT_FRAC = 0.35;
const DOCX_DOWNGRADE_QUALITY = 0.72;
const DOCX_DOWNGRADE_SCALE_FACTOR = 0.7;

/** Legacy fallback tiers used only if the analysis pipeline throws. */
const RENDER_TIERS: { scale: number; quality: number }[] = [
  { scale: 2.5, quality: 0.92 },
  { scale: 2.0, quality: 0.85 },
  { scale: 1.6, quality: 0.8 },
  { scale: 1.25, quality: 0.72 },
];

const isLocalHost = (): boolean =>
  typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

/** Base64 chars ≈ payload bytes, so summing lengths approximates the upload size. */
const totalPayloadBytes = (images: string[]): number =>
  images.reduce((sum, img) => sum + img.length, 0);

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface PageAnalysis {
  pageNumber: number;
  pageWidthPt: number;
  imageDominant: boolean;
  /**
   * True when the page's content stream paints at least one raster image (scan, screenshot,
   * flattened export). False when `imageDominant` came from a lack of text objects alone (e.g.
   * vector art / outlined text) — that content is resolution-independent, not a flattened raster.
   */
  hasEmbeddedRaster: boolean;
  /** Content bounding box as fractions [0..1] of the page, or null when not detected. */
  bboxFrac: Box | null;
  /** Column band boundaries as fractions of the cropped content width, or null. */
  columnFracs: { start: number; end: number }[] | null;
}

/** Detect the ink bounding box + per-column ink profile from a rendered canvas. */
function analyzeCanvasPixels(
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
function computeBboxFrac(bbox: Box | null, width: number, height: number): Box | null {
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
function computeColumnFracs(
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

/** Cheap probe render → content box (fractional) + column bands + image-dominance flag. */
async function analyzePdfPage(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>['getPage']>>,
  pageNumber: number
): Promise<PageAnalysis> {
  const baseViewport = page.getViewport({ scale: 1 });
  const pageWidthPt = baseViewport.width;

  let textChars = 0;
  try {
    const textContent = await page.getTextContent();
    textChars = textContent.items.reduce(
      (sum, item) => sum + ('str' in item && typeof item.str === 'string' ? item.str.trim().length : 0),
      0
    );
  } catch {
    textChars = 0;
  }
  const imageDominant = textChars < TEXT_DOMINANT_MIN_CHARS;

  let hasEmbeddedRaster = false;
  let placements: RasterPlacement[] = [];
  if (imageDominant) {
    try {
      const opList = await page.getOperatorList();
      placements = trackImagePlacements(opList);
      hasEmbeddedRaster = placements.length > 0;
    } catch {
      // Unknown either way — err toward the conservative (always-risky) treatment.
      hasEmbeddedRaster = true;
    }
  }

  const viewport = page.getViewport({ scale: PROBE_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { pageNumber, pageWidthPt, imageDominant, hasEmbeddedRaster, bboxFrac: null, columnFracs: null };
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;

  // A page can have embedded raster content for two very different reasons: a genuine flattened
  // scan/screenshot (resolution-limited — upscaling it to clear the render-size floor below just
  // interpolates, it doesn't recover real detail) or a crisp flattened design-tool export (Canva,
  // Figma, PowerPoint-to-PDF) that happens to have no real text layer but is natively high-DPI.
  // Only the former is actually risky. Distinguish by comparing each raster asset's *native* pixel
  // count against how large it's actually placed on the page (via the CTM in effect when it was
  // painted, from `placements` above) — a real DPI-equivalent, not a fixed absolute pixel count,
  // so it isn't fooled by a naturally-small/thin asset (e.g. a letterhead banner) that's genuinely
  // high-resolution for its size. Applies regardless of how many raster objects the page has —
  // found via a real batch audit that a single well-exported flattened page was getting the same
  // "always risky" treatment as an actual low-DPI scan, discarding accurate extractions.
  if (hasEmbeddedRaster) {
    const worstDpiById = new Map<string, number>();
    for (const p of placements) {
      if (p.widthPt <= 0 || p.heightPt <= 0) continue;
      const obj = page.objs.has(p.id)
        ? (page.objs.get(p.id) as { width?: number; height?: number } | null)
        : null;
      const nativeW = typeof obj?.width === 'number' ? obj.width : 0;
      const nativeH = typeof obj?.height === 'number' ? obj.height : 0;
      if (nativeW <= 0 || nativeH <= 0) {
        worstDpiById.set(p.id, 0);
        continue;
      }
      const dpiX = nativeW / (p.widthPt / 72);
      const dpiY = nativeH / (p.heightPt / 72);
      const dpi = Math.min(dpiX, dpiY);
      // A given asset can be painted more than once (e.g. tiled) — keep its worst (largest
      // rendered, i.e. lowest-effective-DPI) instance, matching "trust only if ALL are
      // comfortably high-resolution."
      const prev = worstDpiById.get(p.id);
      if (prev === undefined || dpi < prev) worstDpiById.set(p.id, dpi);
    }
    const allHighFidelity =
      worstDpiById.size > 0 &&
      Array.from(worstDpiById.values()).every(dpi => dpi >= RASTER_NATIVE_DPI_FLOOR);
    // Trust it like vector content — fall through to the contentPx-vs-floor check instead of
    // the blanket "always risky" treatment.
    if (allHighFidelity) hasEmbeddedRaster = false;
  }

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { bbox, inkProfile } = analyzeCanvasPixels(data, canvas.width, canvas.height);

  const bboxFrac = computeBboxFrac(bbox, canvas.width, canvas.height);
  const columnFracs = computeColumnFracs(imageDominant, bbox, inkProfile);

  return { pageNumber, pageWidthPt, imageDominant, hasEmbeddedRaster, bboxFrac, columnFracs };
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

/**
 * Shared by the PDF and DOCX renderers: image-dominant content stays denser under budget
 * pressure — softened by `scaleFactor` but never below `dominantMin`, so Track-B-only content
 * keeps usable glyph density regardless of source format.
 */
function resolveContentScale(
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

/**
 * Per-page viewport scale: textless (flattened-raster) pages stay at high DPI; vector pages
 * use BASE_SCALE. Global budget `scaleFactor` softens both, but raster pages never drop below
 * IMAGE_DOMINANT_MIN_SCALE so Track-B-only docs keep usable glyph density.
 */
function resolvePageScale(analysis: PageAnalysis, scaleFactor: number): number {
  return resolveContentScale(
    analysis.imageDominant,
    scaleFactor,
    BASE_SCALE,
    IMAGE_DOMINANT_SCALE,
    IMAGE_DOMINANT_MIN_SCALE,
    MAX_SCALE
  );
}

/** Draw a sub-rectangle of a source canvas onto a fresh canvas and return it. */
function cropCanvas(
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement | null {
  const w = Math.max(1, Math.round(sw));
  const h = Math.max(1, Math.round(sh));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, Math.round(sx), Math.round(sy), w, h, 0, 0, w, h);
  return out;
}

/**
 * Split an over-tall column tile into top→bottom bands (with slight overlap) so the densest
 * small print gets a larger share of the model's attention. Returns the tile unchanged when short.
 */
function splitTallTile(tile: HTMLCanvasElement): HTMLCanvasElement[] {
  const aspect = tile.height / Math.max(1, tile.width);
  if (aspect <= MAX_TILE_ASPECT) return [tile];

  const bands = Math.min(MAX_TILE_BANDS, Math.ceil(aspect / MAX_TILE_ASPECT));
  const bandHeight = tile.height / bands;
  const overlap = bandHeight * TILE_BAND_OVERLAP_FRAC;

  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < bands; i++) {
    const y0 = Math.max(0, i * bandHeight - (i > 0 ? overlap : 0));
    const y1 = Math.min(tile.height, (i + 1) * bandHeight + (i < bands - 1 ? overlap : 0));
    const slice = cropCanvas(tile, 0, y0, tile.width, y1 - y0);
    if (slice) out.push(slice);
  }
  return out.length ? out : [tile];
}

/** One page’s extract tiles + a single preview JPEG for the source pane. */
interface PageRenderResult {
  extractImages: string[];
  imageRefs: SourceImageRef[];
  previewImage: string;
}

/** Render one page (cropped to content) plus optional per-column tiles for grid pages. */
async function renderAnalyzedPage(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>['getPage']>>,
  analysis: PageAnalysis,
  scaleFactor: number,
  quality: number
): Promise<PageRenderResult> {
  const scale = resolvePageScale(analysis, scaleFactor);

  const viewport = page.getViewport({ scale });
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.ceil(viewport.width);
  fullCanvas.height = Math.ceil(viewport.height);
  const ctx = fullCanvas.getContext('2d');
  if (!ctx) {
    return { extractImages: [], imageRefs: [], previewImage: '' };
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);
  await page.render({ canvasContext: ctx, canvas: fullCanvas, viewport }).promise;

  // Crop to the detected content box to stop spending pixels on white margins.
  const bbox = analysis.bboxFrac;
  let contentCanvas: HTMLCanvasElement = fullCanvas;
  let contentX0 = 0;
  let contentWidth = fullCanvas.width;
  if (bbox && (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0) < 0.93) {
    const sx = bbox.x0 * fullCanvas.width;
    const sy = bbox.y0 * fullCanvas.height;
    const sw = (bbox.x1 - bbox.x0) * fullCanvas.width;
    const sh = (bbox.y1 - bbox.y0) * fullCanvas.height;
    const cropped = cropCanvas(fullCanvas, sx, sy, sw, sh);
    if (cropped) {
      contentCanvas = cropped;
      contentX0 = sx;
      contentWidth = cropped.width;
    }
  }

  const previewImage = encodeCanvas(contentCanvas, quality);
  const pageNum = analysis.pageNumber;

  // When we confidently found columns on an image-only grid, send zoomed per-column
  // tiles INSTEAD of the whole page: max legibility, clear column identity, no double-count.
  // Source review still uses previewImage (full content crop).
  if (analysis.columnFracs && analysis.columnFracs.length >= 3) {
    const tiles: string[] = [];
    const refs: SourceImageRef[] = [];
    let columnIndex = 0;
    for (const band of analysis.columnFracs) {
      columnIndex += 1;
      const bx = contentX0 + band.start * contentWidth;
      const bw = (band.end - band.start) * contentWidth;
      const tile = cropCanvas(contentCanvas, bx - contentX0, 0, bw, contentCanvas.height);
      if (!tile) continue;
      for (const sub of splitTallTile(tile)) {
        tiles.push(encodeCanvas(sub, quality));
        refs.push({ page: pageNum, column: columnIndex });
      }
    }
    if (tiles.length >= 3) {
      return { extractImages: tiles, imageRefs: refs, previewImage };
    }
  }

  return {
    extractImages: [previewImage],
    imageRefs: [{ page: pageNum }],
    previewImage,
  };
}

async function convertPdfWithAnalysis(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  pageCount: number
): Promise<PdfRenderResult> {
  const warnings: string[] = [];
  const budgetBytes = isLocalHost() ? Number.POSITIVE_INFINITY : VISION_PAYLOAD_BUDGET_BYTES;

  const pages = [];
  const analyses: PageAnalysis[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    pages.push(page);
    analyses.push(await analyzePdfPage(page, i));
  }

  const hasImageDominant = analyses.some(a => a.imageDominant);
  const hasVectorPages = analyses.some(a => !a.imageDominant);

  async function renderAllPagesAt(
    vectorScaleFactor: number,
    imageDominantScaleFactor: number,
    quality: number
  ): Promise<{ rendered: string[]; refs: SourceImageRef[]; previews: string[] }> {
    const rendered: string[] = [];
    const refs: SourceImageRef[] = [];
    const previews: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const scaleFactor = analyses[i].imageDominant ? imageDominantScaleFactor : vectorScaleFactor;
      const pageResult = await renderAnalyzedPage(pages[i], analyses[i], scaleFactor, quality);
      rendered.push(...pageResult.extractImages);
      refs.push(...pageResult.imageRefs);
      if (pageResult.previewImage) previews.push(pageResult.previewImage);
    }
    return { rendered, refs, previews };
  }

  let images: string[] = [];
  let imageRefs: SourceImageRef[] = [];
  let previewImages: string[] = [];
  let usedImageDominantScaleFactor = 1;
  let fitBudget = false;

  const record = (
    attempt: { rendered: string[]; refs: SourceImageRef[]; previews: string[] },
    imageDominantScaleFactor: number
  ): boolean => {
    images = attempt.rendered;
    imageRefs = attempt.refs;
    previewImages = attempt.previews;
    usedImageDominantScaleFactor = imageDominantScaleFactor;
    return totalPayloadBytes(attempt.rendered) <= budgetBytes;
  };

  // Phase 1: quality loss first (less harmful to legibility than shrinking pixel dimensions),
  // then reduce scale — but only on vector/text-layer pages. Those have Track A's real text as a
  // fallback if the render comes out soft; image-dominant pages have no such backup (Track B is
  // the only source of truth for wording, layout, and colour there), so this protects them from
  // the payload budget for as long as vector-page softening alone can satisfy it.
  if (hasVectorPages) {
    phase1: for (const quality of QUALITY_TIERS) {
      for (const vectorScaleFactor of GLOBAL_SCALE_FACTORS) {
        const attempt = await renderAllPagesAt(vectorScaleFactor, 1, quality);
        fitBudget = record(attempt, 1);
        if (fitBudget) break phase1;
      }
    }
  }

  // Phase 2 (last resort): vector-only softening wasn't enough to hit budget — or every page is
  // image-dominant, so there was nothing to protect them with — so soften image-dominant pages
  // too, same uniform behaviour as before this change.
  if (!fitBudget && hasImageDominant) {
    phase2: for (const quality of QUALITY_TIERS) {
      for (const scaleFactor of GLOBAL_SCALE_FACTORS) {
        const attempt = await renderAllPagesAt(scaleFactor, scaleFactor, quality);
        fitBudget = record(attempt, scaleFactor);
        if (fitBudget) break phase2;
      }
    }
  }

  // Legibility warning for flattened-raster pages that came out small.
  let lowLegibility = false;
  for (const a of analyses) {
    if (!a.imageDominant || !a.bboxFrac) continue;
    const scale = resolvePageScale(a, usedImageDominantScaleFactor);
    const contentPx = (a.bboxFrac.x1 - a.bboxFrac.x0) * a.pageWidthPt * scale;
    if (a.hasEmbeddedRaster) {
      // A genuine flattened raster is inherently risky: rendering above its native resolution
      // interpolates rather than recovers detail, so always signal the extractor even if this
      // render cleared the legibility floor.
      lowLegibility = true;
    } else if (contentPx < LEGIBILITY_FLOOR_PX) {
      // No text layer, but also no embedded raster — vector art / outlined text (common from
      // design-tool exports). That's resolution-independent, so only flag it when the render
      // itself actually came out small (e.g. under hosted-deployment budget pressure).
      lowLegibility = true;
    }
    if (contentPx < LEGIBILITY_FLOOR_PX) {
      warnings.push(
        `Page ${a.pageNumber} of this document is a flattened image at low resolution, so small text may be misread. Verify the extracted wording against the original.`
      );
    }
  }

  return { images, imageRefs, previewImages, warnings, lowLegibility };
}

/** Legacy tier renderer — used only when the analysis pipeline throws. */
const renderPdfAtTier = async (
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  pageCount: number,
  tier: { scale: number; quality: number }
): Promise<string[]> => {
  const images: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: tier.scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    if (context) {
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      images.push(encodeCanvas(canvas, tier.quality));
    }
  }
  return images;
};

async function convertPdfWithLegacyTiers(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  pageCount: number
): Promise<string[]> {
  const budgetBytes = isLocalHost() ? Number.POSITIVE_INFINITY : VISION_PAYLOAD_BUDGET_BYTES;
  let images: string[] = [];
  for (const tier of RENDER_TIERS) {
    images = await renderPdfAtTier(pdf, pageCount, tier);
    if (totalPayloadBytes(images) <= budgetBytes) return images;
  }
  return images;
}

/** Pull text-layer content from an already-loaded PDF (Track A). */
/**
 * A text run meaningfully taller than the page's typical run height is treated as a probable
 * heading. Glyph height (via `item.height` / the transform's scale term) is on every pdfjs
 * TextItem and is the standard, robust PDF heading signal. Deliberately NOT attempting bold-weight
 * detection: that needs resolving `item.fontName` through `page.commonObjs`, an internal-ish pdfjs
 * API whose behavior isn't guaranteed to be stable across versions (we were burned by exactly this
 * kind of pdfjs internals assumption once already this project — see the getOrInsertComputed
 * polyfill). Height is public, stable, and does the same job for the common case (headings are
 * bigger, not just bold).
 */
const HEADING_SIZE_RATIO = 1.35;
const HEADING_MAX_CHARS = 120;

interface PdfTextLine {
  text: string;
  maxHeight: number;
}

/**
 * pdfjs emits text as per-run fragments (mixed with TextMarkedContent items with no `str`), not
 * lines — group by `hasEOL` to reconstruct lines. Takes the raw `getTextContent().items` union
 * directly rather than pre-filtering to a narrower type, since pdfjs-dist doesn't re-export
 * `TextItem` from its package root for a clean type-predicate narrowing.
 */
function groupTextItemsIntoLines(items: unknown[]): PdfTextLine[] {
  const lines: PdfTextLine[] = [];
  let cur: string[] = [];
  let curMaxHeight = 0;
  const flush = () => {
    const text = cur.join(' ').replace(/\s+/g, ' ').trim();
    if (text) lines.push({ text, maxHeight: curMaxHeight });
    cur = [];
    curMaxHeight = 0;
  };
  for (const raw of items) {
    const item = raw as { str?: unknown; height?: unknown; transform?: unknown; hasEOL?: unknown };
    if (typeof item.str === 'string' && item.str) {
      cur.push(item.str);
      const height = typeof item.height === 'number' ? item.height : 0;
      const transformScale =
        Array.isArray(item.transform) && typeof item.transform[3] === 'number' ? item.transform[3] : 0;
      const h = Math.abs(height || transformScale);
      if (h > curMaxHeight) curMaxHeight = h;
    }
    if (item.hasEOL) flush();
  }
  flush();
  return lines;
}

/**
 * Track A for PDF: page text plus a lightweight structural signal. Lines whose glyph height
 * clears the page's typical (median) height by HEADING_SIZE_RATIO render as Markdown ATX
 * headings, giving the extraction prompt the same kind of heading/emphasis signal DOCX's Track A
 * already gets from Mammoth's style map — PDF's raw text layer otherwise carries none at all.
 */
async function textTrackFromPdf(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  maxPages = 2
): Promise<string> {
  const pageCount = Math.min(pdf.numPages, maxPages);
  let fullText = '';
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const lines = groupTextItemsIntoLines(textContent.items);

    const heights = lines.map(l => l.maxHeight).filter(h => h > 0);
    const sortedHeights = [...heights].sort((a, b) => a - b);
    const medianHeight = sortedHeights.length ? sortedHeights[Math.floor(sortedHeights.length / 2)] : 0;
    const headingThreshold = medianHeight * HEADING_SIZE_RATIO;

    const pageText = lines
      .map(line => {
        const isHeadingSize =
          medianHeight > 0 && line.maxHeight >= headingThreshold && line.text.length <= HEADING_MAX_CHARS;
        return isHeadingSize ? `### ${line.text}` : line.text;
      })
      .join('\n');

    fullText += `\n\n## Page ${i}\n\n${pageText}`;
  }
  return fullText.trim();
}

function assembleDocumentBundle(
  sourceFormat: DocumentBundle['sourceFormat'],
  images: string[],
  warnings: string[],
  lowLegibility: boolean,
  textTrack: string,
  previewImages?: string[],
  imageRefs?: SourceImageRef[]
): DocumentBundle {
  const mergedWarnings = [...warnings];
  // Dedupe against `bundleImpliesLowLegibility`'s own matcher (types.ts) rather than a second,
  // independent one — a hyphen-only/case-sensitive copy here previously missed the DOCX embedded-image
  // warning's spaced "low resolution" wording, so this pushed LOW_LEGIBILITY_WARNING on top of it
  // instead of deduping — found via codebase audit (docs/specs/codebase-audit-2026-09-19.md #9).
  if (lowLegibility && !bundleImpliesLowLegibility({ warnings: mergedWarnings })) {
    mergedWarnings.push(LOW_LEGIBILITY_WARNING);
  }
  const previews =
    previewImages && previewImages.length > 0
      ? previewImages
      : images.length > 0
        ? images
        : undefined;
  const refs =
    imageRefs && imageRefs.length === images.length
      ? imageRefs
      : images.map((_, i) => ({ page: i + 1 }));
  return {
    images,
    imageRefs: images.length ? refs : undefined,
    previewImages: previews,
    // Every converter's Track A funnels through here, so this is where the invariant "no binary
    // payloads in the text we send to Gemini" is enforced for all of them at once rather than for
    // whichever path was fixed last. See `shared/textTrackHygiene.ts`.
    textTrack: stripBinaryPayloads(textTrack),
    warnings: mergedWarnings,
    sourceFormat,
  };
}

/** PDF dual-track ingest: page rasters (Track B) + front-matter text (Track A). */
export const convertPdfToImages = async (file: File): Promise<DocumentBundle> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pageCount = Math.min(pdf.numPages, MAX_VISION_PAGES);

    const warnings: string[] = [];
    if (pdf.numPages > MAX_VISION_PAGES) {
      warnings.push(
        `This document has ${pdf.numPages} pages; only the first ${MAX_VISION_PAGES} were analyzed.`
      );
    }

    // Cover the same pages Track B actually analyzes, so the text-layer fallback (e.g. recovering a
    // dropped Impact Statement) isn't blind to pages 3+ on every multi-page PDF.
    const textTrack = await textTrackFromPdf(pdf, pageCount);

    try {
      const result = await convertPdfWithAnalysis(pdf, pageCount);
      return assembleDocumentBundle(
        'pdf',
        result.images,
        [...warnings, ...result.warnings],
        result.lowLegibility,
        textTrack,
        result.previewImages,
        result.imageRefs
      );
    } catch (analysisError) {
      console.warn('Analysis render failed; falling back to tier rendering:', analysisError);
      const images = await convertPdfWithLegacyTiers(pdf, pageCount);
      // Fallback skipped analysis, so assume the worst and let extraction flag risky tokens.
      return assembleDocumentBundle('pdf', images, warnings, true, textTrack);
    }
  } catch (error) {
    console.error('PDF Image Conversion Error:', error);
    throw new Error('Failed to convert PDF to images for analysis.');
  }
};

/** Letter-ish slice height at DOCX_RENDER_WIDTH (1000 × 11/8.5). */
const DOCX_RENDER_WIDTH_PX = 1000;
const DOCX_SLICE_HEIGHT_PX = Math.round(DOCX_RENDER_WIDTH_PX * (11 / 8.5));
const DOCX_VISION_SCALE = 1.75;
const DOCX_JPEG_QUALITY = 0.85;

/** Mammoth style map → semantic HTML so Turndown yields clean ATX Markdown. */
const DOCX_MAMMOTH_STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Subtitle'] => h2:fresh",
  'b => strong',
  'i => em',
];

function createDocxTurndown(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  // Mammoth inlines embedded images as `data:` URIs and Turndown's default `img` handling renders
  // them straight into Track A. One DOCX logo made 87% of a 38,994-character text track (~8,400
  // tokens per call) unreadable base64 — friction-log session 20. The same images already reach
  // Gemini as Track B page rasters, so dropping them here costs nothing.
  //
  // Alt text goes with them: in the observed case it was the image's own googleusercontent URL,
  // which is noise of the same kind. `stripBinaryPayloads` is the backstop if anything slips past.
  turndown.addRule('dropImagePayloads', { filter: 'img', replacement: () => '' });
  return turndown;
}

/** Track A: DOCX → HTML (mammoth) → Markdown (turndown), preserving headers/lists/bold. */
async function docxArrayBufferToMarkdown(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    { styleMap: DOCX_MAMMOTH_STYLE_MAP, includeDefaultStyleMap: true }
  );
  const markdown = createDocxTurndown().turndown(result.value || '').trim();
  return markdown;
}

function encodeCanvasJpeg(canvas: HTMLCanvasElement, quality = DOCX_JPEG_QUALITY): string {
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}

/** Slice a tall canvas into fixed-height JPEG bands (fallback when page breaks are absent). */
function sliceCanvasToJpegs(
  source: HTMLCanvasElement,
  sliceHeightPx: number,
  maxTiles: number
): string[] {
  const images: string[] = [];
  const width = source.width;
  const height = source.height;
  if (width <= 0 || height <= 0) return images;

  // Scale CSS slice height to canvas pixels (html2canvas scale multiplies dimensions).
  const band = Math.max(1, Math.round(sliceHeightPx));
  for (let y = 0; y < height && images.length < maxTiles; y += band) {
    const bandH = Math.min(band, height - y);
    // Skip near-empty trailing bands (whitespace after last content).
    if (bandH < 8) break;

    const tile = document.createElement('canvas');
    tile.width = width;
    tile.height = bandH;
    const ctx = tile.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, bandH);
    ctx.drawImage(source, 0, y, width, bandH, 0, 0, width, bandH);
    images.push(encodeCanvasJpeg(tile));
  }
  return images;
}

interface DocxSectionAnalysis {
  imageDominant: boolean;
  /**
   * True only when `imageDominant` AND at least one driving embedded image is genuinely
   * low-resolution for how large it's displayed — see the native-DPI check below. Drives
   * `lowLegibility`; kept separate from `imageDominant` (which still drives render scale — a
   * bigger canvas never hurts, even for a crisp source image) the same way the PDF path separates
   * `hasEmbeddedRaster` from `imageDominant`.
   */
  hasLowResEmbeddedImage: boolean;
  bboxFrac: Box | null;
  columnFracs: { start: number; end: number }[] | null;
}

/** Assumed physical page width behind `DOCX_RENDER_WIDTH_PX`, for converting display px to inches. */
const DOCX_PAGE_WIDTH_IN = 8.5;

/** Cheap probe render → content box + column bands + embedded-image dominance. Mirrors analyzePdfPage. */
async function analyzeDocxSection(el: HTMLElement): Promise<DocxSectionAnalysis> {
  const probe = await html2canvas(el, {
    scale: DOCX_PROBE_SCALE,
    useCORS: true,
    backgroundColor: '#ffffff',
  });
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { imageDominant: false, hasLowResEmbeddedImage: false, bboxFrac: null, columnFracs: null };
  const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
  const { bbox, inkProfile } = analyzeCanvasPixels(data, probe.width, probe.height);

  // Image-dominance for DOCX means "a large embedded raster (photo/screenshot) drives this
  // section" — unlike a PDF page, a Word page is never itself a flattened scan, but it can
  // embed one, which carries the same small-print legibility risk.
  const elRect = el.getBoundingClientRect();
  const elArea = Math.max(1, elRect.width * elRect.height);
  const images = Array.from(el.querySelectorAll('img'));
  let imgArea = 0;
  for (const img of images) {
    const r = img.getBoundingClientRect();
    imgArea += Math.max(0, r.width) * Math.max(0, r.height);
  }
  const imageDominant = imgArea / elArea >= DOCX_IMAGE_AREA_DOMINANT_FRAC;

  // Same false-positive shape as the PDF path (see extraction-provenance-and-color.md §7): a
  // section can be "image-dominant" by area while its embedded image is natively high-resolution
  // (a crisp infographic/diagram displayed at or below its native size) — only a genuinely
  // low-density image should carry the "always risky" legibility treatment. `naturalWidth`/
  // `naturalHeight` give the image's real pixel count directly (no CTM math needed, unlike PDF),
  // compared against how large it's actually displayed, anchored to `DOCX_RENDER_WIDTH_PX`'s
  // assumed physical page width.
  let hasLowResEmbeddedImage = false;
  if (imageDominant) {
    const pxPerInch = DOCX_RENDER_WIDTH_PX / DOCX_PAGE_WIDTH_IN;
    for (const img of images) {
      const r = img.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const nativeW = img.naturalWidth;
      const nativeH = img.naturalHeight;
      if (nativeW <= 0 || nativeH <= 0) {
        hasLowResEmbeddedImage = true;
        break;
      }
      const dpiX = nativeW / (r.width / pxPerInch);
      const dpiY = nativeH / (r.height / pxPerInch);
      if (Math.min(dpiX, dpiY) < RASTER_NATIVE_DPI_FLOOR) {
        hasLowResEmbeddedImage = true;
        break;
      }
    }
  }

  const bboxFrac = computeBboxFrac(bbox, probe.width, probe.height);
  const columnFracs = computeColumnFracs(imageDominant, bbox, inkProfile);

  return { imageDominant, hasLowResEmbeddedImage, bboxFrac, columnFracs };
}

interface DocxSectionRenderResult {
  extractImages: string[];
  imageRefs: SourceImageRef[];
  previewImage: string;
  payloadBytes: number;
}

/** Render one analyzed section: crop to content, tile per column when a confident grid was found. */
async function renderAnalyzedDocxSection(
  el: HTMLElement,
  analysis: DocxSectionAnalysis,
  pageNum: number,
  scale: number,
  quality: number
): Promise<DocxSectionRenderResult> {
  const fullCanvas = await html2canvas(el, { scale, useCORS: true, backgroundColor: '#ffffff' });

  const bbox = analysis.bboxFrac;
  let contentCanvas: HTMLCanvasElement = fullCanvas;
  let contentX0 = 0;
  let contentWidth = fullCanvas.width;
  if (bbox && (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0) < 0.93) {
    const sx = bbox.x0 * fullCanvas.width;
    const sy = bbox.y0 * fullCanvas.height;
    const sw = (bbox.x1 - bbox.x0) * fullCanvas.width;
    const sh = (bbox.y1 - bbox.y0) * fullCanvas.height;
    const cropped = cropCanvas(fullCanvas, sx, sy, sw, sh);
    if (cropped) {
      contentCanvas = cropped;
      contentX0 = sx;
      contentWidth = cropped.width;
    }
  }

  const previewImage = encodeCanvas(contentCanvas, quality);

  if (analysis.columnFracs && analysis.columnFracs.length >= 3) {
    const tiles: string[] = [];
    const refs: SourceImageRef[] = [];
    let columnIndex = 0;
    for (const band of analysis.columnFracs) {
      columnIndex += 1;
      const bx = contentX0 + band.start * contentWidth;
      const bw = (band.end - band.start) * contentWidth;
      const tile = cropCanvas(contentCanvas, bx - contentX0, 0, bw, contentCanvas.height);
      if (!tile) continue;
      for (const sub of splitTallTile(tile)) {
        tiles.push(encodeCanvas(sub, quality));
        refs.push({ page: pageNum, column: columnIndex });
      }
    }
    if (tiles.length >= 3) {
      return {
        extractImages: tiles,
        imageRefs: refs,
        previewImage,
        payloadBytes: totalPayloadBytes(tiles),
      };
    }
  }

  return {
    extractImages: [previewImage],
    imageRefs: [{ page: pageNum }],
    previewImage,
    payloadBytes: previewImage.length,
  };
}

interface DocxVisionResult {
  images: string[];
  imageRefs: SourceImageRef[];
  previewImages: string[];
  warnings: string[];
  lowLegibility: boolean;
}

/**
 * Track B: prefer docx-preview page `<section class="docx">` nodes, each analyzed and rendered
 * like a PDF page (content-crop, image-dominant scale-up, column tiling, legibility floor);
 * otherwise analyze once and slice one tall render into letter-aspect JPEG bands.
 */
async function renderDocxVisionPages(arrayBuffer: ArrayBuffer): Promise<DocxVisionResult> {
  const warnings: string[] = [];
  let container: HTMLDivElement | null = null;
  let lowLegibility = false;

  try {
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = `${DOCX_RENDER_WIDTH_PX}px`;
    container.style.backgroundColor = 'white';
    document.body.appendChild(container);

    await renderAsync(arrayBuffer, container, container, {
      inWrapper: false,
      ignoreWidth: false,
      ignoreHeight: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      className: 'docx',
    });

    const pageSections = Array.from(
      container.querySelectorAll<HTMLElement>('section.docx')
    ).filter(el => (el.textContent || '').trim().length > 0 || el.querySelector('img,table,svg'));

    let images: string[] = [];
    let imageRefs: SourceImageRef[] = [];
    let previewImages: string[] = [];

    const legibilityWarningFor = (pageLabel: string, bboxFrac: Box | null, scale: number): string | null => {
      const contentFrac = bboxFrac ? bboxFrac.x1 - bboxFrac.x0 : 1;
      const contentPx = contentFrac * DOCX_RENDER_WIDTH_PX * scale;
      if (contentPx >= LEGIBILITY_FLOOR_PX) return null;
      return `${pageLabel} of this Word document contains a low-resolution embedded image, so small text may be misread. Verify the extracted wording against the original.`;
    };

    if (pageSections.length >= 2) {
      const limited = pageSections.slice(0, MAX_VISION_PAGES);
      const budgetBytes = isLocalHost() ? Number.POSITIVE_INFINITY : VISION_PAYLOAD_BUDGET_BYTES;
      let runningBytes = 0;

      for (let i = 0; i < limited.length; i++) {
        const section = limited[i];
        const pageNum = i + 1;
        const analysis = await analyzeDocxSection(section);
        if (analysis.hasLowResEmbeddedImage) lowLegibility = true;

        const scale = resolveContentScale(
          analysis.imageDominant,
          1,
          DOCX_VISION_SCALE,
          DOCX_IMAGE_DOMINANT_SCALE,
          DOCX_IMAGE_DOMINANT_MIN_SCALE,
          DOCX_MAX_SCALE
        );
        let result = await renderAnalyzedDocxSection(section, analysis, pageNum, scale, DOCX_JPEG_QUALITY);

        // One downgrade retry when running total is already tight — cheaper than a full
        // scale×quality grid (see the constant block comment for why DOCX doesn't use one).
        if (!isLocalHost() && runningBytes + result.payloadBytes > budgetBytes) {
          const downgradedScale = Math.max(1, scale * DOCX_DOWNGRADE_SCALE_FACTOR);
          result = await renderAnalyzedDocxSection(
            section,
            analysis,
            pageNum,
            downgradedScale,
            DOCX_DOWNGRADE_QUALITY
          );
        }

        runningBytes += result.payloadBytes;
        images.push(...result.extractImages);
        imageRefs.push(...result.imageRefs);
        previewImages.push(result.previewImage);

        const warning = legibilityWarningFor(`Page ${pageNum}`, analysis.bboxFrac, scale);
        if (warning) warnings.push(warning);
      }

      if (pageSections.length > MAX_VISION_PAGES) {
        warnings.push(
          `This Word document has ${pageSections.length} pages; only the first ${MAX_VISION_PAGES} were analyzed.`
        );
      }
    } else {
      // Single flow / no reliable page breaks — analyze once, then paginate by height.
      const target = pageSections[0] || container;
      const analysis = await analyzeDocxSection(target);
      if (analysis.hasLowResEmbeddedImage) lowLegibility = true;
      const scale = resolveContentScale(
        analysis.imageDominant,
        1,
        DOCX_VISION_SCALE,
        DOCX_IMAGE_DOMINANT_SCALE,
        DOCX_IMAGE_DOMINANT_MIN_SCALE,
        DOCX_MAX_SCALE
      );
      const full = await html2canvas(target, { scale, useCORS: true, backgroundColor: '#ffffff' });
      const slicePx = Math.round(DOCX_SLICE_HEIGHT_PX * scale);
      images = sliceCanvasToJpegs(full, slicePx, MAX_VISION_PAGES);
      imageRefs = images.map((_, i) => ({ page: i + 1 }));
      previewImages = images;
      if (images.length > 1) {
        warnings.push(
          'Word page breaks were unclear, so the document was split into fixed-height image bands for vision analysis.'
        );
      }
      const approxTotalBands = Math.ceil(full.height / slicePx);
      if (approxTotalBands > MAX_VISION_PAGES) {
        warnings.push(
          `This Word document is long; only the first ${MAX_VISION_PAGES} image bands were analyzed.`
        );
      }
      const warning = legibilityWarningFor('This document', analysis.bboxFrac, scale);
      if (warning) warnings.push(warning);
    }

    if (images.length === 0) {
      throw new Error('DOCX vision render produced no page images.');
    }

    return { images, imageRefs, previewImages, warnings, lowLegibility };
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
}

/** DOCX dual-track ingest: paginated page rasters (Track B) + Markdown (Track A). */
export const convertDocxToImages = async (file: File): Promise<DocumentBundle> => {
  try {
    const arrayBuffer = await file.arrayBuffer();

    const [textTrack, vision] = await Promise.all([
      docxArrayBufferToMarkdown(arrayBuffer.slice(0)),
      renderDocxVisionPages(arrayBuffer.slice(0)),
    ]);

    const bundle = assembleDocumentBundle(
      'docx',
      vision.images,
      vision.warnings,
      vision.lowLegibility,
      textTrack,
      vision.previewImages,
      vision.imageRefs
    );

    const snippet = bundle.textTrack.slice(0, 400);
    console.log('[DOCX DocumentBundle] images length:', bundle.images.length);
    console.log(
      '[DOCX DocumentBundle] textTrack snippet:',
      snippet + (bundle.textTrack.length > 400 ? '…' : '')
    );

    return bundle;
  } catch (error) {
    console.error('DOCX Image Conversion Error:', error);
    throw new Error('Failed to convert Word document to images.');
  }
};

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Track A: pull slide text from OOXML `a:t` runs (fast; no WASM). */
async function pptxArrayBufferToTextTrack(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideFiles = Object.keys(zip.files)
    .filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'))
    .sort((a, b) => {
      const getNum = (str: string) => {
        const match = str.match(/slide(\d+)\.xml/);
        return match ? parseInt(match[1], 10) : 0;
      };
      return getNum(a) - getNum(b);
    });

  const parser = new DOMParser();
  let fullText = '';
  for (const slidePath of slideFiles) {
    const entry = zip.file(slidePath);
    if (!entry) continue;
    const content = await entry.async('text');
    const xmlDoc = parser.parseFromString(content, 'application/xml');
    const textNodes = xmlDoc.getElementsByTagName('a:t');
    const slideText = Array.from(textNodes)
      .map(node => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (slideText) {
      const match = slidePath.match(/slide(\d+)\.xml/);
      const n = match ? match[1] : '?';
      fullText += `\n\n## Slide ${n}\n\n${slideText}`;
    }
  }
  return fullText.trim();
}

/**
 * Convert PPTX → PDF via the server's LibreOffice WASM endpoint. There used to be an in-browser
 * WorkerBrowserConverter fallback here, but it required COOP/COEP headers that neither
 * vite.config.ts (which explicitly omits them to keep Google Fonts working) nor server.ts's
 * production static serving ever set — it could never actually succeed, and its own error message
 * tacitly admitted as much by pointing users back at the server endpoint. Removed rather than fixed:
 * adding those headers site-wide is a real product trade-off (breaks the Google Fonts loading the
 * comment cites), not a contained bug fix. Found via codebase audit
 * (docs/specs/codebase-audit-2026-09-19.md #16).
 */
async function convertPptxToPdfBytes(arrayBuffer: ArrayBuffer, filename: string): Promise<Uint8Array> {
  const qs = `?filename=${encodeURIComponent(filename)}`;
  const response = await fetch(`/api/convert/pptx-to-pdf${qs}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    body: arrayBuffer,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    pdfBase64?: string;
    error?: string;
  };
  if (!response.ok || !payload.pdfBase64) {
    throw new Error(payload.error || `Server LibreOffice convert failed (status ${response.status}).`);
  }
  return base64ToUint8Array(payload.pdfBase64);
}

/**
 * PPTX dual-track ingest: LibreOffice WASM → PDF → existing PDF vision pipeline (Track B),
 * plus OOXML slide text (Track A).
 */
export const convertPptxToImages = async (file: File): Promise<DocumentBundle> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const filename = file.name || 'presentation.pptx';

    const [textTrack, pdfBytes] = await Promise.all([
      pptxArrayBufferToTextTrack(arrayBuffer.slice(0)),
      convertPptxToPdfBytes(arrayBuffer.slice(0), filename),
    ]);

    const pdfFile = new File([pdfBytes], filename.replace(/\.pptx?$/i, '.pdf'), {
      type: 'application/pdf',
    });

    const pdfBundle = await convertPdfToImages(pdfFile);

    const warnings = [
      ...pdfBundle.warnings,
      'PowerPoint was converted to PDF with LibreOffice WASM for visual fidelity.',
    ];

    const bundle: DocumentBundle = {
      images: pdfBundle.images,
      previewImages: pdfBundle.previewImages,
      imageRefs: pdfBundle.imageRefs,
      textTrack: textTrack || pdfBundle.textTrack,
      warnings,
      sourceFormat: 'pptx',
    };

    const snippet = bundle.textTrack.slice(0, 400);
    console.log('[PPTX DocumentBundle] images length:', bundle.images.length);
    console.log(
      '[PPTX DocumentBundle] textTrack snippet:',
      snippet + (bundle.textTrack.length > 400 ? '…' : '')
    );

    return bundle;
  } catch (error) {
    console.error('PPTX Image Conversion Error:', error);
    throw new Error(
      'Failed to convert PowerPoint via LibreOffice WASM. Ensure the API server is running (`npm run dev`) so `/api/convert/pptx-to-pdf` is available.'
    );
  }
};

/** First N pages of PDF text — recovers page-1 Impact Statement after vision extract. */
export const extractPdfFrontMatterText = async (
  file: File,
  maxPages = 2
): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    const pageCount = Math.min(pdf.numPages, maxPages);
    let fullText = '';
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .join(' ');
      fullText += `\n\n## Page ${i}\n\n${pageText}`;
    }
    return fullText;
  } catch (error) {
    console.error('PDF front-matter text extraction error:', error);
    return '';
  }
};

// Legacy/Fallback Text Extractions
export const extractTextFromPdf = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += `\n\n## Page ${i}\n\n${pageText}`;
    }
    return fullText;
  } catch (error) {
    console.error('PDF Extraction Error:', error);
    throw new Error('Failed to extract text from PDF.');
  }
};

export const extractTextFromDocx = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    return await docxArrayBufferToMarkdown(arrayBuffer);
  } catch (error) {
    console.error('Docx Extraction Error:', error);
    throw new Error('Failed to extract text from DOCX.');
  }
};

export const extractTextFromPptx = async (file: File): Promise<string> => {
  try {
    return await pptxArrayBufferToTextTrack(await file.arrayBuffer());
  } catch {
    throw new Error('PPTX Text Extraction failed');
  }
};

/**
 * XLSX -> Track A Markdown tables.
 *
 * A logic model in a spreadsheet IS a grid, so the column a value sits in carries the meaning.
 * Rendering to Markdown tables keeps that alignment; a flat cell dump destroys it (verified
 * against a real partner workbook — Puentes de Salud's "Results Framework", whose WELLNESS /
 * CULTURAL / ACADEMIC columns collapse into one comma run under flat text rendering).
 *
 * There are no page rasters here, so an XLSX runs the `text-only` prompt variant.
 */
export const xlsxToTextTrack = async (arrayBuffer: ArrayBuffer): Promise<string> => {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const workbookXml = (await zip.file('xl/workbook.xml')?.async('string')) ?? '';
  const sharedStringsXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const names = parseSheetNames(workbookXml);

  const sheetFiles = Object.keys(zip.files)
    .filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => {
      const n = (x: string) => Number(/sheet(\d+)\.xml$/.exec(x)?.[1] ?? 0);
      return n(a) - n(b);
    });

  const sheets: XlsxSheet[] = [];
  for (let i = 0; i < sheetFiles.length; i++) {
    const xml = (await zip.file(sheetFiles[i])?.async('string')) ?? '';
    sheets.push({ name: names[i] || `Sheet ${i + 1}`, grid: parseSheetGrid(xml, sharedStrings) });
  }

  const markdown = sheetsToMarkdown(sheets);
  if (!markdown.trim()) throw new Error('This spreadsheet has no readable cells.');
  return markdown;
};

/** XLSX ingest: Markdown tables only (no rasters) — the `text-only` prompt variant. */
export const convertXlsxToBundle = async (file: File): Promise<DocumentBundle> => {
  try {
    const textTrack = await xlsxToTextTrack(await file.arrayBuffer());
    const sheetCount = countMarkdownSheets(textTrack);
    const warnings =
      sheetCount > 1
        ? [
            `This spreadsheet has ${sheetCount} sheets and all of them were read as ONE document. ` +
              `If a sheet holds its own separate logic model, its items are mixed in with the rest ` +
              `and nothing records which sheet each item came from.`,
          ]
        : [];
    return assembleDocumentBundle('xlsx', [], warnings, false, textTrack, undefined, undefined);
  } catch (error) {
    console.error('XLSX Conversion Error:', error);
    throw new Error(
      error instanceof Error && /no readable cells/.test(error.message)
        ? error.message
        : 'Failed to read this spreadsheet.'
    );
  }
};

/**
 * PNG/JPEG ingest: one page raster, no text track — the `vision-only` prompt variant.
 *
 * An uploaded image of a logic model is the same hazard class as a flattened PDF page (Oxford
 * Circle), so it reuses the same legibility floor: below `LEGIBILITY_FLOOR_PX` of real width the
 * bundle is flagged low-legibility, which turns on the prompt's LOW-RESOLUTION procedure block.
 * Unlike a PDF there is no placement geometry to derive a DPI from, so pixel width is the only
 * honest signal available.
 */
export const convertImageToBundle = async (file: File): Promise<DocumentBundle> => {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image could not be decoded.'));
      el.src = url;
    });

    const nativeWidth = img.naturalWidth || img.width;
    const nativeHeight = img.naturalHeight || img.height;
    if (nativeWidth <= 0 || nativeHeight <= 0) throw new Error('Image has no dimensions.');

    const budgetBytes = isLocalHost() ? Number.POSITIVE_INFINITY : 3_800_000;
    const warnings: string[] = [];

    let encoded = '';
    let scale = 1;
    for (const attempt of [1, 0.8, 0.65, 0.5]) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(nativeWidth * attempt));
      canvas.height = Math.max(1, Math.round(nativeHeight * attempt));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable for image conversion.');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      encoded = encodeCanvas(canvas, attempt === 1 ? 0.92 : 0.8);
      scale = attempt;
      if (totalPayloadBytes([encoded]) <= budgetBytes) break;
    }
    if (scale < 1) {
      warnings.push(
        `This image was downscaled to ${Math.round(scale * 100)}% to fit the upload limit; small text may be harder to read.`
      );
    }

    const effectiveWidth = nativeWidth * scale;
    const lowLegibility = effectiveWidth < LEGIBILITY_FLOOR_PX;
    if (lowLegibility) {
      warnings.push(
        `This image is ${Math.round(effectiveWidth)}px wide, which is low resolution for a dense logic model, so small text may be misread. Verify the extracted wording against the original.`
      );
    }

    return assembleDocumentBundle('image', [encoded], warnings, lowLegibility, '', [encoded], [
      { page: 1 },
    ]);
  } catch (error) {
    console.error('Image Conversion Error:', error);
    throw new Error('Failed to read this image.');
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const convertFileToMarkdown = async (file: File): Promise<string> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractTextFromPdf(file);
  if (name.endsWith('.docx')) return extractTextFromDocx(file);
  if (name.endsWith('.pptx')) return extractTextFromPptx(file);
  if (name.endsWith('.xlsx')) return xlsxToTextTrack(await file.arrayBuffer());
  throw new Error(`Unsupported file format: ${file.name}`);
};

// Format rules live in shared/uploadFormats.ts (dependency-free, so the upload control and the
// extraction log can share them without pulling in this module's pdfjs/mammoth/jszip graph).
export {
  SUPPORTED_UPLOAD_EXTENSIONS,
  isImageFileName,
  isSupportedUploadName,
  sourceFormatFromFileName,
} from '../shared/uploadFormats';

/** Build a text-only DocumentBundle when vision conversion fails. */
export const textOnlyDocumentBundle = (
  textTrack: string,
  sourceFormat: DocumentBundle['sourceFormat'],
  warnings: string[] = []
): DocumentBundle => ({
  images: [],
  previewImages: [],
  imageRefs: [],
  textTrack,
  warnings,
  sourceFormat,
});
