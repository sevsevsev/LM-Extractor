# Pipeline context — Logic Model intake & coding

Status: Active product context (updated 2026-07-24)  
Sources: intake flowchart; owner clarifications; sibling repo `Qualitative Outcomes Coder`.

## System map (boxes)

| Box | Role | Relationship to this repo |
|-----|------|---------------------------|
| **LM Extraction Tool** | Read existing LM → extract **all** domains → quality assess → flat files | **This app** |
| **LM Entry App** | Guided Q&A → draft LM from scratch | Out of scope (separate) |
| **LM Feedback Module** | Feedback for a **program representative** drafting their own LM | **Separate utility** ≠ Extractor critique |
| **Qualitative Outcomes Coder** | CSV in → atomize → codebook code → human review → coded CSV | **Priority sibling** (`../Qualitative Outcomes Coder`) |
| **Outcomes Codebook** | Coding vocabulary (Youth Development / Accelerate Philly, …) | Owned by coder |
| **Coded Outcomes → Human QA** | QA + revise prompt/codebook | Downstream of coder |
| **Unpivot → Partnerships DB** | Warehouse / ERD — **all** LM domains, not outcomes-only | Downstream consumer of full extract |

## Closed decisions

1. **Extract everything** — full LM for DB, not outcomes-only.
2. **Two exports:** full CSV (DB/archive + all quality fields) + **Export for coding** (`export-for-coding.md`).
3. **Overall quality:** single Strong/Adequate/Weak + rationale bullets; living doc `lm-quality-rubric.md` (tweakable).
4. **Item assessments:** store **all** for now; change later via rubric changelog if too noisy.
5. **LM Feedback Module** ≠ Extractor critique.
6. **Priority:** Extraction + Qualitative Outcomes Coder; unify later only after handoffs work.
7. **Coder intake:** requires `outcome_text` (aliases). Extractor `Content` must be mapped in the coding export.

## Sibling intake contract (Qualitative Outcomes Coder)

**Required:** `outcome_text` | `outcome` | `outcomes` | `objective` | `goal`  
**Optional:** `row_id`, `organization`, `program`, `partner_id`, `program_id`, `group` (+ pass-through cols)  
**Path:** `C:\Users\stucker\Documents\GitHub\Qualitative Outcomes Coder`

Handoff: use **Export for coding** (no manual rename once shipped).

## IN / OUT for *this* repo

### IN
- Full-domain extract + edit + domain/item critique + overall quality
- Full CSV + Export for coding + optional PDF

### OUT
- LM Entry · LM Feedback · codebook/coding UI · Partnerships DB · unify Extract+Coding

## Specs
- Rubric: `lm-quality-rubric.md`
- Coding export: `export-for-coding.md`
- Tech: `tech-overall-quality-and-coding-export.md`
