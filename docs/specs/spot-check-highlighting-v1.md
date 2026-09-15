# Spot-check localization v1: color-coded region highlights for possibly-missed content

Status: Implemented (2026-09-15)

## Problem

The `possiblyIncomplete` fidelity blocker ("Source text suggests more items may be present than
were extracted — spot-check for missed content") flagged the whole document with no way to know
where to look. A page-level-only fix ("go check page 5") was tried first and explicitly rejected —
the ask was to point at *where on the page*, ideally as color-coded regions on the source preview.

## First attempt (superseded) — retained column-tiling geometry

The first cut reused `columnFracs` — fractional column-band boundaries `services/fileService.ts`'s
layout analysis already computes to decide whether to tile a page into per-column images for
Gemini — retaining it instead of discarding it, since it maps directly onto the source-preview
image's own coordinate space with no remapping needed.

This turned out not to work for the documents that matter most here. That geometry is only ever
computed on `imageDominant` pages (near-zero real text — i.e. scanned/flattened images), and real
logic-model PDFs/PPTX typically have genuine embedded text, so the detector never even ran.
Forcing it to run anyway (tested live against a real document) still found **zero** column bands —
the underlying ink-valley detector needs a clean whitespace gutter between columns, and these
colorful box-and-arrow grid layouts often don't have one. Live-testing after shipping this version
confirmed the visible result: every real test document fell back to a full-page highlight, which is
what prompted the redesign below.

## Design (shipped)

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
   old whole-document-only signal rather than reporting a misleading page 1 for everything. This
   signal only ever contributes a page number, never a horizontal position — text extraction order
   doesn't reliably preserve column membership, so it can't honestly claim more than that.
2. **Gemini-reported per-image signal (`server/geminiLogicModel.ts`, `constants.ts`)** — since no
   pixel-detection geometry can be trusted for this document class, region *position* comes
   directly from the vision model's own understanding of the page it's already looking at. A new
   optional schema field, `possiblyMissedRegions: { page, xStart?, xEnd?, note? }[]`, asks Gemini,
   after extracting, to re-look at each TRACK B image and — for any image with content it wasn't
   confident it fully captured — report that page number plus its own visual estimate of the
   content's horizontal span, as a fraction 0–1 of the page width (e.g. "roughly a third of the way
   across to about halfway" → `xStart: 0.33, xEnd: 0.5`). This works whether or not that page was
   column-tiled for extraction, and is the same self-report posture already used for
   `extractionStatus`/`extractionBlockers`, just at image granularity with an added spatial
   estimate.

`shared/extractionFidelity.ts`'s `reconcileExtractionFidelity` merges both into
`model.possiblyMissedRegions`: Gemini's entries (validated/clamped the same way
`extractionBlockers` is — `xStart`/`xEnd` dropped, not the whole entry, when the span is malformed)
are kept as-is; the heuristic only adds a page-only fallback entry for a page Gemini didn't already
flag. Either signal alone can push `ok` → `partial` (same ceiling as the old `possiblyIncomplete`
blocker — never forces `low`/`abstained`).

True pixel/word-level bounding boxes were still not attempted — no reliable *detected* geometry
source exists across formats, and `docs/specs/source-review-v1.md` already defers that as a "Tier
2" gated on evidence. Asking the vision model for its own estimate is a middle ground: coarser than
a real bounding box, but sourced from something that actually looks at the page, rather than a
brittle CV heuristic.

### Rendering

`App.tsx`'s `resolveHighlightRegions()` resolves `model.possiblyMissedRegions` directly to plain
`{ page, leftFrac, widthFrac, note? }` fractions (falling back to `{0, 1}` — full page width — when
Gemini couldn't estimate a span) and passes the full per-file list to `SourceDocumentPane`, which
filters to whichever page is currently displayed — the same pattern already used for the existing
`focus`/`locationCue` cue. Each region renders as a translucent amber overlay
(`SourceDocumentPane.tsx`, wrapping the existing `<img>` in a `position: relative` container) with
a pinned "Possibly missed" label; decorative (`aria-hidden`), matching the project's existing "page
label is the accessible name for location" convention. The fidelity banner
(`LogicModelEditor.tsx`) gained "Pages to spot-check: [N] [M]" chips reusing the existing
`onFocusSource`/`SourceFocus` navigation, extended with an optional `note` override so the chip's
jump can show "Spot-check for missed content" instead of the default verify-against-source cue.

## Verified

Typecheck, all 93 tests (7 new, covering the page-aware heuristic and the Gemini/heuristic merge),
and build pass. Live Playwright pass against a real document: confirmed the fidelity banner shows
page chips and clicking one jumps the source pane; via a response interception injecting a
synthetic `possiblyMissedRegions` entry with `xStart: 0.33, xEnd: 0.5`, confirmed (both via DOM
inspection of the rendered `left`/`width` style and visually, via screenshot) that the highlight
box lands precisely on a single column of the page rather than the whole page — the actual case
that motivated the redesign. Re-ran the three real documents used throughout this session
end-to-end with no injection — all extracted cleanly with no regression.

## Out of scope (v1)

- Pixel/word-level bounding boxes — Gemini's own eyeballed `xStart`/`xEnd` estimate is coarser than
  a true bbox, but was the most reliable geometry source available without new format-specific
  detection work (PDF text-layer coordinates, DOCX `getBoundingClientRect()`, PPTX `<a:xfrm>`
  parsing).
- Vertical (y-axis) span — only horizontal position is estimated; a flagged region highlights the
  full page height within its `xStart`–`xEnd` band.
- DOCX page-level pointing (Track A has no page markers; would need new plumbing to correlate
  Markdown lines to Mammoth/docx-preview render-time page slices).
