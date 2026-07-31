import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import TurndownService from 'turndown';
import { findColumnBands } from './columnDetect';
import {
  DocumentBundle,
  LOW_LEGIBILITY_WARNING,
} from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_VISION_PAGES = 15;

/** Internal PDF render result before assembling DocumentBundle. */
interface PdfRenderResult {
  images: string[];
  warnings: string[];
  lowLegibility: boolean;
}

// --- Rendering tuning (see docs/specs/extraction-provenance-and-color.md) ---
const BASE_SCALE = 2.5; // text-layer pages render fine here
const IMAGE_DOMINANT_SCALE = 3.6; // flattened-raster pages need more pixels per glyph (proper-noun/number fidelity)
const MAX_SCALE = 4.5;
const PROBE_SCALE = 1.25; // cheap pass to find the content box + column gutters
const CONTENT_PAD_FRAC = 0.01; // padding around the detected content box
const TEXT_DOMINANT_MIN_CHARS = 40; // fewer real characters ⇒ page is essentially an image
const LEGIBILITY_FLOOR_PX = 1150; // image-page content narrower than this ⇒ warn the user
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

  const viewport = page.getViewport({ scale: PROBE_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { pageNumber, pageWidthPt, imageDominant, bboxFrac: null, columnFracs: null };
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { bbox, inkProfile } = analyzeCanvasPixels(data, canvas.width, canvas.height);

  let bboxFrac: Box | null = null;
  if (bbox) {
    const pad = CONTENT_PAD_FRAC;
    bboxFrac = {
      x0: Math.max(0, bbox.x0 / canvas.width - pad),
      y0: Math.max(0, bbox.y0 / canvas.height - pad),
      x1: Math.min(1, bbox.x1 / canvas.width + pad),
      y1: Math.min(1, bbox.y1 / canvas.height + pad),
    };
  }

  // Column bands: only meaningful for wide, image-dominant grid pages.
  let columnFracs: { start: number; end: number }[] | null = null;
  if (ENABLE_COLUMN_TILING && imageDominant && bbox) {
    const cropX0 = bbox.x0;
    const cropX1 = bbox.x1;
    const cropWidth = cropX1 - cropX0;
    const aspect = (bbox.x1 - bbox.x0) / Math.max(1, bbox.y1 - bbox.y0);
    if (cropWidth > 40 && aspect > 0.7) {
      const cropped = inkProfile.slice(cropX0, cropX1);
      const bands = findColumnBands(cropped);
      if (bands.length >= 3) {
        columnFracs = bands.map(b => ({ start: b.start / cropWidth, end: b.end / cropWidth }));
      }
    }
  }

  return { pageNumber, pageWidthPt, imageDominant, bboxFrac, columnFracs };
}

function encodeCanvas(canvas: HTMLCanvasElement, quality: number): string {
  return canvas.toDataURL('image/jpeg', quality).split(',')[1];
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

/** Render one page (cropped to content) plus optional per-column tiles for grid pages. */
async function renderAnalyzedPage(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>['getPage']>>,
  analysis: PageAnalysis,
  scaleFactor: number,
  quality: number
): Promise<string[]> {
  const targetScale = analysis.imageDominant ? IMAGE_DOMINANT_SCALE : BASE_SCALE;
  const scale = Math.min(MAX_SCALE, Math.max(1, targetScale * scaleFactor));

  const viewport = page.getViewport({ scale });
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = Math.ceil(viewport.width);
  fullCanvas.height = Math.ceil(viewport.height);
  const ctx = fullCanvas.getContext('2d');
  if (!ctx) return [];
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

  // When we confidently found columns on an image-only grid, send zoomed per-column
  // tiles INSTEAD of the whole page: max legibility, clear column identity, no double-count.
  if (analysis.columnFracs && analysis.columnFracs.length >= 3) {
    const tiles: string[] = [];
    for (const band of analysis.columnFracs) {
      const bx = contentX0 + band.start * contentWidth;
      const bw = (band.end - band.start) * contentWidth;
      const tile = cropCanvas(contentCanvas, bx - contentX0, 0, bw, contentCanvas.height);
      if (!tile) continue;
      for (const sub of splitTallTile(tile)) {
        tiles.push(encodeCanvas(sub, quality));
      }
    }
    if (tiles.length >= 3) return tiles;
  }

  return [encodeCanvas(contentCanvas, quality)];
}

async function convertPdfWithAnalysis(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  pageCount: number
): Promise<PdfRenderResult> {
  const warnings: string[] = [];
  const budgetBytes = isLocalHost() ? Number.POSITIVE_INFINITY : 3_800_000;

  const pages = [];
  const analyses: PageAnalysis[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    pages.push(page);
    analyses.push(await analyzePdfPage(page, i));
  }

  let images: string[] = [];
  let usedScaleFactor = 1;
  outer: for (const scaleFactor of GLOBAL_SCALE_FACTORS) {
    for (const quality of QUALITY_TIERS) {
      const rendered: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        rendered.push(...(await renderAnalyzedPage(pages[i], analyses[i], scaleFactor, quality)));
      }
      images = rendered;
      usedScaleFactor = scaleFactor;
      if (totalPayloadBytes(rendered) <= budgetBytes) break outer;
    }
  }

  // Legibility warning for flattened-raster pages that came out small.
  let lowLegibility = false;
  for (const a of analyses) {
    if (!a.imageDominant || !a.bboxFrac) continue;
    // A flattened page is inherently risky: rendering above its native raster resolution
    // interpolates rather than recovering detail, so always signal the extractor.
    lowLegibility = true;
    const scale = Math.min(MAX_SCALE, Math.max(1, IMAGE_DOMINANT_SCALE * usedScaleFactor));
    const contentPx = (a.bboxFrac.x1 - a.bboxFrac.x0) * a.pageWidthPt * scale;
    if (contentPx < LEGIBILITY_FLOOR_PX) {
      warnings.push(
        `Page ${a.pageNumber} of this document is a flattened image at low resolution, so small text may be misread. Verify the extracted wording against the original.`
      );
    }
  }

  return { images, warnings, lowLegibility };
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
  const budgetBytes = isLocalHost() ? Number.POSITIVE_INFINITY : 3_800_000;
  let images: string[] = [];
  for (const tier of RENDER_TIERS) {
    images = await renderPdfAtTier(pdf, pageCount, tier);
    if (totalPayloadBytes(images) <= budgetBytes) return images;
  }
  return images;
}

/** Pull text-layer content from an already-loaded PDF (Track A). */
async function textTrackFromPdf(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  maxPages = 2
): Promise<string> {
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
  return fullText.trim();
}

function assemblePdfBundle(
  images: string[],
  warnings: string[],
  lowLegibility: boolean,
  textTrack: string
): DocumentBundle {
  const mergedWarnings = [...warnings];
  if (lowLegibility && !mergedWarnings.some(w => w.includes('flattened-raster'))) {
    mergedWarnings.push(LOW_LEGIBILITY_WARNING);
  }
  return {
    images,
    textTrack,
    warnings: mergedWarnings,
    sourceFormat: 'pdf',
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

    const textTrack = await textTrackFromPdf(pdf, 2);

    try {
      const result = await convertPdfWithAnalysis(pdf, pageCount);
      return assemblePdfBundle(
        result.images,
        [...warnings, ...result.warnings],
        result.lowLegibility,
        textTrack
      );
    } catch (analysisError) {
      console.warn('Analysis render failed; falling back to tier rendering:', analysisError);
      const images = await convertPdfWithLegacyTiers(pdf, pageCount);
      // Fallback skipped analysis, so assume the worst and let extraction flag risky tokens.
      return assemblePdfBundle(images, warnings, true, textTrack);
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
  return new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
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

async function captureElementJpeg(el: HTMLElement): Promise<string> {
  const canvas = await html2canvas(el, {
    scale: DOCX_VISION_SCALE,
    useCORS: true,
    backgroundColor: '#ffffff',
  });
  return encodeCanvasJpeg(canvas);
}

/**
 * Track B: prefer docx-preview page `<section class="docx">` nodes; otherwise slice
 * one tall render into letter-aspect JPEG bands.
 */
async function renderDocxVisionPages(
  arrayBuffer: ArrayBuffer
): Promise<{ images: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  let container: HTMLDivElement | null = null;

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

    if (pageSections.length >= 2) {
      const limited = pageSections.slice(0, MAX_VISION_PAGES);
      for (const section of limited) {
        images.push(await captureElementJpeg(section));
      }
      if (pageSections.length > MAX_VISION_PAGES) {
        warnings.push(
          `This Word document has ${pageSections.length} pages; only the first ${MAX_VISION_PAGES} were analyzed.`
        );
      }
    } else {
      // Single flow / no reliable page breaks — capture once and paginate by height.
      const target = pageSections[0] || container;
      const full = await html2canvas(target, {
        scale: DOCX_VISION_SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const slicePx = Math.round(DOCX_SLICE_HEIGHT_PX * DOCX_VISION_SCALE);
      images = sliceCanvasToJpegs(full, slicePx, MAX_VISION_PAGES);
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
    }

    if (images.length === 0) {
      throw new Error('DOCX vision render produced no page images.');
    }

    return { images, warnings };
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

    const bundle: DocumentBundle = {
      images: vision.images,
      textTrack,
      warnings: vision.warnings,
      sourceFormat: 'docx',
    };

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

/** Prefer Express LibreOffice WASM; fall back to in-browser WorkerBrowserConverter. */
async function convertPptxToPdfBytes(
  arrayBuffer: ArrayBuffer,
  filename: string
): Promise<{ pdfBytes: Uint8Array; via: 'server' | 'browser' }> {
  const qs = `?filename=${encodeURIComponent(filename)}`;
  try {
    const response = await fetch(`/api/convert/pptx-to-pdf${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      },
      body: arrayBuffer,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      pdfBase64?: string;
      error?: string;
    };
    if (response.ok && payload.pdfBase64) {
      return { pdfBytes: base64ToUint8Array(payload.pdfBase64), via: 'server' };
    }
    console.warn(
      '[PPTX] Server LibreOffice convert failed; trying browser WASM:',
      payload.error || response.status
    );
  } catch (err) {
    console.warn('[PPTX] Server LibreOffice convert unreachable; trying browser WASM:', err);
  }

  const { convertPptxToPdfInBrowser } = await import('./pptxLibreOfficeBrowser');
  const result = await convertPptxToPdfInBrowser(arrayBuffer, filename);
  return { pdfBytes: result.data, via: 'browser' };
}

/**
 * PPTX dual-track ingest: LibreOffice WASM → PDF → existing PDF vision pipeline (Track B),
 * plus OOXML slide text (Track A).
 */
export const convertPptxToImages = async (file: File): Promise<DocumentBundle> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const filename = file.name || 'presentation.pptx';

    const [textTrack, pdfConversion] = await Promise.all([
      pptxArrayBufferToTextTrack(arrayBuffer.slice(0)),
      convertPptxToPdfBytes(arrayBuffer.slice(0), filename),
    ]);

    const pdfFile = new File(
      [pdfConversion.pdfBytes],
      filename.replace(/\.pptx?$/i, '.pdf'),
      { type: 'application/pdf' }
    );

    const pdfBundle = await convertPdfToImages(pdfFile);

    const warnings = [
      ...pdfBundle.warnings,
      pdfConversion.via === 'server'
        ? 'PowerPoint was converted to PDF with LibreOffice WASM (server) for visual fidelity.'
        : 'PowerPoint was converted to PDF with LibreOffice WASM (browser) for visual fidelity.',
    ];

    const bundle: DocumentBundle = {
      images: pdfBundle.images,
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
    console.log('[PPTX DocumentBundle] convert via:', pdfConversion.via);

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

export const convertFileToMarkdown = async (file: File): Promise<string> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractTextFromPdf(file);
  if (name.endsWith('.docx')) return extractTextFromDocx(file);
  if (name.endsWith('.pptx')) return extractTextFromPptx(file);
  throw new Error(`Unsupported file format: ${file.name}`);
};

/** Infer sourceFormat from filename for text-only DocumentBundle fallbacks. */
export const sourceFormatFromFileName = (fileName: string): DocumentBundle['sourceFormat'] => {
  const name = fileName.toLowerCase();
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  return 'pdf';
};

/** Build a text-only DocumentBundle when vision conversion fails. */
export const textOnlyDocumentBundle = (
  textTrack: string,
  sourceFormat: DocumentBundle['sourceFormat'],
  warnings: string[] = []
): DocumentBundle => ({
  images: [],
  textTrack,
  warnings,
  sourceFormat,
});
