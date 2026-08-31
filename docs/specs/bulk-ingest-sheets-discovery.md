# Discovery — Bulk ingest, confidence, and Sheets tracking

Status: **Parked (2026-08-31)** — owner: Sheets/Jotform/Drive ledger not needed now; L1 processing log will not be built  
Last updated: 2026-08-31  
Related: `processing-log-l1.md`, `extraction-confidence-v1.md`, `roadmap.md`

## Owner decisions (2026-08-10)

Superseded **2026-08-31:** Sheets/Jotform/Drive ledger and L1 processing log are **parked**. Do not build. Coding export, PDF/DOCX/PPTX, and optional Vercel remain in product scope.

| Topic | Decision |
|-------|----------|
| **Where LMs live** | Office **shared-drive folder** (specific path) — not URL-only. Sheet hyperlinks are identity/join keys. |
| **Sheets integration** | **L1** — Extractor emits `processing_log.csv`; join into Sheet via VLOOKUP/XLOOKUP (or paste). No Google auth in the app. |
| **Host** | **Local first** (operator PC + filesystem path to shared folder). Cloud bulk jobs deferred. |
| **Hyperlinks** | Ledger + join identity — **not** the runtime download path for L1. |
| **Parked** | L3 Apps Script write-back; L4 live Sheets/Drive API inside Extractor; cloud unattended workers. |

**Assumption for build:** shared folder is reachable as a normal filesystem path (mapped drive / UNC / Drive for Desktop sync). If files are Google-only in browser with no sync, L1 folder ingest needs a sync client or a later L4 download PRD.

Earlier answers (2026-07-24): edit-not-required-if-confident; walk-away possibly in play.

## Problem reframed

~100–200 logic models tracked in a Google Sheet (program + LM hyperlink). Files already sit in an office shared-drive folder. Today’s Extractor is an attended, in-browser queue — fine for confidence-building, weak for batch status tracking back into the Sheet.

## Product stance

**Calibrate quality → L1 processing log (local) → optional review-lite / local worker → L3/L4 only with new PRD.**  
Do not start with Drive/Sheets APIs. Prove extract quality and a joinable status log first.

---

## 1. Confidence without editing every file

| Stage | What you do | Exit criteria |
|-------|-------------|---------------|
| **Calibrate** | Fully review 10–20 diverse LMs (formats, weak layouts, long PDFs) | Trust overall S/A/W + fidelity hard-stop; note systematic misses in friction log |
| **Spot-check** | Run batches of ~5–15; open only errors / hard-stops / partial / random 10% | Edit rate falling; coding export usable |
| **Bulk mode (later)** | Auto extract→critique→export; human only on fail/hard-stop/flagged | Written policy: when to skip edit |

**IN for confidence phase:** friction log, overall quality, fidelity hard-stop, full + coding exports (shipping).  
**OUT:** forced edit on every file; auto-approve without a calibration sample.

Optional later: **review-lite** results table (filename, fidelity, overall rating, error, export ready).

---

## 2. Local vs cloud (locked 2026-08-10)

| Option | Walk-away level | Fit |
|--------|-----------------|-----|
| **A. Attended browser queue** (today + L1 log) | Stay with tab open | **Chosen first slice** — confidence + batches + processing log download |
| **B. Local job worker** (Express/Node on your machine) | Leave browser; machine stays on | Next if walk-away hurts; still local; still L1 Sheet join |
| **C. Cloud jobs** | Fully unattended off-machine | **Out** until cloud/auth PRD |

Cloud does not fix OCR or Gemini wall-clock — it only removes “keep the machine on.” Revisit cloud when: PC must be off during runs; multi-operator shared queue; folder not filesystem-accessible; org forbids workstation Gemini runs.

Rough capacity: sequential Gemini still dominates (~minutes/file). 100+ files may be overnight+.

---

## 3. Marrying Sheets ↔ extract (L1)

Your sheet stays the **coverage ledger**. Extractor emits **`processing_log.csv`** you join on stable keys. See **`processing-log-l1.md`** for full schema, AC, and XLOOKUP runbook.

### Suggested sheet columns (additive)

| Column | Meaning |
|--------|---------|
| `program_id` / Program name | Existing |
| `lm_drive_url` | Hyperlink / URL (identity; optional in log) |
| `lm_filename` | Basename of file (**primary join** to log) |
| `ingest_status` | From log / manual: `not_started` \| `queued` \| `extracted` \| `needs_review` \| `exported` \| `coded` \| `error` \| `hard_stopped` |
| `extract_date` | Last successful extract |
| `overall_quality` | Strong / Adequate / Weak |
| `extraction_status` / `extraction_confidence` | From fidelity rollup (optional Sheet columns) |
| `extract_export_path` | Path or name of full CSV / run id |
| `coding_status` | `not_sent` \| `in_coder` \| `verified` \| `error` |
| `coding_export_path` | Coder output file / run id |
| `notes` | Human |

### Join pattern (L1 — no live API)

```text
Google Sheet (programs + LM hyperlinks)
        │
        │  files already on shared-drive folder (filesystem path)
        ▼
Extractor (local) → processing_log.csv
        │
        ├─ full CSV → DB / archive
        └─ coding CSV → Qualitative Outcomes Coder
        │
        ▼
Sheet updated by: XLOOKUP/VLOOKUP or paste from processing_log
   (L3 later: Apps Script; L4 later: live API — new PRD)
```

**Stable join keys (prefer in order):**
1. `lm_filename` ↔ basename of Sheet hyperlink target (or matching display name on disk)  
2. Else `program_id` if present in both  
3. Else `organization` + `program`

### Maturity ladder

| Level | What it looks like | Status |
|-------|--------------------|--------|
| **L0 — Manual** | Tick `ingest_status` after each batch | Available now |
| **L1 — Log join** | Extractor writes `processing_log.csv`; XLOOKUP into sheet | **Parked 2026-08-31** |
| **L2 — Coder log** | Coder export updates `coding_status` | Parked |
| **L3 — Apps Script** | Script reads log CSVs, updates rows | Parked (outside repo) |
| **L4 — Live API** | Extractor reads Sheet / Drive; writes status | Parked — OAuth PRD required |

---

## 4. Sequencing

1. Calibration + fidelity hard-stop validation — **ops**  
2. **L1 processing log** — **parked 2026-08-31** (`processing-log-l1.md`)  
3. Optional review-lite results table  
4. Optional local job worker if walk-away is hard requirement  
5. L3 Apps Script if volume makes paste painful  
6. L4 Drive/Sheets API — only with new PRD  

## Explicitly out until re-scoped

- Automatic Drive download from sheet URLs inside Extractor  
- Live Google Sheets write-back from the web app  
- Cloud unattended processing  
- Skipping calibration and jumping to 100+ file auto-approve  
- Google OAuth / new Google npm clients in this repo  

## Open questions (before / during L1 build)

1. Exact filesystem path form for the shared folder (mapped drive vs UNC vs Drive for Desktop)?  
2. Does the Sheet already have a `lm_filename` column that matches files on disk, or only hyperlinks?  
3. First code slice: **log download only** vs **log + review-lite table**?  
4. When walk-away matters, is overnight machine-on acceptable?
