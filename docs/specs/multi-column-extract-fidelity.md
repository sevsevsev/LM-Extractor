# PRD slice — Multi-column logic model extraction fidelity

Status: **Scoped** (from Performance Garage YouthMoves calibration)  
Date: 2026-07-28  
Trigger: Real-doc compare — PDF vs `logic_models_granular_2026-07-28.csv`

## Problem
Dense **multi-column, multi-track** logic models (PPT→PDF) extract much of the **text** correctly but **mis-assign domains** across columns (Outputs ↔ Short/Medium/Long/Impact). Track rows (FLC / Summer / Concert) are lost in Outputs and outcomes. Critique then rates the **parsed** model Weak — partly an extraction artifact, not a fair read of the source.

## Root cause (hypothesis)
Vision extraction reads grid left-to-right / top-to-bottom without enforcing **column headers** and **horizontal track alignment**. Current prompt (`constants.ts` `getAiExtractionPrompt`) emphasizes grouping and input buckets but not **column fidelity** or **Impact Statement vs Impact column**.

## Goal
Improve **extract pass only** so Performance Garage–style layouts assign items to the correct domain and preserve track groups where the source uses aligned rows.

## IN scope
- Extraction prompt hardening (column headers, track rows, Impact Statement vs Mission vs Impact column)
- **Schema:** optional `impactStatement` field (critical when labeled); `mission` remains optional/non-critical
- Gold **fixture** for YouthMoves PDF + expected domain/group assignments
- Validator/tests that compare extract output shape (not critique quality)
- Re-run YouthMoves; document before/after in friction log
- CSV row for Impact Statement when present
- Optional: brief UI hint when doc looks multi-column (only if @critic/@ux recommend — not required for v1)

## OUT of scope
- New npm packages, OCR engines, or non-Gemini extract path
- Auto-repair in critique pass (critique must not “fix” column placement)
- Bulk ingest / Sheets / walk-away queue
- Re-rating critique rubric beyond “don’t assume extract is ground truth” guardrails

## Field semantics (product — 2026-07-28)

| Field | Priority | Rule |
|-------|----------|------|
| **Impact Statement** | Critical when present | Extract only if source explicitly labels it; new `impactStatement` field |
| **Mission** | Optional | Capture if present; must not replace or duplicate Impact Statement |
| **Impact column** | Grid domain | `impact` grouped items — not Impact Statement prose |
| **Long-Term column** | Grid domain | `longTermOutcomes` — not `impact` or `impactStatement` |

## Acceptance criteria
1. **YouthMoves PDF:** Summer Intensive outputs (`Attendance maintained`, `Implementation 2`, `Interaction with master teachers`) land in **Outputs**, not Short-Term.
2. **YouthMoves PDF:** Concert outputs (`Student choreography…`, `Implementation of FLC Dance…`) land in **Outputs**, not Long-Term.
3. **YouthMoves PDF:** Short/Medium items stay in correct columns per source row (FLC / Summer / Concert groups preserved in Outputs + outcome domains where source has tracks).
4. **YouthMoves PDF:** Page-1 **Impact Statement** → `impactStatement.content` (not `mission`); Long-Term column items → `longTermOutcomes`; grid Impact column → `impact`. Mission optional/empty if absent or distinct.
5. **Regression:** Resources + Activities assignments remain correct (no degradation on PG file).
6. **Gold test:** `fixtures/performance-garage-youthmoves/expected-domains.json` passes against committed extract snapshot.

## Non-goals for critique pass (this slice)
Critique may still rate Weak on **genuine** LM guidance issues. It must not be tuned to “fix” column errors — extract owns fidelity.

---

# Agent delegation plan

Execute in order. Each agent produces artifacts before the next builds on them.

## Phase 0 — @product (this doc)
**Deliverable:** IN/OUT, AC, sequencing (this file).  
**Exit:** Owner agrees extract-only slice; YouthMoves is calibration gold #1.

---

## Phase 1 — @pattern-analyst (light)
**Status:** Done → [`multi-column-extract-patterns.md`](./multi-column-extract-patterns.md)

---

## Phase 2 — @architect
**Status:** Done → [`tech-multi-column-extract.md`](./tech-multi-column-extract.md) + `fixtures/performance-garage-youthmoves/`

---

## Phase 3 — @critique-prompt
**Status:** Done → guardrails in `constants.ts` `getAiCritiquePrompt()` (evaluate as-placed, separate impactStatement/mission/impact)

## Phase 4 — Implementer
**Status:** Done → schema, prompts, placement tests, editor, CSV, PDF template  
**Remaining:** Re-upload YouthMoves PDF; if AC pass, save `fixtures/performance-garage-youthmoves/extract-snapshot.json`

---

## Phase 5 — @user-tester
**Prompt:** *Regression checklist: YouthMoves PDF + 2 other formats (simple single-column PDF if available, one DOCX). Edge cases: empty column, merged cells, 15-page cap.*

**Deliverable:** Checklist in `docs/specs/multi-column-extract-qa.md` with pass/fail rows.

---

## Phase 6 — @critic + @ux (optional, only if time)
**Prompt:** *If extract confidence is still low for grid LMs, should we show a non-blocking banner: “Multi-column layout detected — verify Outputs and Outcomes columns”?*

**Deliverable:** Go/no-go + one-sentence copy for @microcopy.  
**Default:** **No** banner in v1 unless re-test still shows frequent user surprise.

---

## Phase 7 — @devops
**Prompt:** *Verify `npm test`, `npm run typecheck`, `npm run build` after prompt changes.*

**Deliverable:** Green CI/local build note.

---

## Phase 8 — @product check-in
**Prompt:** *Compare AC vs YouthMoves re-run. Decide: park, iterate prompt, or add to gold corpus for future bulk.*

**Deliverable:** Update `roadmap.md` + friction log; close or open Phase 2 prompt iteration.

---

## Suggested chat invocations (copy/paste)

```
@pattern-analyst Multi-column LM PDF extraction — patterns for column/track fidelity. Output to docs/specs/multi-column-extract-patterns.md. MVP must stay prompt-only unless you strongly recommend otherwise.
```

```
@architect Using docs/specs/multi-column-extract-fidelity.md AC + YouthMoves failure modes, write tech-multi-column-extract.md + gold fixture plan. No schema change.
```

```
@critique-prompt Propose small critique prompt guardrails so critique does not re-bucket misplaced items. Align with extract-only fix.
```

```
Implement docs/specs/tech-multi-column-extract.md — extraction prompt + YouthMoves gold test. @integrator review if needed.
```

```
@user-tester QA checklist for multi-column extract fix per docs/specs/multi-column-extract-fidelity.md
```

---

## Sequencing summary

| Order | Agent | Output |
|-------|--------|--------|
| 0 | @product | This PRD slice ✓ |
| 1 | @pattern-analyst | Pattern pick ✓ |
| 2 | @architect | Tech spec + fixture ✓ |
| 3 | @critique-prompt | Critique guardrails (parallel) |
| 4 | Implementer / @integrator | Prompt + tests |
| 5 | @user-tester | QA checklist + run |
| 6 | @critic / @ux | Optional banner |
| 7 | @devops | Build verify |
| 8 | @product | AC sign-off |

## Risk
Prompt-only may not fully fix all grid LMs. **Success** = YouthMoves AC met; **partial** = document remaining layouts in gold corpus for pass 2. Escalate new packages only if pattern-analyst + architect agree vision-only is insufficient.
