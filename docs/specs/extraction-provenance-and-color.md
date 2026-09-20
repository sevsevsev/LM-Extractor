# Extraction fidelity: provenance, colour, and raster legibility

Status: Implemented (2026-07-30)
Trigger: Real-doc friction — **Oxford Circle CCDA (Carnell FRC)**. See `friction-log.md` #1 and
`fixtures/oxford-circle-carnell-frc/`.

This is an evidence-gated fidelity fix (roadmap Phase 1 → micro-fix), not a new product surface. It
addresses one documented failure cluster: a flattened-raster logic model whose Resources sub-headings
were copied into other columns, whose colour coding was ignored, and where the model fabricated content
and reversed an outcome.

## Problem (observed)

On the Oxford Circle document the export showed:
- **False taxonomy** — the four Resources buckets (e.g. "Material & Financial Resources") were copied
  across Activities/Outputs/Outcomes, then mutated (e.g. → "Behavioral & Mental Health").
- **Fabrication** — invented partner "St. Christopher's Hospital" and "classroom-based Behavioral
  Therapy Specialists"; a reversed outcome ("reduction in trauma-related behaviors" → "prosocial
  behaviors"); OCR errors ("grade bands" → "green bands", "donation" → "practicum"); dropped items.
- **Lost structure** — the document's real cross-cutting axis (an author-defined categorization, likely
  population, encoded by box colour with **no legend**) was discarded; a contrasting border marking a
  second category was ignored.
- **Silent low resolution** — page 2 has no text layer (a single ~1211 px raster). The pipeline rendered
  the whole page at scale 2.5 with ~45% white margin, leaving body text at ~8 px, and degraded silently
  on a size budget.

## Changes

### 1. Prompt — stop instructing the false taxonomy (`constants.ts`)
- Colour is explicitly **not** proof of a horizontal track; tracks require a repeated band label spanning
  multiple columns. Most models have none.
- New **Grouping Gate**: a group name must be visible *in that column*; "General" is the normal default,
  not a fallback. Resources sub-headings must never be copied into other columns; labels are never renamed.
- New anti-fabrication + clipped-text rules: transcribe only what is visible; never complete truncated
  text; flag uncertain/clipped items with `verbatim: false` + `sourceNote`.
