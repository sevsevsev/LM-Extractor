# Current PRD — Logic Model Extractor (SDP Edition)

Status: Active local MVP (2-person) + scoped enhancements  
Last updated: 2026-09-15

> **2026-09 scope narrowing:** document-quality critique (Overall LM quality S/A/W, per-domain/item
> critique, causal-chain lens) is deprecated and removed from this app — see
> `scope-extraction-only-2026-09.md`. Sections below that describe critique are historical; the app
> is now extraction-only.

## Problem
Program staff receive logic models in heterogeneous formats (PDF, Word, PowerPoint). Manual transcription into a consistent structure is slow, and quality review against logic-model guidance is inconsistent.

## Primary users
- **Now:** Tool owner + one colleague (ingest, extract, edit, export).
- **Later (unscoped):** Broader SDP / partner staff — only after an explicit PRD update.

## Job to be done
Upload a logic-model document → reliably extract **all** LM domains into a structured, editable model → refine → export (1) a **full** flat file for database population and (2) an **outcomes** CSV for Qualitative Outcomes Coder, plus optional SDP-branded PDF.

## Pipeline role
This app is the **LM Extraction Tool** (see `pipeline-context.md`). Sibling: **Qualitative Outcomes Coder**. LM Feedback Module is a separate program-facing utility.

## In scope (MVP — shipped)
- Multi-file upload: PDF, DOCX, PPTX (PDF recommended for layout fidelity)
- Vision-first extraction with text fallback (15 page/slide cap)
- Single-pass Gemini extract (two-pass extract+critique **deprecated 2026-09**, see below)
- Human-in-the-loop editing
- Full CSV export (granular rows) + branded PDF
- Clear error, retry, and remove controls
- Server-side Gemini proxy; local hosting for two users

## In scope (scoped next — owner 2026-07-24)
1. ~~**Overall LM quality** — single Strong/Adequate/Weak + rationale bullets; see `lm-quality-rubric.md` (tweakable). Store **all** item/domain assessments in the model and full export.~~ **Deprecated 2026-09** — removed, see `scope-extraction-only-2026-09.md`.
2. **Export for coding** — dedicated CSV matching coder intake; see `export-for-coding.md`. **Implemented.**

## In scope (scoped — owner 2026-07-31)
3. **Source review v1** — side-by-side source page rasters + soft item→page (optional column) anchors for validation; no bounding boxes. See `source-review-v1.md`.

## In scope (scoped — owner 2026-08-10)
4. **Extraction confidence + abstention v1** — document-level `ok` / `partial` / `abstained` + categorical confidence + blockers; deterministic rollup from provenance/mismatch/legibility; fidelity banner; soft-gate coding export on partial/low. **Separate from** Overall LM quality (S/A/W). See `extraction-confidence-v1.md`. **Implemented (local).**

## In scope (scoped — owner 2026-08-31)
5. **Session navigator v1** — file list + one active editor/source pane; header counts; honest ZIP/CSV counts. Typical sitting 5–10 files; same list must survive a large batch. Preview overlay **stays**. See `session-navigator-v1.md`. **Implemented (local).**
6. **L→R column review v1** — **after navigator.** Selected file’s default view is standard columns so operators can spot extraction/placement errors without Preview. See `ltr-column-review-v1.md`. Split-compare OUT. **Implemented (local).**

## Out of scope (until explicitly scoped)
- Authentication / multi-user accounts / public cloud / Vercel **team** host (optional private Vercel for the owner remains allowed)
- Cloud storage or shared workspaces / multi-tenant white-label
- LM Entry App / LM Feedback Module / coding UI in this repo
- Partnerships DB implementation / unify Extract+Coding
- Multi-dimension overall scores (beyond single S/A/W + rationale)
- Numeric extraction “accuracy %” / calibrated probabilities; always-on dual extract; verify-pass Gemini (deferred follow-up in `extraction-confidence-v1.md`)
- Suppressing “noisy” item critiques in storage (policy may change later in rubric doc)
- Full automated CI suite expansion
- **Sheets ledger / Jotform / Drive manifest sync** — processing log L1, Apps Script, Python Drive download, live Sheets/Drive APIs (parked 2026-08-31)

## Acceptance criteria (shipped MVP)
1. User can upload multiple files and queue while another file processes.
2. Failed files show a human-readable error with Retry and Remove.
3. ~~Re-critique keeps the editor visible and shows loading state.~~ **Deprecated 2026-09** — critique removed.
4. CSV / ZIP export only enable when at least one editable result exists.
5. Built client JS does not contain `GEMINI_API_KEY`; only the Node server reads `.env.local`.
6. Weak / unrated sections are easy to find (summary strip + default-open sections).
7. Both operators can run the app locally with documented steps.

## Acceptance criteria (scoped next — implemented)
8. ~~After critique, each model has `overallQuality.rating` ∈ {Strong, Adequate, Weak} and 2–4 rationale bullets (`lm-quality-rubric.md`).~~ **Deprecated 2026-09.**
9. ~~Full CSV includes overall quality + all item/domain assessments.~~ **Deprecated 2026-09** — full CSV no longer carries quality/critique columns.
10. **Export for coding** produces a CSV that uploads into Qualitative Outcomes Coder without header errors (`export-for-coding.md`).

## Acceptance criteria (source review v1 — implemented)
11. Image-backed extracts show source page rasters beside the editor; text-only extracts show a graceful message (`source-review-v1.md`).
12. Item select / “Show in source” navigates to `sourcePage` when present; branded Print Preview remains distinct from source.

