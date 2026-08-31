# L→R column review v1

Status: **Implemented (local)** (owner 2026-08-31) — **after** `session-navigator-v1.md`  
Agents: @product (scope). @ux / @architect after navigator is in progress or done.  
Unparks: roadmap “L→R review board.”  
Related: `session-navigator-v1.md`, `source-review-v1.md`, `ux-session-surfaces-discovery.md`

## Problem

The native object is a **left-to-right** logic model (Inputs → Activities → Outputs → Short → Medium → Long). The shipped editor is a vertical form; Strong/Adequate sections start collapsed. Operators open **Preview branded PDF** to see columns and to **spot strings in the wrong domain**. That overlay is a zoomed print clone (hard to read, Impact column omitted, extra click per file).

Source review v1 already covers “does this match the page.” It does not cover “is this string in the right column of the chain.”

## JTBD

For the **selected** file, **read the extract as a standard column logic model**, click a misplaced or badly extracted string, and **correct placement or wording** without a print-preview detour.

## Users

Same as MVP. Review is always **one file** (split-compare OUT).

## Locked from owner (2026-08-31)

- Preferred view of an extract: **standard L→R columns**.
- Preview is used both to **see** that layout and to **flag extraction/placement errors**.
- Do not show two extracts at once.

## In scope (v1)

- Default face of the **selected** file: six-column board (Resources/Inputs → Long-term). If Impact **items** exist, they are visible on the board (do not hide them the way the print template currently does).
- Items are readable at a working size (fit-width **or** 100% — not a postage-stamp CSS `zoom` of a 1400px print page).
- **Click an item** → inspector (or equivalent disclosure): edit text, assign/remap domain, item critique, “Show in source” if the source pane is available.
- Unmapped items remain reachable (bucket or board region), still assignable to a domain.
- Stacked domain form stays available as **Edit fields / critiques** (progressive disclosure), not as the first view.
- After this ships, branded PDF **Download** remains; Preview overlay may be demoted to print proof (optional). Do not delete PDF export.

## Out of scope (v1)

- Drag-and-drop between columns (remap via assign/domain control is enough).
- Restyling the **downloadable** PDF brand, typography, or per-column print pagination (separate PDF-export candidate if recipients reject the file).
- Replacing or merging the **source pane** with the board. Source = page rasters; board = structured columns.
- Two-file compare, review-lite table, bounding boxes, new npm PDF viewers.
- Building the board for **every** file at once (navigator: one selected file only).
- Coding UI / Sheets / session persist.

## Why not “make the PDF modal nicer”

A readable modal of the print template would still be a second canvas, still omit Impact, and still lack edit/remap. The job is **review and correct placement**. The board belongs in the main workspace of the selected file.

## Acceptance criteria

1. After extract, the selected file’s primary view is L→R columns, not a stack of collapsed `<details>`.
2. Operator can see a string in the wrong column, select it, and remap or edit without opening Preview branded PDF.
3. Impact items present in the model are visible on the board.
4. Source pane still works for the selected file (collapse, page jump on item select when `sourcePage` exists).
5. Only the selected file mounts a board (navigator constraint).
6. Branded PDF download still works.
7. No new npm; Gemini key stays server-only.

## Open questions (non-blocking for navigator; gate board interaction polish)

1. Inspector: side panel vs sheet below the board? Recommendation: **side inspector** on `lg+`, sheet on small viewports.
2. Colour (`fillColor` / `borderColor`): show as a chip on the card in v1? Recommendation: **yes** if present — it is an SDP axis, not decoration.

## Success signal

In a 5–10 file sitting, operators catch at least one placement/extraction error **on the board** and do not need Preview to understand the model. Log remaining print bugs against PDF export, not this PRD.

## Implementation order (suggested)

1. Ship `session-navigator-v1.md` first (one selected file). Keep Preview until this PRD lands.  
2. Board as default view of selected file + click → inspector (edit / remap / source).  
3. Demote Preview overlay to optional print proof; keep Download PDF.
