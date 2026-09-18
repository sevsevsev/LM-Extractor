# Feature scope — Extraction log export

Status: **Implemented** (2026-09-18)

## Problem

After a large batch run (e.g. 107 files), there was no way to see *which* files had extraction
issues and *why* without opening each one individually in the app. Improving the extraction
prompt/pipeline needs real examples, and finding the right ones to hand over for review was pure
manual clicking.

## Job to be done

From a processed batch, download a per-document QA log — one row per file — that makes it easy to
sort/filter for the "notable" (flagged) files, then go pull the corresponding source PDFs to hand
over for root-causing.

## IN

- UI control: **Export extraction log**, styled as a secondary/muted button (not partner-facing,
  distinct from Export CSV / Export for coding) — enabled once ≥1 file has reached a terminal
  state (`editing`/`completed`/`error`).
- One CSV, one row per processed file (not per content item, unlike the granular/coding exports).
- Column map (`services/extractionLogExport.ts`):

| Column | Source |
|--------|--------|
| `source_filename` | `displayFileName(file)` — includes the split part label when relevant |
| `pipeline_status` | `ProcessingFile.status` (`editing`/`completed`/`error`) |
| `organization` / `program` | From the extracted model; blank for a hard-stopped file |
| `qa_status` | `qaStatusLabel()` — `Needs Review` / `Successfully Processed`, or `Error` for a hard stop |
| `extraction_status` / `extraction_confidence` | `LogicModel.extractionStatus` / `.extractionConfidence` |
| `extraction_blockers` | Joined with ` \| ` — the model's own blockers, or the file's for a hard stop |
| `document_type_flag` | `documentTypeFlagLabel()` — Gemini's "possibly not a logic model" self-report |
| `layout_family` | `LogicModel.layoutFamily` |
| `total_items` / `non_verbatim_items` | `countExtractionItems()` |
| `unmapped_items` | `countMappedItems()` |
| `mapping_corrections_count` | `LogicModel.mappingCorrections.length` |
| `possibly_missed_regions_count` | `LogicModel.possiblyMissedRegions.length` |
| `split_part_label` | `ProcessingFile.splitPartLabel`, when this file came from a multi-logic-model split |
| `error_message` | `ProcessingFile.error`, for a hard-stopped file |
| `source_format` | Derived from the filename extension (pdf/docx/pptx) — a local check, not `services/fileService.ts`'s version, to avoid pulling that module's heavy lazy-loaded deps (pdfjs/mammoth/jszip) into the main bundle |
| `warnings` | `ProcessingFile.warnings`, joined with ` \| ` — whether this file fell back to text-only extraction (vision/canvas rendering failed) or hit a low-resolution flag; the single biggest predictor of poor extraction quality, and otherwise invisible in this log |
| `pages_processed` | `ProcessingFile.sourcePreviewImages.length` — session-only, so blank (not `0`) after a resume when unavailable |
| `mapping_corrections_json` | Full `LogicModel.mappingCorrections` as JSON — the count column alone doesn't say *what* was misclassified or *what* the corrected domain/header was |
| `possibly_missed_regions_json` | Full `LogicModel.possiblyMissedRegions` as JSON — page/span/note, not just a count |

- Includes hard-stopped (`error`) files — these are exactly the ones most worth reviewing, and
  are excluded from every other export today.
- Filename hint e.g. `extraction-log_2026-09-18.csv`.

## OUT (v1)

- No source document capture — the log tells you *which* files to go re-upload (by filename) for
  a human to hand over for review; it doesn't bundle or store the PDFs itself. See the
  local-vs-hosted capture discussion this feature grew out of — full automatic capture (documents
  + results persisted server-side) is a materially bigger project (needs a real backend store, and
  a deliberate data-governance decision for partner program data) and isn't in scope here.
- No aggregation/charting in-app — the CSV is meant to be sorted/filtered in a spreadsheet, or
  handed directly into a Claude Code session for pattern-finding across a batch.
- No new export column elsewhere — this is a wholly separate CSV, not a change to the granular or
  coding export shapes. Note the **granular** CSV export already carries complementary per-item
  detail (`source_header`, `mapped_by`, `mapping_confidence`, `mapping_note`) for every extracted
  item including unmapped ones — worth exporting alongside this log for the flagged files, since
  it's free/already-shipped and gives item-level, not just document-level, signal.

## Acceptance criteria

1. Exported CSV has exactly one row per file that reached `editing`/`completed`/`error`.
2. A hard-stopped file's blockers and error message are still visible (the granular/coding
   exports both drop these files entirely).
3. `document_type_flag`, `qa_status`, and `extraction_blockers` are enough on their own to sort a
   large batch down to "the ones worth investigating" without opening the app.
4. Full **Export CSV** and **Export for coding** are unchanged.
5. `warnings`, `source_format`, and the full `mapping_corrections_json`/`possibly_missed_regions_json`
   are present for a file that has them — not just counts — so the log alone can distinguish "vision
   fell back to text-only" from "a low-res flag" from "no signal at all", and can show exactly what
   a human corrected without needing the source document for that specific issue.

**Version:** v1.1 — 2026-09-18 — added `source_format`, `warnings`, `pages_processed`,
`mapping_corrections_json`, `possibly_missed_regions_json` (appended, so existing column
positions are unchanged) after a gap review: the original per-document summary/counts weren't
enough to distinguish a vision-fallback failure from a mapping failure, or to see what a
correction actually changed, without opening the app.

**Version:** v1.0 — 2026-09-18
