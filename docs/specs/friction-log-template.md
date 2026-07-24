# Friction log — real-doc validation

Use one row (or one copy of the session block) per document. Goal: comparable notes so Phase 3 can pick **one** fix or park features.

**Target:** ≥5 sessions before any new feature PRD.  
**Cause tags:** `prompt` | `ui` | `setup` | `doc-quality` | `export` | `other`

---

## Session block (copy per file)

```
Date:
Operator:                 (owner | colleague)
File name:
Format:                   (PDF | DOCX | PPTX)
Approx pages/slides:
Host mode:                (npm run dev :3000 | npm start :3011)

--- Timing ---
Queue wait / convert:
Extract:
Critique:
Edit (approx minutes):
Re-critique used?:        (Y/N)
Export used:              (CSV | PDF | ZIP | none)

--- Quality (1–5) ---
Extraction fidelity:
Critique usefulness:
Overall “would use again”:

--- What happened ---
Stage that hurt most:     (setup | upload | convert | extract | critique | edit | re-critique | export)
Expected:
Got:
Error text (verbatim):
Workaround used:

--- Corrections (3–5 max) ---
#1 section/field | before → after | cause:
#2 …
#3 …

--- Notes ---
Would you stop using the tool over this? (Y/N + why)
```

---

## Running tally (optional)

| # | Date | Format | Stage hurt | Cause | Stop-using? |
|---|------|--------|------------|-------|-------------|
| 1 |      |        |            |       |             |
| 2 |      |        |            |       |             |
| 3 |      |        |            |       |             |
| 4 |      |        |            |       |             |
| 5 |      |        |            |       |             |

---

## Phase 3 triage (after ≥5 rows)

1. Cluster by **cause** and **stage**.
2. Rank by frequency × severity (stop-using = high).
3. Outcomes:
   - **Park** — no recurring pain; revisit in 30–60 days.
   - **Docs only** — setup/expectation (fold into colleague runbook).
   - **One micro-fix** — ask `@product` for IN/OUT/AC in `docs/specs/`.
