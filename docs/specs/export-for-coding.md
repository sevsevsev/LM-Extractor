# Feature scope — Export for coding

Status: **Scoped / ready to build** (owner 2026-07-24)  
Sibling consumer: Qualitative Outcomes Coder (`outcome_text` intake)

## Problem
Full Extractor CSV uses `Content` and mixed domains. The coder rejects uploads without an outcome-text column alias and is outcomes-oriented.

## Job to be done
From editable extract results, download a CSV the Qualitative Outcomes Coder accepts without manual column renames.

## IN
- UI control: **Export for coding** (enabled when ≥1 editable result, same gate as full CSV)
- One CSV (batch = all editable files’ outcome rows)
- Domain filter: `Short-Term Outcomes`, `Medium-Term Outcomes`, `Long-Term Outcomes`, `General
  Outcomes` (added v1.4 — a source with one combined outcomes column and no time-horizon labeling;
  a coder assigns short/medium/long-term during coding, same as any other unmapped outcome text)
- Column map:

| Coding CSV | Source |
|------------|--------|
| `outcome_text` | item `Content` / `text` |
| `organization` | Organization |
| `program` | Program |
| `group` | Group |
| `row_id` | stable per row (e.g. `{fileIndex}-{domain}-{group}-{n}` or uuid) |
| `domain` | Domain label (pass-through; coder ignores unknown cols) |
| `source_filename` | uploaded file name — lets an operator's own file-naming convention (e.g. an `orgid_progid_` prefix) be used to key rows back to a source file (coder ignores unknown cols) |
| `qa_status` | `Needs Review` \| `Successfully Processed` — same document-level signal as the session list's NEEDS REVIEW grouping (`shared/qaStatus.ts`), for post-hoc QA (coder ignores unknown cols) |
| `document_type_flag` | `` \| `Possibly Not a Logic Model` \| `Unclear Document Type` — Gemini's document-type self-report (`shared/extractionFidelity.ts`), flags a source that may be a Theory of Change / impact report / other overlapping-but-different document rather than a logic model; never blocks extraction, a human decides (coder ignores unknown cols) |

### Reading this file as a coder (plain-language glossary)

The column *names* are fixed: they are the intake contract for the Qualitative Outcomes Coder,
which rejects uploads whose headers it does not recognise, and every change to this file so far has
been appended so existing positions stay stable. So several headers read oddly to a human. What
they actually mean:

| Column | What it actually is |
|---|---|
| `outcome_text` | **The text of the item — for every row, not just outcomes.** An Inputs row's text is here too. The name comes from the downstream coder's intake format and cannot be changed without breaking it. |
| `domain` | Which column of the logic model this item came from: Inputs, Activities, Outputs, Short-Term Outcomes, and so on. |
| `group` | The sub-heading it sat under inside that column (for example "Program Delivery"), or `General` when the column had no sub-headings. |
| `color_coding` | The fill colour of the box in the source document, and its border colour if different. Colour is recorded, never interpreted — it does not mean anything on its own. |
| `needs_review` | `Yes` when the AI flagged this specific item as uncertain. Blank otherwise. Currently always blank: item-level flagging was removed 2026-09-20 (friction-log session 9). |
| `qa_status` | Whether the whole document was flagged for a second look. `Needs Review` or `Successfully Processed`. |
| `document_type_flag` | Set when the source may not be a logic model at all — a Theory of Change, an impact report, a brochure. Blank normally. |
| `row_id` | An internal identifier. Ignore it unless you need to point back at one exact row. |

**`Needs Review` does not mean the extraction is wrong.** It means something about the document
made an automatic check uneasy — usually a low-resolution image, an unusual layout, or content
that did not fit a standard column. The reason is shown in the app beside the file and in the
banner above the extraction.

- Skip empty `outcome_text` rows
- Filename hint e.g. `logic-models-for-coding.csv`

## OUT (v1)
- Impact domain rows (add later via this doc if needed)
- Mission / inputs / activities / outputs
- Critique / rating / overall quality columns
- Direct API push to coder
- Excel / non-CSV
- Per-file separate downloads (unless trivial; batch one file is enough)

## Acceptance criteria
1. Exported CSV uploads into Qualitative Outcomes Coder without header errors.
2. Only the four outcome domains listed above appear (unless rubric/export docs bump version).
3. Full **Export CSV** unchanged (all domains + quality fields).
4. Empty outcome set → disabled control or clear message (no empty bogus file).

## Tweak later
Domain list and columns live in this doc; bump a one-line version note when changing filter (e.g. add Impact).

**Version:** v1.4 — 2026-09-19 — added `General Outcomes` to the domain filter (`services/codingExport.ts`'s `CODING_EXPORT_DOMAINS`/`DOMAIN_FIELDS` already shipped this; this doc's AC #2 and domain list were not updated at the time, violating this doc's own "bump a one-line version note when changing filter" rule — found via codebase audit, `docs/specs/codebase-audit-2026-09-19.md` #17). Also fixed the empty-export message (`services/codingExport.ts`), which still said "No short-, medium-, or long-term outcome rows."

**Version:** v1.5 — 2026-09-20 — added a plain-language glossary of the column names for coders. No column added, renamed, moved or removed: the header row is unchanged.

**Version:** v1.3 — 2026-09-18 — added `document_type_flag` column (appended, so existing column positions are unchanged).

**Version:** v1.2 — 2026-09-18 — added `qa_status` column (appended, so existing column positions are unchanged).

**Version:** v1.1 — 2026-09-18 — added `source_filename` column (appended, so existing column positions are unchanged).

**Version:** v1.0 — 2026-07-24
