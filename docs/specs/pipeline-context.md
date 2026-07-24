# Pipeline context — Logic Model intake & coding

Status: Active product context (from flowchart + owner decisions 2026-07-24)  
Source: `LM Input, Intake and Coding Flow` flowchart + owner clarification.

## System map (boxes)

| Box | Role | Relationship to this repo |
|-----|------|---------------------------|
| **LM Extraction Tool** | Read existing LM → extract → flat file | **This app** |
| **LM Entry App** | Guided Q&A → draft LM from scratch | Out of scope (separate) |
| **LM Feedback Module** | Feedback for a **program representative** drafting/refining their own LM | **Separate utility** — not this app’s critique pass |
| **Outcomes Table** (flat) | Handoff surface into coding | Target consumer of Extractor export |
| **Qualitative Coding Tool** | Split multi-outcome strings → atomic outcomes; code via codebook | **Priority sibling**; export must match its input |
| **Outcomes Codebook** | Coding vocabulary | Owned by coding workflow |
| **Coded Outcomes → Human QA** | QA + revise prompt/codebook | Downstream of coding |
| **Unpivot → Partnerships DB** | Warehouse / ERD | Downstream; not Extractor |

## Closed decisions

1. **Extractor export must mirror what the Qualitative Coding Tool expects** (flat-file contract is the integration surface).
2. **LM Feedback Module ≠ Extractor critique.** Critique here is operator QA while extracting; Feedback is a program-facing drafting aid.
3. **Near-term priority:** Extraction Tool + Qualitative Coding Tool (not Entry, not Feedback, not DB).
4. **Possible later unification** of Extraction + Coding into one app — parked until both handoff contracts and workflows are proven separately.

## IN / OUT for *this* repo (Extractor)

### IN
- Extract → edit → export a flat file shaped for the Coding Tool
- Operator-facing critique/re-critique as extraction quality aid (may or may not appear in the coding handoff file — TBD by schema)
- Branded PDF as optional human-readable artifact (not the coding contract unless coding explicitly needs it)

### OUT
- LM Entry App
- LM Feedback Module (program-rep product)
- Codebook authoring / qualitative coding UI
- Human QA of *codes*
- Unpivot / Partnerships Database / ERD
- Unifying Extract + Coding into one app (future PRD only)

## Current Extractor CSV (as-built — may need to change)

Columns today: `Organization`, `Program`, `Domain`, `Group`, `Content`, `Domain Critique`, `Domain Rating`, `Item Critique`, `Item Rating`.

Rows include Mission, Target Population, Inputs, Activities, Outputs, Short/Medium/Long-Term Outcomes, Impact — not outcomes-only.

**Open:** whether Coding wants this full LM dump, outcomes-only rows, and/or without critique columns.

## Next product gate

Lock a **Coding Tool input contract** (columns + which domains + multi-outcome string rules) before changing export. Until then, treat “CSV/PDF export shape tweaks” on the roadmap as **unparked priority** once the contract exists — still one scoped change, not a platform rewrite.
