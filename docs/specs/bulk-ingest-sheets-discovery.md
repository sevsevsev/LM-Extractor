# Discovery — Bulk ingest, confidence, and Sheets tracking

Status: **Exploration** (not approved build)  
Date: 2026-07-24  
Owner answers: edit-not-required-if-confident; walk-away possibly in play; Sheets marriage = design entertainment / future options.

## Problem reframed
~200 logic models tracked in a Google Sheet (program + Drive URL). Today’s Extractor is an attended, in-browser queue — fine for confidence-building, not for unattended 200-file runs or live Sheet sync.

## Product stance (recommended)

**Build confidence first → then unattended queue → then Sheet marriage.**  
Do not start with Drive/Sheets APIs. Prove extract quality and a joinable status log; automation comes after.

---

## 1. Confidence without editing every file

| Stage | What you do | Exit criteria |
|-------|-------------|---------------|
| **Calibrate** | Fully review 10–20 diverse LMs (formats, weak layouts, long PDFs) | Trust overall S/A/W + domain fill; note systematic misses in friction log |
| **Spot-check** | Run batches of ~5–15; open only Weak / errors / random 10% | Edit rate falling; coding export usable |
| **Bulk mode (later)** | Auto extract→critique→export; human only on fail/Weak/flagged | Written policy: when to skip edit |

**IN for confidence phase:** friction log, overall quality, full + coding exports (already shipping).  
**OUT:** forced edit on every file; auto-approve without a calibration sample.

Optional later product: **“Bulk / review-lite”** mode — process queue to export without opening every editor; surface a results table (filename, overall rating, error, export ready).

---

## 2. Walk-away (possibly in play)

| Option | Walk-away level | Fit |
|--------|-----------------|-----|
| **A. Attended browser queue** (today) | Stay with tab open | Confidence + small batches |
| **B. Local job worker** (Express/Node on your machine) | Leave browser; laptop stays on | Best match if walk-away matters and local-first holds |
| **C. Cloud jobs** | Fully unattended off-machine | Out until PRD + hosting re-approved |

**If B is scoped later — candidate IN:** enqueue folder or file list; disk-persisted job status; resume after crash; results as JSON/CSV on disk; UI to inspect failures.  
**OUT for B:** Google auth, multi-user queue, Vercel.

Rough capacity: sequential Gemini still dominates time (~minutes/file). Walk-away solves *attendance*, not wall-clock — 200 files may still be overnight+.

---

## 3. Marrying Sheets ↔ extract/coding (conceptual)

Your sheet stays the **coverage ledger**. Extractor/Coder emit **event logs** you join on stable keys.

### Suggested sheet columns (additive)

| Column | Meaning |
|--------|---------|
| `program_id` / Program name | Existing |
| `lm_drive_url` | Existing |
| `lm_filename` | Basename of file (join key with extractor log) |
| `ingest_status` | `not_started` \| `queued` \| `extracted` \| `needs_review` \| `exported` \| `coded` \| `error` |
| `extract_date` | Last successful extract |
| `overall_quality` | Strong / Adequate / Weak |
| `extract_export_path` | Path or name of full CSV / run id |
| `coding_status` | `not_sent` \| `in_coder` \| `verified` \| `error` |
| `coding_export_path` | Coder output file / run id |
| `notes` | Human |

### Join pattern (no live API required)

```text
Google Sheet (programs + Drive URL)
        │
        │  you download LM files into a folder (manual or Drive sync client)
        ▼
Extractor → processing_log.csv  (filename, org, program, status, overall_quality, error, timestamps)
        │
        ├─ full CSV → DB path
        └─ coding CSV → Qualitative Outcomes Coder → verified_coded_outcomes.csv
        │
        ▼
Sheet updated by: paste/LOOKUP from processing_log + coding export
   OR later: Apps Script / Sheets API write-back
```

**Stable join keys (prefer in order):**
1. `program_id` if present in both sheet and extract metadata  
2. Else `organization` + `program`  
3. Else `lm_filename` ↔ Drive file name  

### Maturity ladder for “marriage”

| Level | What it looks like | Build cost |
|-------|--------------------|------------|
| **L0 — Manual** | You tick `ingest_status` after each batch | None |
| **L1 — Log join** | Extractor writes `processing_log.csv`; VLOOKUP/XLOOKUP into sheet | Small (product) |
| **L2 — Coder log** | Coder export includes program + row counts; sheet `coding_status` updated from that file | Small (sibling app or spreadsheet) |
| **L3 — Apps Script** | Script reads log CSVs from Drive folder, updates rows | Outside Extractor repo; no app auth |
| **L4 — Live API** | Extractor/Coder write Sheets; read Drive URLs | Large; Google OAuth; explicit PRD |

**Recommendation:** Design sheet columns now (L0/L1). Implement L1 when bulk confidence is proven. Defer L4.

---

## 4. Candidate sequencing (if promoted to roadmap)

1. Calibration set (10–20) + friction log — **ops, no code**  
2. Spec **processing_log.csv** shape (align to sheet columns) — `@product` + `@architect`  
3. Optional **review-lite results table** — small UX  
4. Optional **local job worker** — only if walk-away becomes a hard requirement  
5. Sheet L1 join runbook; L3 Apps Script if volume hurts  
6. Drive URL ingest + Sheets API — only with new PRD

## Explicitly out until re-scoped
- Automatic Drive download from sheet URLs inside Extractor  
- Live Google Sheets write-back from the web app  
- Cloud unattended processing  
- Skipping calibration and jumping to 200-file auto-approve  

## Open questions (next check-in)
1. Do programs in the sheet have a stable **program_id** usable as join key?  
2. Are LM files already in one local/Drive-synced folder, or only linked by URL today?  
3. When walk-away matters, is **overnight laptop-on** acceptable, or must the machine sleep?
