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
