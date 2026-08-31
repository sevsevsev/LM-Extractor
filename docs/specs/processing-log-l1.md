# Processing log L1 — Sheets ledger join

Status: **Parked (2026-08-31)** — owner: Sheets/Jotform/Drive ledger not needed now; do not build  
Date: 2026-08-10 (parked 2026-08-31)  
Agents: @product (this doc), @architect (follow-on tech shapes)  
Related: `bulk-ingest-sheets-discovery.md`, `extraction-confidence-v1.md`, `export-for-coding.md`, `current-prd.md`

## Problem

Operators tracking ~100+ logic models in a Google Sheet (program + LM hyperlink) cannot see **which files ran**, **what failed or hard-stopped**, or **where exports landed** without opening every editor session. Files already live on an office shared-drive folder; the Sheet is the coverage ledger, not the file store.

## JTBD

After running a local extract batch from the shared-drive folder, **download a processing log** that joins cleanly to the Sheet on filename (and optional URL), so ingest status, fidelity, and quality can be updated without live Google APIs.

## Users

Same as MVP: tool owner + one colleague, **local** host, shared-drive filesystem path.

## Locked product decisions

| Decision | Choice |
|----------|--------|
| Host | Local (browser queue first; optional later local worker — separate scope) |
| Sheet integration | **L1** log join only |
| File source | Shared-drive **folder** (upload/queue from disk); hyperlinks = join identity |
| Google auth in Extractor | **No** |
| Cloud bulk | **Out** |

## In scope (L1)

### A. Processing log emission

- For each file in a batch/session, record one log row when processing **terminates** (success → editing/completed, hard-stop, or error).
- Collect rows in-session; provide **Download processing log** (CSV) for the current batch (and optionally “all finished files this session”).
- Include fidelity hard-stop outcomes as first-class statuses (not silent empties).
- Do not require Google connectivity.

### B. Log schema (`processing_log.csv`)

Header row exactly (stable for Sheet formulas):

```text
run_id,lm_filename,lm_drive_url,organization,program,ingest_status,extraction_status,extraction_confidence,extraction_blockers,overall_quality,error,started_at,finished_at,full_export_path,coding_export_path
```

| Column | Rules |
|--------|--------|
| `run_id` | UUID or timestamp id shared by all rows in one Download click / session batch |
| `lm_filename` | Basename of the uploaded/queued file (e.g. `Oxford Circle CCDA Logic Model submission.pdf`) — **primary join key** |
| `lm_drive_url` | Optional; blank in L1 unless operator later pastes URLs; reserved for Sheet alignment |
| `organization` / `program` | From extract when a model exists; else empty |
| `ingest_status` | See vocabulary below |
| `extraction_status` | `ok` \| `partial` \| `abstained` \| empty if failed before fidelity |
| `extraction_confidence` | `high` \| `medium` \| `low` \| empty |
| `extraction_blockers` | Pipe-joined (` \| `) plain reasons; empty if none |
| `overall_quality` | `Strong` \| `Adequate` \| `Weak` when critique ran; empty on hard-stop/error before critique |
| `error` | Human-readable failure / hard-stop headline; empty on success |
| `started_at` / `finished_at` | ISO-8601 UTC preferred |
| `full_export_path` / `coding_export_path` | Empty in browser L1 unless a known download name is recorded (e.g. suggested filename); may hold export basename for the batch |

### C. `ingest_status` vocabulary

| Value | When |
|-------|------|
| `queued` | Reserved / optional mid-flight (not required in v1 download if only terminal rows) |
| `extracted` | Extract + critique succeeded; model in editor (or completed) |
| `needs_review` | Succeeded but `extractionStatus === 'partial'` or `extractionConfidence === 'medium'` (proceed-with-caution) |
| `hard_stopped` | Fidelity hard-stop (`low` or `abstained`) — no editor success |
| `error` | Conversion / API / unexpected failure |
| `exported` | Optional later when export ack is tracked per file — out of minimal L1 unless trivial |

Terminal rows for v1 must cover at least: `extracted`, `needs_review`, `hard_stopped`, `error`.

### D. Join runbook (Sheet)

1. Ensure Sheet has `lm_filename` (or extract basename from hyperlink into a helper column).
2. Download `processing_log.csv` after a batch; copy to a tab `processing_log` (or Import).
3. Example (Google Sheets), assuming Sheet column A = `lm_filename` and log tab columns match schema with `lm_filename` in B and `ingest_status` in F:

```text
=IFERROR(XLOOKUP(A2, processing_log!B:B, processing_log!F:F), "not_started")
```

4. Similarly XLOOKUP `overall_quality`, `extraction_confidence`, `error`, `finished_at`.
5. Prefer latest row per filename if re-runs exist (QUERY or sort log by `finished_at` desc, or unique `run_id` filter).

**Join key order:** (1) `lm_filename` ↔ file basename / hyperlink basename; (2) `program_id` if both sides have it; (3) `organization`+`program`.

### E. Operator workflow (L1)

1. Open files from shared-drive folder into the Extractor queue (existing multi-file upload).
2. Let queue run; triage hard-stops / errors / needs_review.
3. Download processing log; update Sheet via XLOOKUP or paste.
4. Export full / coding CSVs as today for successful files.

## Out of scope (L1)

- Reading the Google Sheet from the Extractor
- Downloading LMs from hyperlinks via Drive API
- Writing cells back to the Sheet from the app
- Apps Script (L3), live API (L4)
- Cloud / Vercel bulk workers
- Mandatory review-lite results table (candidate follow-on; not required for log AC)
- Local overnight job worker (follow-on if walk-away required)
- Auto-approve policy engine
- New npm Google client libraries

## Acceptance criteria

1. After a multi-file session, operator can download `processing_log.csv` with the schema above.
2. Every finished file (success, hard-stop, or error) has exactly one row for that `run_id` download (or documented multi-row re-run behavior).
3. Hard-stops appear as `ingest_status=hard_stopped` with blockers and/or `error` populated; no fake “extracted” success.
4. Successful proceed-with-caution files can be distinguished (`needs_review` vs `extracted`) using fidelity fields.
5. Log joins to Sheet on `lm_filename` using the documented XLOOKUP pattern (runbook verified manually once).
6. No Google OAuth; Gemini key remains server-side only; no new Google dependencies.
7. Docs: discovery + this PRD linked from `docs/specs/README.md` and roadmap.

## Follow-ons (not L1)

- Review-lite results table in UI
- Persist log to disk from a local worker
- Per-file export path tracking when exports are written to a chosen folder
- L3 Apps Script auto-update of Sheet rows
- L4 Drive/Sheets API (new PRD)

## Sequencing

**Parked 2026-08-31 — do not start architect/implementer work.**

1. Owner approves this PRD for build (or requests schema tweaks).
2. `@architect` — client session log model, CSV serializer, UI control placement (`tech-processing-log-l1.md`).
3. Implementer — wire terminal statuses from existing queue + hard-stop path.
4. `@devops` — typecheck/test; secrets unchanged.
5. Ops — one real batch + Sheet XLOOKUP dry run; note join key mismatches in friction log.
