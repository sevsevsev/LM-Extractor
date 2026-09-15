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

### Rendering — and a second correction: no full-page fallback

The first version of this rendering step fell back to `{leftFrac: 0, widthFrac: 1}` (a full-page
box) whenever a region had no `xStart`/`xEnd`. That turned out to be the *common* case in practice:
across every real document available in this session, Gemini's own `possiblyMissedRegions`
essentially never fired (tested repeatedly, including PPTX), while the client-side text heuristic
(§1) — which structurally can only ever know a page number, never a horizontal position — was the
one actually producing the fidelity blocker. So in real usage this almost always rendered as a
full-page box, which is exactly what the page-level-only version already did and had already been
rejected as unhelpful.

Fixed by dropping the fallback entirely: `App.tsx`'s `resolveHighlightRegions()` now filters out
any `possiblyMissedRegions` entry without both `xStart` and `xEnd` before it ever reaches
`SourceDocumentPane` — no overlay box is drawn for those, since a box around the whole page adds
nothing the page-jump chip doesn't already say. The chip itself (`LogicModelEditor.tsx`'s "Pages to
spot-check: [N] [M]", reusing the existing `onFocusSource`/`SourceFocus` navigation, extended with
an optional `note` override) still shows for every flagged page regardless — that part of the
signal (page-level pointing) is real and kept. A highlight box only ever appears in the case Gemini
itself supplies a confident spatial estimate.

Each region that does render is a translucent amber overlay (`SourceDocumentPane.tsx`, wrapping the
existing `<img>` in a `position: relative` container) with a pinned "Possibly missed" label;
decorative (`aria-hidden`), matching the project's existing "page label is the accessible name for
location" convention.

## Verified

Typecheck, all 93 tests (7 new, covering the page-aware heuristic and the Gemini/heuristic merge),
and build pass. Live Playwright passes against real documents: confirmed the fidelity banner shows
page chips and clicking one jumps the source pane; via response interception, confirmed a region
with `xStart`/`xEnd` renders a highlight box landing precisely on that span (verified via DOM style
inspection and screenshot), and confirmed a page-only region (no span) renders the page chip with
**no** overlay box. Ran the natural (non-injected) extraction repeatedly against all 6 real
documents available in this session (3 PDF, 3 PPTX) — Gemini's own `possiblyMissedRegions` did not
fire on any of them, which is the direct evidence behind dropping the full-page fallback.

## Out of scope (v1)

- Pixel/word-level bounding boxes — Gemini's own eyeballed `xStart`/`xEnd` estimate is coarser than
  a true bbox, but was the most reliable geometry source available without new format-specific
  detection work (PDF text-layer coordinates, DOCX `getBoundingClientRect()`, PPTX `<a:xfrm>`
  parsing).
- Vertical (y-axis) span — only horizontal position is estimated; a flagged region highlights the
  full page height within its `xStart`–`xEnd` band.
- DOCX page-level pointing (Track A has no page markers; would need new plumbing to correlate
  Markdown lines to Mammoth/docx-preview render-time page slices).

**Known limitation**: since Gemini's `possiblyMissedRegions` essentially never fired in this
session's testing, the highlight box itself may end up rarely seen in practice — most real
occurrences of this fidelity blocker will show only the page chip, not a box. If that holds up
under more real usage, the next move is either stronger prompting/validation on the Gemini side, or
retiring the box in favor of page-chip-only pointing.
