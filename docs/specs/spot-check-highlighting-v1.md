# Spot-check localization v1: color-coded region highlights for possibly-missed content

Status: Implemented (2026-09-15)

## Problem

The `possiblyIncomplete` fidelity blocker ("Source text suggests more items may be present than
were extracted — spot-check for missed content") flagged the whole document with no way to know
where to look. A page-level-only fix ("go check page 5") was tried first and explicitly rejected —
the ask was to point at *where on the page*, ideally as color-coded regions on the source preview.

## Design

Two complementary signals feed one merged pointer, rather than one signal doing both jobs:

1. **Client-side heuristic (`shared/completenessCheck.ts`)** — cheap, deterministic, already
   existed as a whole-document trigger. Made page-aware: `reflowWrappedLines` now tracks the
   nearest preceding `## Page N` / `## Slide N` marker (already inserted into Track A by
   `services/fileService.ts`) and tags each candidate line with a page. When the heuristic fires,
   it additionally buckets candidate lines by page, compares against actual extracted-item counts
   per page (`sourcePage` on items, already existed end-to-end from `source-review-v1.md`), and
   returns the top few pages by gap size as `suspectPages`. DOCX Track A has no page markers
   (Mammoth's Markdown carries no page boundaries — pagination happens later, purely visually), so
   `suspectPages` is only ever populated when the text actually carried markers; DOCX keeps the
   old whole-document-only signal rather than reporting a misleading page 1 for everything.
2. **Gemini-reported per-image signal (`server/geminiLogicModel.ts`, `constants.ts`)** — the text
   heuristic has no way to know which *column* of a multi-column page a gap belongs to (PDF/DOCX
   text extraction doesn't reliably preserve column order). Gemini, however, already looks at each
   column tile as a separate image and is already given that image's page/column in a text label
   ("TRACK B image 3 of 7: document page 3, column 2"). A new optional schema field,
   `possiblyMissedRegions: { page, column?, note? }[]`, asks it to self-report, per image, whether
   that crop had content it wasn't confident it fully captured — the same posture as the existing
   `extractionStatus`/`extractionBlockers` self-report, just at image granularity instead of
   whole-document.

`shared/extractionFidelity.ts`'s `reconcileExtractionFidelity` merges both into
`model.possiblyMissedRegions`: Gemini's entries (validated/clamped the same way
`extractionBlockers` is) are kept as-is; the heuristic only adds a page-only fallback entry for a
page Gemini didn't already flag. Either signal alone can push `ok` → `partial` (same ceiling as the
old `possiblyIncomplete` blocker — never forces `low`/`abstained`).

### Geometry: reusing already-computed data, not inventing new geometry

`services/fileService.ts`'s PDF/DOCX layout analysis (`analyzePdfPage` / `analyzeDocxSection`)
already computes `columnFracs` — fractional column-band split points — whenever a confident
multi-column grid is detected, as part of deciding whether to tile that page into separate
per-column images for Gemini. That geometry was computed and then discarded before reaching
`DocumentBundle`. Critically, the *source review pane's* preview image for that page
(`previewImage`) is rendered from the exact same cropped canvas `columnFracs` are fractions of —
so a band like `{start: 0.34, end: 0.67}` is already `left: 34%, width: 33%` on the preview image
with zero coordinate remapping, on PDF, DOCX, and PPTX (which reuses the PDF pipeline) alike.
`DocumentBundle.columnFracs` / `ProcessingFile.sourceColumnFracs` now retain this per-page,
parallel to `previewImages`.

True pixel/word-level bounding boxes were explicitly not attempted — no consistent source of that
geometry exists across formats (PDF's native text layer could yield it; DOCX/PPTX have no
equivalent without new, format-specific plumbing), and `docs/specs/source-review-v1.md` already
defers that as a "Tier 2" gated on evidence this session didn't have.

### Rendering

`App.tsx`'s `resolveHighlightRegions()` resolves `model.possiblyMissedRegions` +
`file.sourceColumnFracs` down to plain `{ page, leftFrac, widthFrac, note? }` fractions (falling
back to `{0, 1}` — full content width — when no column band is known for that region, e.g. a
single-column page or a page Gemini didn't flag by column) and passes the full per-file list to
`SourceDocumentPane`, which filters to whichever page is currently displayed — the same pattern
already used for the existing `focus`/`locationCue` cue. Each region renders as a translucent
amber overlay (`SourceDocumentPane.tsx`, wrapping the existing `<img>` in a `position: relative`
container) with a pinned "Possibly missed" label; decorative (`aria-hidden`), matching the
project's existing "page label is the accessible name for location" convention. The fidelity
banner (`LogicModelEditor.tsx`) gained "Pages to spot-check: [N] [M]" chips reusing the existing
`onFocusSource`/`SourceFocus` navigation, extended with an optional `note` override so the chip's
jump can show "Spot-check for missed content" instead of the default verify-against-source cue.

## Verified

Typecheck, all 93 tests (7 new, covering the page-aware heuristic and the Gemini/heuristic merge),
and build pass. Live Playwright pass: uploaded a real document, confirmed the fidelity banner shows
page chips, clicking one jumps the source pane and shows the location cue, and — via a response
interception injecting a synthetic `possiblyMissedRegions` entry to force both code paths —
confirmed both the column-band overlay (correct `left`/`width` fractions match the retained
`columnFracs`, verified via DOM inspection) and the full-width fallback (when no column geometry is
known, which was the case for all three real test documents — none of them triggered confident
column-grid detection) render correctly. Re-ran the three real documents used throughout this
session end-to-end with no injection — all three extracted cleanly with no regression.

## Out of scope (v1)

- Pixel/word-level bounding boxes (see Design above — no consistent cross-format geometry source).
- Highlighting on non-column-tiled pages beyond a full-content-box outline.
- DOCX page-level pointing (Track A has no page markers; would need new plumbing to correlate
  Markdown lines to Mammoth/docx-preview render-time page slices).
