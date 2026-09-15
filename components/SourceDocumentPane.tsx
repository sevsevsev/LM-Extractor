import React, { useEffect, useState } from 'react';

export interface SourceFocus {
  page: number;
  column?: number;
  /** Short cue under the page chrome, e.g. "Approximate" */
  note?: string;
}

/**
 * One "possibly missed content" highlight, pre-resolved to plain fractions by the caller (App.tsx,
 * from `LogicModel.possiblyMissedRegions` — see `shared/extractionFidelity.ts`). Only ever built
 * from a region that carried a real Gemini-estimated span; App.tsx drops page-only entries (no
 * `xStart`/`xEnd`) before they reach here, rather than falling back to a whole-page box that
 * wouldn't say anything the page-jump chip doesn't already. Covers all pages for the file; this
 * component filters to whichever page is currently displayed, the same way it already does for
 * `focus`'s `locationCue`.
 */
export interface HighlightRegion {
  page: number;
  /** Fraction [0,1] of the page image's width. */
  leftFrac: number;
  widthFrac: number;
  note?: string;
}

interface SourceDocumentPaneProps {
  images: string[];
  focus?: SourceFocus | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** When true, show the text-only empty state instead of images. */
  textOnly?: boolean;
  /** "Possibly missed content" overlays — see HighlightRegion. */
  highlightRegions?: HighlightRegion[];
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

/**
 * Session source review pane — page rasters from DocumentBundle.previewImages.
 * See docs/specs/source-review-v1.md.
 *
 * Zoom uses width % of the scroll viewport (not CSS `zoom`/`max-w-full`), so
 * 100% = fit pane width and higher values actually enlarge and scroll.
 */
const SourceDocumentPane: React.FC<SourceDocumentPaneProps> = ({
  images,
  focus,
  collapsed,
  onCollapsedChange,
  textOnly = false,
  highlightRegions,
}) => {
  const pageCount = images.length;
  const [pageIndex, setPageIndex] = useState(0); // 0-based
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (focus && focus.page >= 1 && focus.page <= pageCount) {
      setPageIndex(focus.page - 1);
    }
  }, [focus, pageCount]);

  // Reset zoom when flipping pages so a huge zoom on page 1 doesn't strand page 2.
  useEffect(() => {
    setZoom(1);
  }, [pageIndex]);

  if (collapsed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-gray">Source document</p>
        <button
          type="button"
          className="text-xs font-bold text-brand-blue hover:text-brand-navy"
          onClick={() => onCollapsedChange(false)}
        >
          Show source
        </button>
      </div>
    );
  }

  if (textOnly || pageCount === 0) {
    return (
      <aside
        className="rounded-md border border-gray-200 bg-white p-4"
        aria-label="Source document"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-brand-gray">Source document</h3>
          <button
            type="button"
            className="text-xs font-bold text-brand-gray hover:text-brand-navy"
            onClick={() => onCollapsedChange(true)}
          >
            Hide
          </button>
        </div>
        <p className="text-sm text-slate-600">
          No page preview for this file (text-only extract). Open the original file outside the app to
          verify wording.
        </p>
      </aside>
    );
  }

  const pageNum = pageIndex + 1;
  const src = `data:image/jpeg;base64,${images[pageIndex]}`;
  const locationCue =
    focus && focus.page === pageNum
      ? [
          `Page ${focus.page}`,
          typeof focus.column === 'number' ? `column ${focus.column}` : null,
          focus.note,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;

  const pageHighlights = highlightRegions?.filter(r => r.page === pageNum) ?? [];

  const bumpZoom = (delta: number) => {
    setZoom(z => {
      const next = Math.round((z + delta) * 100) / 100;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    });
  };

  return (
    <aside
      // Docked (full-width, capped-height band above the board) below ~1536px; only becomes a
      // sticky side column at the same breakpoint App.tsx switches the grid to side-by-side.
      // See the comment on the layout grid in App.tsx for why that threshold is 2xl, not lg.
      className="flex w-full flex-col rounded-md border border-gray-200 bg-white max-2xl:h-[min(42vh,28rem)] 2xl:sticky 2xl:top-4 2xl:h-[calc(100vh-5.5rem)] 2xl:max-h-[calc(100vh-5.5rem)]"
      aria-label="Source document"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-brand-muted px-3 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-brand-gray">Source document</h3>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            disabled={pageIndex <= 0}
            onClick={() => setPageIndex(i => Math.max(0, i - 1))}
            aria-label="Previous page"
          >
            ←
          </button>
          <span className="min-w-[4.5rem] text-center text-xs font-semibold text-slate-700" aria-live="polite">
            {pageNum} / {pageCount}
          </span>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => setPageIndex(i => Math.min(pageCount - 1, i + 1))}
            aria-label="Next page"
          >
            →
          </button>
          <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden="true" />
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => bumpZoom(-ZOOM_STEP)}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="min-w-[2.75rem] rounded px-1 py-1 text-center text-[10px] font-semibold text-slate-600 hover:bg-slate-200"
            onClick={() => setZoom(1)}
            title="Reset to fit width"
            aria-label="Reset zoom to fit width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => bumpZoom(ZOOM_STEP)}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="ml-1 text-xs font-bold text-slate-500 hover:text-slate-800"
            onClick={() => onCollapsedChange(true)}
          >
            Hide
          </button>
        </div>
      </div>

      {locationCue && (
        <p className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-900">
          {locationCue}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-2">
        {/* Width % is of this scrollport — 100% = fit pane; >100% enlarges and scrolls. */}
        <div className="relative inline-block">
          <img
            src={src}
            alt={`Source page ${pageNum} of ${pageCount}`}
            className="block h-auto shadow-md"
            style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
            draggable={false}
          />
          {/* "Possibly missed content" overlays — decorative; the amber locationCue banner above
              is the accessible name for location (same convention as focus's page/column cue). */}
          {pageHighlights.map((region, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="pointer-events-none absolute top-0 h-full border-2 border-amber-600/70 bg-amber-400/25"
              style={{ left: `${region.leftFrac * 100}%`, width: `${region.widthFrac * 100}%` }}
            >
              <span className="absolute left-1 top-1 whitespace-nowrap rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
                Possibly missed
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default SourceDocumentPane;
