import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import { renderAsync } from 'docx-preview';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import TurndownService from 'turndown';
import { findColumnBands } from './columnDetect';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_VISION_PAGES = 15;

/** Result of PDF→image conversion, plus non-blocking fidelity warnings for the UI. */
export interface PdfConversionResult {
  images: string[];
  warnings: string[];
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
      if (tile) tiles.push(encodeCanvas(tile, quality));
    }
    if (tiles.length >= 3) return tiles;
  }

  return [encodeCanvas(contentCanvas, quality)];
}

async function convertPdfWithAnalysis(
  pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>,
  pageCount: number
): Promise<PdfConversionResult> {
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
  for (const a of analyses) {
    if (!a.imageDominant || !a.bboxFrac) continue;
    const scale = Math.min(MAX_SCALE, Math.max(1, IMAGE_DOMINANT_SCALE * usedScaleFactor));
    const contentPx = (a.bboxFrac.x1 - a.bboxFrac.x0) * a.pageWidthPt * scale;
    if (contentPx < LEGIBILITY_FLOOR_PX) {
      warnings.push(
        `Page ${a.pageNumber} of this document is a flattened image at low resolution, so small text may be misread. Verify the extracted wording against the original.`
      );
    }
  }

  return { images, warnings };
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

export const convertPdfToImages = async (file: File): Promise<PdfConversionResult> => {
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

    try {
      const result = await convertPdfWithAnalysis(pdf, pageCount);
      return { images: result.images, warnings: [...warnings, ...result.warnings] };
    } catch (analysisError) {
      console.warn('Analysis render failed; falling back to tier rendering:', analysisError);
      const images = await convertPdfWithLegacyTiers(pdf, pageCount);
      return { images, warnings };
    }
  } catch (error) {
    console.error('PDF Image Conversion Error:', error);
    throw new Error('Failed to convert PDF to images for analysis.');
  }
};

export const convertDocxToImages = async (file: File): Promise<string[]> => {
  let container: HTMLDivElement | null = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '1000px'; // Fixed width to force layout
    container.style.backgroundColor = 'white';
    document.body.appendChild(container);

    // Render DOCX to DOM
    await renderAsync(arrayBuffer, container, container, {
        inWrapper: false,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true
    });

    // Capture the rendered content
    const canvas = await html2canvas(container, {
        scale: 1.5,
        useCORS: true
    });

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    return [dataUrl.split(',')[1]];

  } catch (error) {
    console.error('DOCX Image Conversion Error:', error);
    throw new Error('Failed to convert Word document to images.');
  } finally {
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  }
};

