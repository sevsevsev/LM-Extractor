# Source review v1 — side-by-side source + page anchors

Status: **Implemented (local)** (owner 2026-07-31)  
Agents: @product (scope), @ux (surfaces), @architect (follow-on tech shapes)  
Unparks roadmap candidate: “Side-by-side source preview.”

## Problem

After extraction, operators validate and correct structured items **without seeing what the model saw**. Stacked domain sections already hide cross-domain connections; hunting in a separate PDF window adds more friction. Low-confidence items (`verbatim: false`) ask users to “verify against source” but provide no in-app path to that source.

## JTBD

While reviewing an extracted logic model, **see the original document beside the structured results**, and **jump from an item to the page (and rough column) it came from**, so fidelity checks and remaps are fast and trustworthy.

## Users

Same as MVP: tool owner + one colleague, local session.

## In scope (v1)

### A. Source pane (always available when images exist)
- Retain extraction page rasters (`DocumentBundle.images`) on the `ProcessingFile` for the session (revoke / drop on Remove).
- Split layout: **source pane** + **results/editor pane** while status is `editing` / `completed`.
- Source pane shows page images (PDF/DOCX/PPTX all via existing conversion rasters — one viewer path).
- Page navigation: prev/next + page indicator (`2 / 5`).
- Zoom: fit-width default; simple zoom in/out (CSS/`transform`, no new deps).
- Toggle: collapse source pane to reclaim width (remember per session is enough).
- Empty/fallback: if conversion produced **no images** (text-only path), show a clear notice — “No page preview for this file (text-only extract). Open the original file outside the app.” Do not invent a second DOCX renderer for v1.
- Distinguish from existing **Print Preview** (branded export). Rename/clarify export control if needed (e.g. “Preview branded PDF”) so “Source” ≠ export preview.

### B. Soft item → source link (Tier 1)
- Optional per-item fields (additive; absent = unknown):
  - `sourcePage?: number` — 1-based index into retained page images (full-page index, **not** crop-tile index).
  - `sourceColumn?: number` — 1-based column band when column tiling / layout evidence exists; omit when unknown.
- On item focus/select (click or keyboard): if `sourcePage` present, source pane navigates to that page; show a non-blocking cue (“Page 2 · column 3” or “Page 2 · location approximate”).
- If only page is known, highlight nothing geometric — just navigate + label.
- If column known and column-band geometry was retained for that page, optional soft overlay (translucent band). **No per-item bounding boxes in v1.**
- Anchors are **immutable after extract** (human text edits / remaps do not clear `sourcePage` / `sourceColumn`).
- `verbatim: false` items: affordance “Show in source” (or auto-scroll source on first focus) — reuse existing verify badge pattern.
- Extraction prompt/schema: request `sourcePage` when reasonably confident; prefer omit over guess. Map crop tiles back to parent full-page index in normalize (architect detail).

### C. UX chrome (minimal)
- Selecting an item is the primary link gesture; optional explicit “Show in source” control on the item row for discoverability.
- Source pane does not become an editor; results pane keeps edit / critique / unmapped assign.
- No second “mode” app chrome — one editor with an optional source column (aligned with source-aware mapping v1: avoid competing modes).

## Out of scope (v1)

- Pixel-perfect item bounding boxes / freeform region draw
- PDF.js text-layer search highlight (Tier 3)
- Persistent save of rasters or anchors across refresh (session save/load remains separate candidate)
- Full traditional L→R “board” review layout (separate candidate; this spec does not block it)
- Side-by-side of **two domains** only (pair-compare)
- Replacing branded PDF Print Preview
- New npm packages (pdf viewer libs, etc.)
- Sync-scroll of source with stacked editor without item selection
- Cloud storage of originals

## UX layout structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│ File bar · status · [Source | Editor] density · Preview branded PDF …   │
├──────────────────────────────┬──────────────────────────────────────────┤
│ SOURCE                       │ RESULTS                                  │
│ [◀] Page 2 / 4 [▶]  − 100% + │ Mission / summary / mismatch banner      │
│                              │ Unmapped                                 │
│ ┌──────────────────────────┐ │ Domain sections (existing stacked edit)  │
│ │  page raster             │ │  • item  ← focus → jump source page      │
│ │  (optional column band)  │ │  • Verify against source → Show in source│
│ └──────────────────────────┘ │                                          │
│ Fit width · scroll if tall   │ Critique / remap controls unchanged      │
└──────────────────────────────┴──────────────────────────────────────────┘
```

**Breakpoints**
- `lg+`: true split (~40% source / ~60% results; user-collapsible source).
- `< lg`: stacked — results first; “View source” opens source in a drawer/panel above or full-width toggle (avoid tiny dual columns).

**Accessibility**
- Page controls keyboard-operable; focus order: results item → “Show in source” moves focus to source pane landmark.
- Overlay bands are decorative; page label is the accessible name for location.
- Contrast on cues ≥ 4.5:1 for text labels.

**States**
| State | Behavior |
|-------|----------|
| Images retained | Source pane enabled |
| Text-only extract | Source pane message; no fake pages |
| Item without `sourcePage` | Select still works; cue “Page unknown — browse source manually” |
| Low-confidence link | Cue “Approximate” |
| File Remove | Drop blob URLs / base64 images from memory |
| Re-critique | Keep anchors; do not require re-extract |

## Acceptance criteria

1. After a successful image-backed extract, user can view source page rasters beside the editor without leaving the app.
2. Source pane supports page next/prev and fit-width zoom; can be collapsed.
3. Print/export preview remains available and is clearly labeled as branded/export preview, not source.
4. When `sourcePage` is present, focusing/selecting an item (or “Show in source”) navigates the source pane to that page and shows a location cue.
5. Items with `verbatim: false` expose an obvious path to show source.
6. Text-only extracts degrade gracefully (message, no broken image UI).
7. No new npm dependencies; Gemini key remains server-only.
8. Anchors survive item text edits and domain remaps; cleared only on re-extract of that file.
9. Typecheck / existing unit tests still pass; additive optional fields only on `LogicModelItem`.

## Open questions (non-blocking for v1 start)

1. Default split: source **left** (reading-order / LM tradition) vs **right** (editor-primary)? Recommendation: **source left** on `lg+`.
2. Should mismatch / unmapped review **auto-open** source pane if collapsed? Recommendation: **yes** when banner is shown.
3. Retain full-resolution JPEGs vs downscaled preview copies for memory — architect decision under ≤15 page cap.

## Implementation order (suggested)

1. Retain images on `ProcessingFile` + source pane UI + collapse + text-only fallback.  
2. Clarify Preview branded PDF labeling.  
3. Add `sourcePage` / `sourceColumn` to types + extract schema + normalize (tile→page map).  
4. Wire item select → navigate + cue; verify-badge “Show in source”.  
5. Optional column-band overlay if band geometry is cheap to retain from `columnDetect`.

## Success signal

In the next 3 real-doc sessions, operators can confirm or correct at least one doubtful item **without** opening the file in an external viewer. Log in `friction-log.md` if page jump is still insufficient (evidence gate for bbox Tier 2).
