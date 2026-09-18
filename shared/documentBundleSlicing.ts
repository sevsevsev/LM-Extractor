import type { DocumentBundle } from '../types';

/** `## Page N` / `## Slide N` markers inserted by services/fileService.ts's Track A builders. */
const PAGE_MARKER = /^##\s+(Page|Slide)\s+(\d+)\s*$/i;

export interface PageRange {
  /** 1-based, inclusive, in terms of the *original* (unsliced) bundle's page numbers. */
  start: number;
  end: number;
}

/**
 * Slice a DocumentBundle down to one contiguous page range, renumbering everything to a fresh
 * 1-based page count starting at 1 — the result is indistinguishable from a normal single-page-
 * range upload, so the whole downstream pipeline (extraction, board, source pane, exports), which
 * treats `previewImages[i]` / `imageRefs[].page` / an item's `sourcePage` as "page i+1 of this
 * document", needs no changes to handle a split entry. See docs/specs/multi-logic-model-pdf-v1.md.
 */
export function sliceDocumentBundle(bundle: DocumentBundle, range: PageRange): DocumentBundle {
  const offset = range.start - 1;

  const previewImages = bundle.previewImages?.slice(range.start - 1, range.end);

  let images: string[];
  let imageRefs: DocumentBundle['imageRefs'];
  if (bundle.imageRefs && bundle.imageRefs.length === bundle.images.length) {
    const keptImages: string[] = [];
    const keptRefs: NonNullable<DocumentBundle['imageRefs']> = [];
    for (let i = 0; i < bundle.images.length; i++) {
      const ref = bundle.imageRefs[i];
      if (ref.page < range.start || ref.page > range.end) continue;
      keptImages.push(bundle.images[i]);
      keptRefs.push({ ...ref, page: ref.page - offset });
    }
    images = keptImages;
    imageRefs = keptRefs;
  } else {
    // No per-image page refs to slice by (shouldn't happen for a bundle detection ran on, since
    // detection requires previewImages from the same page-rendering pass as images/imageRefs) —
    // keep the whole set rather than guess which images belong to this range.
    images = bundle.images;
    imageRefs = bundle.imageRefs;
  }

  return {
    images,
    imageRefs,
    previewImages,
    textTrack: sliceTextTrackByPage(bundle.textTrack, range, offset),
    warnings: bundle.warnings,
    sourceFormat: bundle.sourceFormat,
  };
}

/**
 * Keep only the `## Page N` / `## Slide N` sections within `range`, renumbering their headers to
 * the new 1-based range. When the text track carries no page markers at all (e.g. DOCX Track A,
 * which has no pagination), there's nothing page-scoped to slice by, so every range gets the whole
 * original text rather than an arbitrary, possibly-wrong fragment — Track B images remain the
 * authoritative page-scoped signal for extraction either way.
 */
function sliceTextTrackByPage(textTrack: string, range: PageRange, offset: number): string {
  if (!textTrack.trim()) return textTrack;
  const lines = textTrack.split('\n');
  if (!lines.some(l => PAGE_MARKER.test(l.trim()))) return textTrack;

  const kept: string[] = [];
  let inRange = false;
  for (const line of lines) {
    const match = PAGE_MARKER.exec(line.trim());
    if (match) {
      const label = match[1];
      const page = parseInt(match[2], 10);
      inRange = page >= range.start && page <= range.end;
      if (inRange) kept.push(`## ${label} ${page - offset}`);
      continue;
    }
    if (inRange) kept.push(line);
  }
  return kept.join('\n').trim();
}