- New colour-capture rules (see #3) and a note that the model may receive per-column tile images.

### 2. Provenance on every item (`types.ts`, schema, `shared/provenance.ts`)
`LogicModelItem` gains optional `verbatim`, `sourceNote`, `fillColor`, `borderColor`.
- Extract and critique Gemini schemas carry these fields.
- `reconcileProvenance()` restores them after critique (models often drop optional fields); wired into
  `critiqueLogicModelOnServer`. `extractNormalize` preserves them when relocating items.
- Editor shows a "Verify against source" badge + note and a "Mark reviewed" action; both CSV exports gain
  the flag (`Needs Review` / `needs_review`), and the full CSV gains Source Note + Fill/Border Color.

### 3. Colour as a cross-cutting axis (model-reported, robust)
Rather than pixel-sampling box colours (fragile), the vision model reports `fillColor` and, when the
border differs, `borderColor`. Colour is **metadata only** — it never changes an item's column or group,
and its meaning is **not assumed** (it may encode population, program component, priority, funding, etc.).
The model records the raw colours regardless of whether a key exists, and copies an explicit colour
key/legend into the top-level `colorLegend` **only when the document actually shows one** — no meaning is
inferred otherwise. Coding export surfaces `color_coding` + `color_legend`; the full CSV adds a
`Color Legend` column.

### 4. Raster-aware rendering (`services/fileService.ts`)
`convertPdfToImages` now returns `{ images, warnings }` and:
- **Probes** each page cheaply to find the content bounding box and detect image-dominant pages
  (little/no text layer).
- **Crops to content** (drops white margins) and renders image-dominant pages at a higher scale
  (`IMAGE_DOMINANT_SCALE`) so glyphs get more pixels.
- Degrades on a payload budget by lowering JPEG quality first, then scale (legibility-aware), and
  **surfaces a warning** when an image page still ends up below `LEGIBILITY_FLOOR_PX`, plus a warning
  when the 15-page cap truncates.
- Falls back to the previous tier renderer on any error (no regression risk).

### 5. Column tiling for dense grids (`services/columnDetect.ts`)
For image-dominant grid pages, a whitespace-projection detector (`findColumnBands`, pure + unit-tested)
finds column gutters. When ≥3 confident bands are found, the page is sent as **per-column zoomed tiles**
(left→right, each including its header) *instead of* the whole page — maximising legibility and making
column identity structural, with no double-counting. Anything ambiguous falls back to the cropped full page.

## 6. Distinguishing a genuine scan from a high-DPI vector/outline export (2026-09-15)

Trigger: real-doc friction — **PEAL Center Youth Leadership Academies**. A clean, professionally
designed PDF (rounded-corner "card" boxes, arrows, crisp text) hard-stopped with "Low-resolution
dense grid — transcription is not reliable enough to continue," even though the render came out
at 3200-3500px (well above `LEGIBILITY_FLOOR_PX`).

**Root cause**: `imageDominant` (page has < 40 extractable text characters) was treated as
synonymous with "flattened raster scan" everywhere downstream — `lowLegibility` was forced `true`
for *any* image-dominant page regardless of the page's actual rendered resolution, then
`reconcileExtractionFidelity`'s `lowLegibilityDense` guardrail (`L && N >= 6`) hard-stopped the
whole document. But "no extractable text layer" has two very different causes: a genuine scanned
page (resolution-limited — upscaling interpolates rather than recovers detail, so the existing
"always risky" treatment is correct), or a page composed of separately-exported high-DPI vector
art / outlined-text graphics (e.g. design-tool "card" shapes with shadow/rounded-corner effects
that don't translate to PDF vector ops) — which is resolution-independent and, when the source
assets are genuinely high-DPI, perfectly legible.

**Fix** (`analyzePdfPage` in `services/fileService.ts`): resolve the page's actual embedded raster
objects via pdfjs's public `page.objs` (populated by the probe render) and check `OPS.paintImage*`
operator codes in `page.getOperatorList()`. A page's `hasEmbeddedRaster` flag — which still gates
the unconditional "always risky" treatment — is only relaxed to `false` (falling through to the
same `contentPx < LEGIBILITY_FLOOR_PX` check vector pages already use) when there are **≥3
distinct** embedded raster assets and **all** of them are individually ≥700px on their shorter
side. The distinct-asset-count threshold matters: a genuine full-page scan is virtually always one
object, so a single low-res image (however large) or a small number of raster fragments still gets
the conservative treatment; only many separately-high-fidelity assets clear the bar.

Verified against the source PDF: page 1 (Impact Statement) has zero embedded raster — pure
vector/outlined text. Page 2 (the 6-column grid) has 10 embedded JPEGs, one per "card" element,
each 858-2396px on its long side (confirmed via both pdfjs's resolved image objects and a raw
`/Width`/`/Height` scan of the PDF bytes) — comfortably above the 700px floor. Re-processing after
the fix: no warnings, `ok`/`high` confidence, 31 items extracted correctly (spot-checked against
source: organization, program, impact statement text, and all six domains match). The two
previously-verified real documents (Foster Grandparent Program, PHENND) re-ran with no change in
outcome, confirming no regression on genuine cases the "always risky" path is meant to protect.

## 7. Native-DPI check replaces the asset-count bypass (2026-09-19)

Trigger: a real 112-file batch audit (see `docs/specs/tech-extraction-confidence-v1.md`) flagged a
"flattened-raster hard-stop" cluster. Hand-verifying two of the hard-stopped files against their
source PDFs — **Oxford Circle CCDA (Carnell FRC), the very document that motivated this whole
guardrail**, and **LULAC National Educational Service Centers (Talent Search)** — found both
page renders were crisp at 300 DPI with zero visible artifacts, and that **every single
`verbatim: false` item Gemini flagged (15/15 across the two files) was an exact-match transcription
of the source**. The pipeline discarded two fully-accurate extractions and told the operator to
re-key them by hand.

**Root cause**: the section 4 rendering fix (higher scale for image-dominant pages) had already
fixed Carnell FRC's original 8px-text problem — but the `hasEmbeddedRaster` flag from section 6
still forced `lowLegibility = true` unconditionally for *any* image-dominant page with raster paint
ops, independent of how well it actually rendered. Carnell FRC page 2 has only 2 distinct raster
assets (a thin letterhead banner + the grid content); LULAC Talent Search has 1. Both were far
under the ≥3-distinct-assets bypass from section 6, so neither ever got a chance at the
"comfortably high-resolution" trust check — despite that check's own per-asset floor (700px on the
shorter side) being satisfiable by both, had it run. Worse, `lowLegibility = true` also flows into
the extraction prompt's `LOW-RESOLUTION SOURCE` block (`constants.ts`), which **mandates**
`verbatim: false` on any proper-noun/number item "to be safe" — manufacturing exactly the inflated
non-verbatim ratio that then independently justified the low-confidence hard-stop, on a page that
was actually being transcribed perfectly.

**Fix** (`analyzePdfPage` in `services/fileService.ts`): replace the "≥3 assets, each ≥700px on its
shorter side" bypass with a real DPI-equivalent check, applied regardless of asset count. Each
raster paint op's operator-list position is replayed against a tracked CTM (`save`/`restore`/
`transform`, via a small `trackImagePlacements` matrix-stack walk) to recover how large that
asset's unit square was actually rendered on the page, in points. Native DPI = the asset's native
pixel dimensions (from `page.objs`, populated by the probe render) divided by its rendered size in
inches. `hasEmbeddedRaster` is only relaxed to `false` when every distinct asset's native DPI (its
worst instance, if painted more than once) clears `RASTER_NATIVE_DPI_FLOOR` (120) — a threshold
picked below both real documents' measured values with margin, while still well above the visible
degradation point for printed text. This directly fixes the aspect-ratio blind spot in the old
per-asset check too: a naturally thin/small asset (like a letterhead banner) is no longer penalized
for its shape, only for genuinely low pixel density relative to its own placement.

