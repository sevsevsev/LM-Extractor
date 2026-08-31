# Discovery — Session UX (multi-file + branded PDF)

Status: **Answered 2026-08-31 — superseded by PRDs**  
Last updated: 2026-08-31  
Agents: @product (this doc + PRDs), @ux, @pattern-analyst, @critic.  
Related: `session-navigator-v1.md`, `ltr-column-review-v1.md`, `current-prd.md`, `roadmap.md`, `source-review-v1.md`

## Locked product (do not reopen)

| Locked | Status |
|--------|--------|
| Export for coding | IN (shipped) |
| PDF + DOCX + PPTX ingest | IN |
| Optional private Vercel | IN (owner-only) |
| Sheets / Jotform / Drive ledger + processing log L1 | PARKED 2026-08-31 |
| Two extracts on screen at once | OUT |

**Users:** owner + 1 colleague.

## Owner answers (2026-08-31)

| Q | Answer | Product fork taken |
|---|---------|-------------------|
| **Q1** volume | Varies. Typical user **5–10**. Owner will also upload a **really large batch**. | **File list** (not tabs). List must survive large N (one mounted workspace). Review-lite **table** stays parked until the list fails. |
| **Q2** PDF job | **Review surface.** Prefer standard L→R columns. Preview is how they **see the model** and **flag extraction/placement errors**. | Do **not** demote Preview in the navigator slice. Unpark **L→R column review** as the next PRD. Do **not** invest in a nicer print-modal as the long-term canvas. |
| **Q3** compare | **No.** | Split-compare OUT. |

Build from `session-navigator-v1.md` then `ltr-column-review-v1.md`. This discovery file is history.

---

## Team consensus (kept for trace)

| Agent | Stance |
|-------|--------|
| **@pattern-analyst** | Master–detail file list. Highest leverage: stop stacking N editors. |
| **@critic** | Queue list + one open file. Readable L→R as the file’s face if Preview is the review path. |
| **@ux** | Six-column board + inspector as expert default for one extract. |
| **@product** | Two surfaces, sequenced: navigator first (Q1 + large batch), then board (Q2). Do not merge into one “fix UX” PRD. |

---

## Sequence (locked)

1. **Session navigator v1** — file list + one editor; Preview overlay **stays**; honest export counts.  
2. **L→R column review v1** — selected file’s default view is columns; click to fix placement; then Preview may become print-only.  
3. **Stop.** Review-lite table, PDF template art, pause/priority, Sheets — still parked.

Source pane stays the raster/fidelity tool. The board is for column placement. They are not the same surface.
