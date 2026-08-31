# Session navigator v1 — one active file

Status: **Implemented (local)** (owner 2026-08-31)  
Agents: @product (scope). @ux / @architect after this PRD.  
Unparks: roadmap “Session navigator (one active file).”  
Related: `ltr-column-review-v1.md` (next surface), `ux-session-surfaces-discovery.md`, `source-review-v1.md`

## Problem

Uploading several files mounts **every** ready editor (and often its source pane) in one long page. At 5–10 files the operator cannot scan the batch; a larger dump makes the session unusable. Status and incomplete-export risk live only on cards you have already scrolled past.

## JTBD

When several (or many) logic models are in one sitting, **see the queue**, **work one file at a time**, and **export only what is ready** — without scrolling through other programs’ editors.

## Users

Owner + one colleague. Typical sitting: **5–10 files**. Owner may also drop a **large batch**; that is the same switcher, not a different product.

## Locked from owner (2026-08-31)

| Q | Answer | Implication |
|---|--------|-------------|
| Files per sitting | Varies; typical **5–10**; owner will also run a **large batch** | Persistent **file list**, not tabs. List must stay usable when N is large (do not mount N editors). Not a review-lite spreadsheet in v1. |
| Branded PDF | **Review surface** — L→R columns to spot extraction/placement errors | **Do not** demote Preview in this PRD. Overlay stays until `ltr-column-review-v1.md` ships. |
| Two extracts at once | **No** | Split-compare **OUT**. |

## In scope (v1)

- Compact **file list** (filename + program when known, status, error/fidelity cue). Click selects.
- **One** expanded workspace at a time: existing stacked editor + existing source pane for the selected file only.
- Header **session status**: ready / running / queued / needs attention (counts).
- Header exports named with **counts**; if ZIP/CSV would omit queued or failed files, **warn** before download. Do not label “All” unless every file in the session is ready.
- Once `files.length > 0`, shrink hero + dropzone to a compact **Add files** control (drag-drop still works).
- Serial Gemini queue **unchanged** (one extract/critique at a time).
- Preview branded PDF, Download PDF, source pane, coding export, full CSV, Retry/Remove — still available on the **active** file (Preview stays).

## Out of scope (v1)

- L→R board, editor restyle, PDF template art / pagination / brand (`ltr-column-review-v1.md`).
- Demoting or removing the Preview overlay.
- Review-lite results table, pause/priority/cancel in-flight, session save/load, two-file compare.
- Sheets / Jotform / Drive ledger (parked).
- New npm packages.

## Acceptance criteria

1. With 5–10 files in the session, only **one** `LogicModelEditor` (and at most one source pane) is on screen.
2. A large batch does not mount N editors; the list remains the switcher (scroll the list, not the page of forms).
3. Sticky header shows live counts for ready / running / queued / error (or equivalent “needs attention”).
4. ZIP and CSV labels include how many files will be included; incomplete batch requires confirm or equivalent warning.
5. Adding files after the first drop still works (PRD AC1).
6. Preview branded PDF still opens for the selected ready file.
7. No new npm; Gemini key stays server-only.

## Success signal

Next multi-file sitting: operator switches files without scrolling past other models. ZIP is not mistaken for a complete folder while files are still queued.

## Implementation order (suggested)

1. `selectedFileId` + list; unmount non-selected editors.  
2. Header counts + honest export labels/warn.  
3. Compact Add files after first drop.