Verified live end-to-end (not just the DPI math in isolation): Carnell FRC's two assets measured
177.7 and 186.3 DPI; LULAC Talent Search's one asset measured 138.0 DPI — both comfortably above
the floor. Re-processing both through the real pipeline after the fix: `ok`/`high` confidence, zero
blockers, ready to export — no rendering change, no prompt change, same Gemini call, just no longer
told to distrust itself. The `RASTER_NATIVE_DPI_FLOOR` is a physical-quantity threshold (pixels per
rendered inch), so a genuinely low-native-resolution scan is unaffected by this change and keeps
the original hard-stop protection; no regression case was available to test directly (no confirmed
bad-scan sample in hand), but the check now measures the quantity the original 700px/asset-count
heuristics were only crudely approximating.

## 8. Same fix ported to DOCX (2026-09-19)

Trigger: re-running the full batch after §7 shipped (flag rate dropped 65% → 24%) surfaced **Girl
Scouts of Eastern Pennsylvania** as a newly-visible false positive — a real 112-file batch audit
round-trip catching the sibling bug immediately, one conversation turn later.

**Root cause**: the DOCX renderer (`renderDocxVisionPages`/`analyzeDocxSection`) never shared §6/§7's
raster-vs-vector distinction at all — it has its own, simpler image-dominance signal (`<img>`
elements covering ≥35% of a section's rendered area, since a Word page can embed a raster but is
never itself a flattened scan), but that signal alone directly set `lowLegibility = true` with zero
resolution check of any kind — not even the old, narrow asset-count bypass PDF had before §7.

