# Current PRD — Logic Model Extractor (SDP Edition)

Status: Active local MVP (2-person) + two scoped enhancements  
Last updated: 2026-07-24

## Problem
Program staff receive logic models in heterogeneous formats (PDF, Word, PowerPoint). Manual transcription into a consistent structure is slow, and quality review against logic-model guidance is inconsistent.

## Primary users
- **Now:** Tool owner + one colleague (ingest, extract, critique, edit, export).
- **Later (unscoped):** Broader SDP / partner staff — only after an explicit PRD update.

## Job to be done
Upload a logic-model document → extract **all** LM domains into a structured, editable model → qualitatively assess overall (and item/domain) quality → refine → export (1) a **full** flat file for database population and (2) an **outcomes** CSV for Qualitative Outcomes Coder, plus optional SDP-branded PDF.

## Pipeline role
This app is the **LM Extraction Tool** (see `pipeline-context.md`). Sibling: **Qualitative Outcomes Coder**. LM Feedback Module is a separate program-facing utility.

## In scope (MVP — shipped)
- Multi-file upload: PDF, DOCX, PPTX (PDF recommended for layout fidelity)
- Vision-first extraction with text fallback (15 page/slide cap)
- Two-pass Gemini: extract then critique (Strong / Adequate / Weak at domain/item)
- Human-in-the-loop editing + re-critique
- Full CSV export (granular rows) + branded PDF
- Clear error, retry, and remove controls
- Server-side Gemini proxy; local hosting for two users

## In scope (scoped next — owner 2026-07-24)
1. **Overall LM quality** — single Strong/Adequate/Weak + rationale bullets; see `lm-quality-rubric.md` (tweakable). Store **all** item/domain assessments in the model and full export.
2. **Export for coding** — dedicated CSV matching coder intake; see `export-for-coding.md`.

## Out of scope (until explicitly scoped)
- Authentication / multi-user accounts / public cloud / Vercel team host
- Cloud storage or shared workspaces / multi-tenant white-label
- LM Entry App / LM Feedback Module / coding UI in this repo
- Partnerships DB implementation / unify Extract+Coding
- Multi-dimension overall scores (beyond single S/A/W + rationale)
- Suppressing “noisy” item critiques in storage (policy may change later in rubric doc)
- Full automated CI suite expansion

## Acceptance criteria (shipped MVP)
1. User can upload multiple files and queue while another file processes.
2. Failed files show a human-readable error with Retry and Remove.
3. Re-critique keeps the editor visible and shows loading state.
4. CSV / ZIP export only enable when at least one editable result exists.
5. Built client JS does not contain `GEMINI_API_KEY`; only the Node server reads `.env.local`.
6. Weak / unrated sections are easy to find (summary strip + default-open sections).
7. Both operators can run the app locally with documented steps.

## Acceptance criteria (scoped next — implemented)
8. After critique, each model has `overallQuality.rating` ∈ {Strong, Adequate, Weak} and 2–4 rationale bullets (`lm-quality-rubric.md`).
9. Full CSV includes overall quality + all item/domain assessments.
10. **Export for coding** produces a CSV that uploads into Qualitative Outcomes Coder without header errors (`export-for-coding.md`).

## Closed product decisions
- PDF recommended for fidelity; 2-person local host; no auth/cloud priority.
- Full-domain extract for DB; coding gets a **separate** outcomes CSV.
- Overall quality = single S/A/W + why (rationale); document in `lm-quality-rubric.md` so prompts/schema can evolve.
- Store all item assessments for now; revisit via rubric changelog if too noisy.
- LM Feedback ≠ Extractor critique.
- **Structure-aware extract (2026-07-28):** Presence-first — omit empty domains in export; critique ignores absent domains; missing Mission does not penalize overall quality. See `structure-aware-extract.md`.

## Open product questions
- After first real-doc sessions (`friction-log-template.md`): other friction beyond the two scoped items?
- Volume/cadence: throughput vs quality-time?
- Colleague handoff: full end-to-end alone, or review/export only?
- Structure-aware v1 implementation order: prompts-only vs `present` flags on domains (`structure-aware-extract.md`).

## Specs
- Pipeline: `pipeline-context.md`
- Quality rubric: `lm-quality-rubric.md`
- Structure-aware extract: `structure-aware-extract.md`
- Coding export: `export-for-coding.md`
- Tech: `tech-overall-quality-and-coding-export.md`
- Roadmap: `roadmap.md`
