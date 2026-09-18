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
- Domain filter (v1): `Short-Term Outcomes`, `Medium-Term Outcomes`, `Long-Term Outcomes`
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
2. Only the three outcome domains appear (unless rubric/export docs bump version).
3. Full **Export CSV** unchanged (all domains + quality fields).
4. Empty outcome set → disabled control or clear message (no empty bogus file).

## Tweak later
Domain list and columns live in this doc; bump a one-line version note when changing filter (e.g. add Impact).

**Version:** v1.1 — 2026-09-18 — added `source_filename` column (appended, so existing column positions are unchanged).

**Version:** v1.0 — 2026-07-24
