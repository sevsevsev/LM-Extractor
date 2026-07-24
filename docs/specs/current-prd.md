# Current PRD — Logic Model Extractor (SDP Edition)

Status: Active local MVP (2-person)  
Last updated: 2026-07-24

## Problem
Program staff receive logic models in heterogeneous formats (PDF, Word, PowerPoint). Manual transcription into a consistent structure is slow, and quality review against logic-model guidance is inconsistent.

## Primary users
- **Now:** Tool owner + one colleague (ingest, extract, critique, edit, export).
- **Later (unscoped):** Broader SDP / partner staff — only after an explicit PRD update.

## Job to be done
Upload a logic-model document → get a structured, editable model with AI quality ratings → refine → export a **flat file that the Qualitative Coding Tool can ingest**, plus optional SDP-branded PDF for humans.

## Pipeline role
This app is the **LM Extraction Tool** in the broader intake/coding flow (see `pipeline-context.md`). It is **not** the LM Entry App, LM Feedback Module, or Qualitative Coding Tool. Near-term priority is Extraction + Coding as sibling apps; Feedback is a separate program-facing utility.

## In scope (MVP)
- Multi-file upload: PDF, DOCX, PPTX (PDF recommended for layout fidelity)
- Vision-first extraction with text fallback (15 page/slide cap)
- Two-pass Gemini: extract then critique (Strong / Adequate / Weak)
- Human-in-the-loop editing + re-critique
- CSV export (granular rows)
- Single + batch branded PDF export (SDP defaults, configurable)
- Clear error, retry, and remove controls
- Server-side Gemini proxy (`GEMINI_API_KEY` never in the client bundle)
- **Local hosting** for the two users (`npm run dev` / `npm start`)

## Out of scope (until explicitly scoped)
- Authentication / multi-user accounts
- Public cloud deploy / shared hosting (including production Vercel for a team)
- Cloud storage or shared workspaces
- Full multi-tenant white-label UI
- Full automated CI suite (basic `npm test` validators are already present)

## Acceptance criteria
1. User can upload multiple files and queue while another file processes.
2. Failed files show a human-readable error with Retry and Remove.
3. Re-critique keeps the editor visible and shows loading state.
4. CSV / ZIP export only enable when at least one editable result exists.
5. Built client JS does not contain `GEMINI_API_KEY`; only the Node server reads `.env.local`.
6. Weak / unrated sections are easy to find (summary strip + default-open sections).
7. Both operators can run the app locally with documented steps.

## Closed product decisions
- PDF is the recommended high-fidelity upload format.
- Weak ratings are surfaced in an editor summary strip; Weak/Unrated sections expand by default.
- **2-person local use is the intended deployment** for now; do not prioritize auth/cloud.
- Private Vercel is optional/experimental only — not required for MVP success; Express + large vision payloads need a dedicated deploy design if pursued later.
- **Export contract:** Extractor flat-file export should mirror Qualitative Coding Tool input expectations.
- **LM Feedback Module** is a separate product (program rep drafting aid), not this app’s critique pass.
- **Priority:** Extraction + Qualitative Coding. Entry / Feedback / DB remain out. Unifying Extract + Coding is a future option only after both work as handoff siblings.

## Open product questions
- What is the Coding Tool’s exact flat-file schema (columns, domains included, multi-outcome string rules)?
- After first real-doc sessions (see `friction-log-template.md`): what friction (if any) should become the next scoped feature?
- Volume/cadence: throughput vs quality-time pain?
- Colleague handoff: full end-to-end alone, or review/export only?

## Post-MVP sequencing
See `roadmap.md` Phases 0–4. Feature work stays parked until Phase 1 log evidence; auth/cloud remain out of scope.
