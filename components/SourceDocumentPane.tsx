import React, { useEffect, useState } from 'react';

export interface SourceFocus {
  page: number;
  column?: number;
  /** Short cue under the page chrome, e.g. "Approximate" */
  note?: string;
}

interface SourceDocumentPaneProps {
  images: string[];
  focus?: SourceFocus | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** When true, show the text-only empty state instead of images. */
  textOnly?: boolean;
}

/**
 * Session source review pane — page rasters from DocumentBundle.previewImages.
 * See docs/specs/source-review-v1.md.
 */
const SourceDocumentPane: React.FC<SourceDocumentPaneProps> = ({
  images,
  focus,
  collapsed,
  onCollapsedChange,
  textOnly = false,
}) => {
  const pageCount = images.length;
  const [pageIndex, setPageIndex] = useState(0); // 0-based
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (focus && focus.page >= 1 && focus.page <= pageCount) {
      setPageIndex(focus.page - 1);
    }
  }, [focus, pageCount]);

  if (collapsed) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Source document</p>
        <button
          type="button"
          className="text-xs font-bold text-blue-600 hover:text-blue-800"
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
        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        aria-label="Source document"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Source document</h3>
          <button
            type="button"
            className="text-xs font-bold text-slate-500 hover:text-slate-800"
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

  return (
    <aside
      className="flex h-full min-h-[20rem] flex-col rounded-lg border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]"
      aria-label="Source document"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Source document</h3>
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
            disabled={zoom <= 0.5}
            onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="min-w-[2.75rem] text-center text-[10px] font-semibold text-slate-500">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-40"
            disabled={zoom >= 2}
            onClick={() => setZoom(z => Math.min(2, Math.round((z + 0.25) * 100) / 100))}
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
        <div className="mx-auto w-fit origin-top" style={{ zoom }}>
          <img
            src={src}
            alt={`Source page ${pageNum} of ${pageCount}`}
            className="block max-w-full shadow-md"
            draggable={false}
          />
        </div>
      </div>
    </aside>
  );
};

export default SourceDocumentPane;