## Acceptance criteria (extraction confidence v1 — implemented)
13. Successful extracts expose `extractionStatus` ∈ {ok, partial, abstained} and `extractionConfidence` ∈ {high, medium, low}; **`low` or `abstained` hard-stops** (no editor). Rollup rules in `extraction-confidence-v1.md`.
14. Fidelity banner for proceed-with-caution `partial`/`medium`; coding export soft-gates on those; full CSV includes fidelity fields.
15. ~~`overallQuality` remains document quality only (not extraction fidelity).~~ **Moot 2026-09** — `overallQuality` removed entirely.
16. Dense low-legibility grids (\(L\) ∧ \(N \ge 6\)) force `low` even when the model under-flags verbatim (Oxford Circle–class).

## Closed product decisions
- PDF recommended for fidelity; 2-person local host; no auth/cloud priority.
- Full-domain extract for DB; coding gets a **separate** outcomes CSV.
- Overall quality = single S/A/W + why (rationale); document in `lm-quality-rubric.md` so prompts/schema can evolve.
- Store all item assessments for now; revisit via rubric changelog if too noisy.
- LM Feedback ≠ Extractor critique.
- **Structure-aware extract (2026-07-28):** Presence-first — omit empty domains in export; critique ignores absent domains; missing Mission does not penalize overall quality. See `structure-aware-extract.md`.
- **Extraction fidelity fix (2026-07-30):** Evidence-gated fix from real-doc friction (Oxford Circle CCDA). Per-item provenance (`verbatim`/`sourceNote`) surfaces low-confidence/clipped transcriptions; per-item colour (`fillColor`/`borderColor`) captures the population axis as metadata (never re-buckets); prompt stops treating colour/Resources sub-headings as tracks ("General" is the default); raster pages are cropped + rendered larger with a legibility warning, and dense grids can be sent as per-column tiles. Additive optional fields only. See `extraction-provenance-and-color.md`.
- **Source-aware mapping (2026-07-31):** Capture source sections faithfully; synonym auto-map into standard domains without inventing/forcing; unmapped bucket + domain dropdown + short note; suggest mismatch review when ≥30% unmapped (or related thresholds); log user mapping corrections for iterative improvement. Full split Translate mode deferred. See `source-aware-mapping-v1.md`.
- **Source review v1 (2026-07-31):** Unpark side-by-side source preview for validation friction. Session-retained page rasters beside editor; soft `sourcePage` / optional `sourceColumn` jump; no item bboxes; text-only extracts degrade with a message. Bbox Tier 2 still deferred. **L→R board unparked 2026-08-31** (`ltr-column-review-v1.md`) after navigator. See `source-review-v1.md`.
- **Extraction confidence + abstention v1 (2026-08-10):** Fidelity is separate from Overall quality. Document status `ok`/`partial`/`abstained` + categorical confidence from model + deterministic rollup; fidelity banner; soft-gate coding export; no numeric % or second Gemini pass in v1. See `extraction-confidence-v1.md`.
- **Sheets / Jotform / Drive ledger (2026-08-31):** Parked. No processing-log build, no Jotform fetch, no Drive sidecar in the product. **Still IN:** Export for coding, PDF/DOCX/PPTX ingest, optional private Vercel. Local `scripts/drive-manifest-sync/` stays uncommitted (gitignored).
- **Session UX (2026-08-31):** Typical sitting 5–10 files; owner may also run a large batch — **file list + one workspace**, not a review-lite table. Branded PDF preview is a **workaround** for missing L→R; do not demote it until column review ships. Two extracts at once **OUT**. Sequence: `session-navigator-v1.md` then `ltr-column-review-v1.md`.
- **Scope narrowing to extraction-only (2026-09-15):** App's purpose is reliable extraction for downstream processing, not document-quality assessment. Document-quality critique (Overall LM quality S/A/W, per-domain/item critique, causal-chain lens) is deprecated and removed — the two-pass extract+critique Gemini pipeline becomes single-pass extract-only, halving cost/latency per document. A future separate app will own quality/causal-chain analysis. See `scope-extraction-only-2026-09.md`.

## Open product questions
- After first real-doc sessions (`friction-log-template.md`): other friction beyond the two scoped items?
- Volume/cadence: throughput vs quality-time?
- Session UX: **closed 2026-08-31** — navigator then L→R column review (`session-navigator-v1.md`, `ltr-column-review-v1.md`).
- Colleague handoff: full end-to-end alone, or review/export only?
- Tune mismatch thresholds after 3–5 docs using correction exports (`source-aware-mapping-v1.md`).
- Source review: source pane default left vs right; auto-open when mismatch banner shows (`source-review-v1.md`).
- Extraction confidence: **closed 2026-08-10** — confirm dialog for coding soft-gate; banner + CSV columns; critique always runs on partial (`extraction-confidence-v1.md`).
- Sheets / Jotform / Drive ledger: **closed 2026-08-31** — parked; coding export, Word/PPTX/PDF, and optional Vercel remain IN.

## Specs
- Scope decision (extraction-only): `scope-extraction-only-2026-09.md`
- Pipeline: `pipeline-context.md`
- Quality rubric (deprecated): `lm-quality-rubric.md`
- Structure-aware extract: `structure-aware-extract.md`
- Source-aware mapping (v1): `source-aware-mapping-v1.md`
- Source review (v1): `source-review-v1.md`
- Extraction confidence (v1): `extraction-confidence-v1.md`
- Tech (extraction confidence): `tech-extraction-confidence-v1.md`
- Coding export: `export-for-coding.md`
- Tech: `tech-overall-quality-and-coding-export.md`
- Session navigator (v1): `session-navigator-v1.md`
- L→R column review (v1): `ltr-column-review-v1.md`
- Session UX discovery (answered): `ux-session-surfaces-discovery.md`
- Roadmap: `roadmap.md`
