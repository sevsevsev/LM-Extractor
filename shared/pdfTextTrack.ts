/**
 * Turning pdfjs's per-run text fragments into the Markdown text track Gemini reads as Track A.
 *
 * Extracted from `services/fileService.ts` for testing. This is the only structural signal a PDF's
 * Track A carries — a heading here is a heading in the prompt's eyes — and it had no test.
 */
export interface PdfTextLine {
  text: string;
  maxHeight: number;
}

/**
 * pdfjs emits text as per-run fragments (mixed with TextMarkedContent items with no `str`), not
 * lines — group by `hasEOL` to reconstruct lines. Takes the raw `getTextContent().items` union
 * directly rather than pre-filtering to a narrower type, since pdfjs-dist doesn't re-export
 * `TextItem` from its package root for a clean type-predicate narrowing.
 */
export function groupTextItemsIntoLines(items: unknown[]): PdfTextLine[] {
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
 * A text run meaningfully taller than the page's typical run height is treated as a probable
 * heading. Glyph height (via `item.height` / the transform's scale term) is on every pdfjs
 * TextItem and is the standard, robust PDF heading signal. Deliberately NOT attempting bold-weight
 * detection: that needs resolving `item.fontName` through `page.commonObjs`, an internal-ish pdfjs
 * API whose behavior isn't guaranteed to be stable across versions (we were burned by exactly this
 * kind of pdfjs internals assumption once already this project — see the getOrInsertComputed
 * polyfill). Height is public, stable, and does the same job for the common case (headings are
 * bigger, not just bold).
 */
export const HEADING_SIZE_RATIO = 1.35;
export const HEADING_MAX_CHARS = 120;

/**
 * One page's lines rendered as Markdown: a line whose glyph height clears the page's MEDIAN height
 * by `HEADING_SIZE_RATIO` becomes an ATX heading. Median rather than mean, so a single oversized
 * title cannot raise the bar above the real section headings beneath it.
 */
export function renderPdfPageText(lines: PdfTextLine[]): string {
  const heights = lines.map(l => l.maxHeight).filter(h => h > 0);
  const sortedHeights = [...heights].sort((a, b) => a - b);
  const medianHeight = sortedHeights.length ? sortedHeights[Math.floor(sortedHeights.length / 2)] : 0;
  const headingThreshold = medianHeight * HEADING_SIZE_RATIO;
  return lines
    .map(line => {
      const isHeadingSize =
        medianHeight > 0 && line.maxHeight >= headingThreshold && line.text.length <= HEADING_MAX_CHARS;
      return isHeadingSize ? `### ${line.text}` : line.text;
    })
    .join('\n');
}