Girl Scouts' single content image (`word/media/image1.png`, a Discover/Connect/Take Action outcomes
diagram) is 948×786 native pixels, displayed at 624×517 CSS px — i.e. *downscaled* on the page, not
upscaled. Extracted directly from the docx zip and viewed at native resolution: crisp, no artifacts.
Yet it hard-stopped with the same "Low-resolution dense grid" message.

**Fix**: added `hasLowResEmbeddedImage` to `DocxSectionAnalysis`, computed the same way as the PDF
DPI check but simpler — a DOM `<img>` exposes `naturalWidth`/`naturalHeight` directly, no CTM replay
needed. Display size (`getBoundingClientRect()`) is converted to inches via `DOCX_RENDER_WIDTH_PX`'s
assumed physical page width (`DOCX_PAGE_WIDTH_IN = 8.5`, matching the fixed-width container
`renderDocxVisionPages` already renders into), then compared against `RASTER_NATIVE_DPI_FLOOR` — the
same constant and threshold as the PDF path, since it measures the same physical quantity. Kept
`imageDominant` itself unchanged (it still independently decides render scale, same as PDF's
`imageDominant`/`hasEmbeddedRaster` split) — only what drives `lowLegibility` changed.

Verified live: Girl Scouts' image computed to 178.8 DPI (well above the 120 floor); re-processing
after the fix gives `ok`/`high`, zero blockers, and the 22 extracted items match the source image
exactly (6 activities, 15 medium-term outcomes across 3 named groups, 1 long-term outcome).

A second file from the same re-run, **YMCA Teen Workforce Development Program**, also newly
hard-stopped with a similarly-worded warning ("Page 2 ... contains a low-resolution embedded
image") — but its docx zip has **zero embedded media** (`word/media/` is empty), and re-running it
against this sandbox's dev server 4 times (before and after the fix) never reproduced the warning
once; it processed cleanly every time. Its warning must come from `legibilityWarningFor`'s *other*
trigger — small rendered content size alone (`contentPx < LEGIBILITY_FLOOR_PX`), independent of
whether an image exists at all, which the warning text misleadingly always blames on "an embedded
image." Left uninvestigated: not reproducible here, so no fix was attempted; flagging that this
warning's wording can be inaccurate, and that DOCX content-size measurement may have its own
run-to-run non-determinism (a plausible cause is `html2canvas` capturing before webfonts finish
loading, though this is a guess, not confirmed) worth a closer look if it recurs.

## Guardrails honoured
- **Zero new dependencies** — uses existing `pdfjs-dist` + canvas.
- **Secrets** — no change to key handling.
- **No scope creep** — additive optional fields; branded PDF output unchanged; colour never re-buckets.

## Acceptance / verification
- `npm run typecheck`, `npm run build`, and `npm test` pass.
- Unit tests: `columnDetect.test.ts`, `provenance.test.ts`, extended `codingExport.test.ts` and
  `extractPlacement.test.ts` (fabrication + General-only grouping guards).
- Live AC (needs a Gemini run, owner to confirm): re-extract the Oxford Circle PDF, save
  `fixtures/oxford-circle-carnell-frc/extract-snapshot.json`, and confirm `extractPlacement.test.ts`
  passes — i.e. no fabricated strings, non-Resources columns group as "General", the clipped TF-CBT
  activity is flagged, and colour tags are populated.

## Follow-ups (not in this change)
- Optional true native-image extraction (avoid any re-compression) if legibility still limits.
- Optional colour-cluster grouping in the UI (group items by shared colour) once real docs show demand — **partial 2026-08-31:** unlabeled multi-colour fills surface as a board filter; single-fill and per-column paint are treated as decorative, not categories.