export const convertPptxToImages = async (file: File): Promise<string[]> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Filter for slide XML files
    const slideFiles = Object.keys(zip.files).filter(name => 
      name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
    );
    
    slideFiles.sort((a, b) => {
      const getNum = (str: string) => {
        const match = str.match(/slide(\d+)\.xml/);
        return match ? parseInt(match[1], 10) : 0;
      };
      return getNum(a) - getNum(b);
    });

    if (slideFiles.length > MAX_VISION_PAGES) {
      console.warn(`PPTX has ${slideFiles.length} slides; processing first ${MAX_VISION_PAGES} only.`);
    }
    const slidesToProcess = slideFiles.slice(0, MAX_VISION_PAGES);

    const images: string[] = [];
    const parser = new DOMParser();

    // 1 inch = 914400 EMUs. 96 DPI -> 9525 EMUs per px.
    const emuToPx = (emu: number) => emu / 9525;

    const createSvgRectAndText = (x: number, y: number, w: number, h: number, text: string) => {
        const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `
          <g>
            <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(240, 240, 255, 0.4)" stroke="#3b82f6" stroke-width="1" />
            <foreignObject x="${x}" y="${y}" width="${w}" height="${h}">
                <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:4px;overflow:hidden;height:100%;word-wrap:break-word;">
                    ${safeText}
                </div>
            </foreignObject>
          </g>
        `;
    };

    // Recursive function to process Shapes, Groups, and GraphicFrames (tables)
    const processNodeList = (nodes: HTMLCollection | NodeListOf<Element>, offsetX = 0, offsetY = 0): string => {
        let svgFragment = '';
        
        Array.from(nodes).forEach(node => {
            if (node.nodeType !== 1) return; // Skip non-element nodes
            const element = node as Element;
            const tagName = element.tagName;

            // --- 1. SHAPES (p:sp) ---
            if (tagName === 'p:sp') {
                const xfrm = element.getElementsByTagName('a:xfrm')[0];
                if (xfrm) {
                    const off = xfrm.getElementsByTagName('a:off')[0];
                    const ext = xfrm.getElementsByTagName('a:ext')[0];
                    if (off && ext) {
                        const x = emuToPx(parseInt(off.getAttribute('x') || '0')) + offsetX;
                        const y = emuToPx(parseInt(off.getAttribute('y') || '0')) + offsetY;
                        const w = emuToPx(parseInt(ext.getAttribute('cx') || '0'));
                        const h = emuToPx(parseInt(ext.getAttribute('cy') || '0'));
                        
                        const txBody = element.getElementsByTagName('p:txBody')[0];
                        if (txBody) {
                             const text = Array.from(txBody.getElementsByTagName('a:t')).map(t => t.textContent).join(' ');
                             if (text && text.trim()) {
                                 svgFragment += createSvgRectAndText(x, y, w, h, text);
                             }
                        }
                    }
                }
            }

            // --- 2. GROUPS (p:grpSp) ---
            else if (tagName === 'p:grpSp') {
                const grpSpPr = element.getElementsByTagName('p:grpSpPr')[0];
                let groupX = 0, groupY = 0;
                
                // Simplified Group Transform Handling:
                // We mainly care about the visual offset ('off') to shift children correctly on the page.
                // Complex scaling or chOff/chExt logic is omitted for stability, as we just need the text roughly in place.
                if (grpSpPr) {
                    const xfrm = grpSpPr.getElementsByTagName('a:xfrm')[0];
                    if (xfrm) {
                         const off = xfrm.getElementsByTagName('a:off')[0];
                         if (off) {
                             groupX = emuToPx(parseInt(off.getAttribute('x') || '0'));
                             groupY = emuToPx(parseInt(off.getAttribute('y') || '0'));
                         }
                    }
                }
                
                // Recursively process children of the group
                // Note: p:grpSp has direct children like p:sp, p:grpSp, p:graphicFrame
                svgFragment += processNodeList(element.children, offsetX + groupX, offsetY + groupY);
            }

            // --- 3. GRAPHIC FRAMES (Tables, Charts, Diagrams) ---
            else if (tagName === 'p:graphicFrame') {
                const xfrm = element.getElementsByTagName('p:xfrm')[0];
                let x = 0, y = 0, w = 0, h = 0;
                
                if (xfrm) {
                    const off = xfrm.getElementsByTagName('a:off')[0];
                    const ext = xfrm.getElementsByTagName('a:ext')[0];
                    if (off) {
                        x = emuToPx(parseInt(off.getAttribute('x') || '0')) + offsetX;
                        y = emuToPx(parseInt(off.getAttribute('y') || '0')) + offsetY;
                    }
                    if (ext) {
                        w = emuToPx(parseInt(ext.getAttribute('cx') || '0'));
                        h = emuToPx(parseInt(ext.getAttribute('cy') || '0'));
                    }
                }

                // CHECK FOR TABLE
                const tbl = element.getElementsByTagName('a:tbl')[0];
                if (tbl) {
                    const trs = tbl.getElementsByTagName('a:tr');
                    let currentY = y;
                    // Fallback height if row height not specified
                    const avgRowHeight = trs.length > 0 ? h / trs.length : 20;

                    Array.from(trs).forEach(tr => {
                        const hAttr = tr.getAttribute('h');
                        const rowH = hAttr ? emuToPx(parseInt(hAttr)) : avgRowHeight;
                        
                        const tcs = tr.getElementsByTagName('a:tc');
                        let currentX = x;
                        // Determine grid columns to estimate width if needed (complex), 
                        // simple approach: distribute width evenly if we can't find grid.
                        // Better approach: just pile them next to each other with a min width or estimated width.
                        // We will use a safe estimate: divide total width by num cols
                        const colW = tcs.length > 0 ? w / tcs.length : 50;

                        Array.from(tcs).forEach(tc => {
                            const txBody = tc.getElementsByTagName('a:txBody')[0];
                            if (txBody) {
                                const text = Array.from(txBody.getElementsByTagName('a:t')).map(t => t.textContent).join(' ');
                                if (text && text.trim()) {
                                    svgFragment += createSvgRectAndText(currentX, currentY, colW, rowH, text);
                                }
                            }
                            currentX += colW; 
                        });
                        currentY += rowH;
                    });
                }
            }
        });
        return svgFragment;
    };

    // Loop through slides and reconstruct simplified visual layout as SVG
    for (const slidePath of slidesToProcess) {
      const fileEntry = zip.file(slidePath);
      if (!fileEntry) continue;

      const content = await fileEntry.async('text');
      const xmlDoc = parser.parseFromString(content, 'application/xml');
      
      const slideWidth = 1280;
      const slideHeight = 720;

      // Start processing from the Shape Tree (p:spTree)
      const spTree = xmlDoc.getElementsByTagName('p:spTree')[0];
      let svgContent = '';
      
      if (spTree) {
          svgContent = processNodeList(spTree.children);
      }

      // Wrap in SVG
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${slideWidth}" height="${slideHeight}" style="background-color: white;">
            ${svgContent}
        </svg>
      `;

      // Convert SVG to Canvas to Base64
      const canvas = document.createElement('canvas');
      canvas.width = slideWidth;
      canvas.height = slideHeight;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
          const img = new Image();
          const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
          const url = URL.createObjectURL(svgBlob);
          
          await new Promise<void>((resolve, reject) => {
              img.onload = () => {
                  ctx.fillStyle = 'white';
                  ctx.fillRect(0, 0, slideWidth, slideHeight);
                  ctx.drawImage(img, 0, 0);
                  URL.revokeObjectURL(url);
                  resolve();
              };
              img.onerror = reject;
              img.src = url;
          });
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          images.push(dataUrl.split(',')[1]);
      }
    }
    
    return images;

  } catch (error) {
    console.error('PPTX Image Conversion Error:', error);
    throw new Error('Failed to convert PowerPoint slides to images.');
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
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const turndownService = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    return turndownService.turndown(result.value);
  } catch (error) {
    console.error('Docx Extraction Error:', error);
    throw new Error('Failed to extract text from DOCX.');
  }
};

export const extractTextFromPptx = async (file: File): Promise<string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const slideFiles = Object.keys(zip.files).filter(name => 
            name.startsWith('ppt/slides/slide') && name.endsWith('.xml')
        );
        slideFiles.sort((a, b) => {
            const getNum = (str: string) => { const match = str.match(/slide(\d+)\.xml/); return match ? parseInt(match[1], 10) : 0; };
            return getNum(a) - getNum(b);
        });
        let fullText = '';
        const parser = new DOMParser();
        for (const slidePath of slideFiles) {
            const entry = zip.file(slidePath);
            if(entry) {
                const content = await entry.async('text');
                const xmlDoc = parser.parseFromString(content, 'application/xml');
                const textNodes = xmlDoc.getElementsByTagName('a:t');
                const slideText = Array.from(textNodes).map(node => node.textContent).join(' ');
                if (slideText.trim()) fullText += `\n\n## Slide\n\n${slideText}`;
            }
        }
        return fullText;
    } catch (e) { throw new Error('PPTX Text Extraction failed'); }
};

export const convertFileToMarkdown = async (file: File): Promise<string> => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractTextFromPdf(file);
  if (name.endsWith('.docx')) return extractTextFromDocx(file);
  if (name.endsWith('.pptx')) return extractTextFromPptx(file);
  throw new Error(`Unsupported file format: ${file.name}`);
};
