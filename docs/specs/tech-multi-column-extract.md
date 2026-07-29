# Technical spec — Multi-column extract fidelity (YouthMoves)

**Status:** Ready for implementer (Phases 1–2 complete)  
**Date:** 2026-07-28  
**PRD:** [`multi-column-extract-fidelity.md`](./multi-column-extract-fidelity.md)  
**Patterns:** [`multi-column-extract-patterns.md`](./multi-column-extract-patterns.md) — Pattern 1 + 2, single vision pass  

**Product rule (2026-07-28):** `impactStatement` is a **critical** optional field when explicitly labeled in source. `mission` is optional/non-critical. When both exist, capture both separately — never lose Impact Statement.

---

## 1. Schema change

### Field semantics

| Concept | Field | Required | Source |
|---------|-------|----------|--------|
| Impact Statement (overview prose) | `impactStatement` | **no** | Explicit label only: "Impact Statement", "Intended Impact", equivalent page-1 block |
| Mission / purpose | `mission` | yes (`content` may be `""`) | "Mission", "Purpose", "Program Overview" when distinct |
| Target population | `targetPopulation` | yes | Unchanged |
| Grid Impact column | `impact` | yes | Rightmost column header "Impact" — status/condition items |
| Long-Term Outcomes column | `longTermOutcomes` | yes | Column header only — **not** Impact Statement prose |

### `types.ts`

```typescript
export interface LogicModel {
  organization: string;
  program: string;
  /** Only when source explicitly labels Impact Statement (or equivalent). */
  impactStatement?: LogicModelField<string>;
  mission: LogicModelField<string>;
  targetPopulation: LogicModelField<string>;
  inputs: LogicModelField<LogicModelGroup[]>;
  activities: LogicModelField<LogicModelGroup[]>;
  outputs: LogicModelField<LogicModelGroup[]>;
  shortTermOutcomes: LogicModelField<LogicModelGroup[]>;
  mediumTermOutcomes: LogicModelField<LogicModelGroup[]>;
  longTermOutcomes: LogicModelField<LogicModelGroup[]>;
  impact: LogicModelField<LogicModelGroup[]>;
  overallQuality?: OverallQuality;
}
```

- `impactStatement` **not** in `REQUIRED_LOGIC_MODEL_KEYS` (backward compat).
- Omit key when source has no labeled Impact Statement.

### `server/geminiLogicModel.ts`

- `extractModelSchema`: add optional `impactStatement: baseFieldSchema(Type.STRING)` (not in `required`).
- `critiqueModelSchema`: add optional `impactStatement: critiquedFieldSchema(Type.STRING)` (not in `required`).

### `shared/logicModelValidate.ts`

- No required-key change; optional field passes through.
- Add test: model with/without `impactStatement` validates.

---

## 2. Extraction prompt (`constants.ts`)

### Replace Context & Overview block

- **`impactStatement`**: CRITICAL when labeled. Verbatim from explicit heading only. Omit or empty if not labeled — do not infer from grid or mission.
- **`mission`**: Optional. Distinct mission/purpose text when present. May be `""`.
- **When both exist**: populate both; never copy Impact Statement into `mission`.
- **`targetPopulation`**: unchanged.

### Add COLUMN FIDELITY block

1. Locate column headers left→right before extracting body.
2. Assign bullets to domain of header **directly above** (vertical lane).
3. Forbidden cross-column merge.
4. Impact Statement prose ≠ Impact column items.
5. PG YouthMoves: Long-Term column → `longTermOutcomes`; grid Impact column → `impact`.

### LAYOUT-FIRST (2026-07-28 iteration)

Extract prompt now requires **Phase A layout map** before Phase B fill:
- Inventory column headers L→R and track bands T→B first
- Hard anti-patterns from YouthMoves second-try CSV (Summer/Concert outputs mis-bucketed; Long-Term → invented Impact)
- If no column header named "Impact", `impact.content` must be `[]`; all Long-Term Outcomes column items → `longTermOutcomes`
- Extract temperature 0.1; PDF render scale 2.5 / JPEG 0.92 for denser grids

### Add HORIZONTAL TRACK BANDS block

1. Detect row/track labels (FLC, Summer Intensive, Concert).
2. Same horizontal row → same `Group.name` across Outputs and outcome domains.
3. Use `"General"` only when no track structure.

### Replace Impact domain bullet

- `impact` = grid column "Impact" only (status/condition). Empty array if no column.
- `longTermOutcomes` = Long-Term Outcomes column only.

### OUTPUT FORMAT example

Include optional `impactStatement` key when present; omit key when absent.

---

## 3. Gold fixture — `fixtures/performance-garage-youthmoves/`

See committed `expected-domains.json`. Source PDF: owner-held YouthMoves file.

**Must-fix placements (from 2026-07-28 CSV failure):**

| Content substring | Domain | Group |
|-------------------|--------|-------|
| Attendance maintained | outputs | Summer Intensive |
| Implementation 2 | outputs | Summer Intensive |
| Interaction with master teachers | outputs | Summer Intensive |
| Student choreography | outputs | Concert |
| Implementation of FLC Dance | outputs | Concert |

**Impact Statement:** required for YouthMoves; must live in `impactStatement.content`, not `mission` or outcome domains.

**Track groups required in:** outputs, shortTermOutcomes, mediumTermOutcomes, longTermOutcomes — `YouthMoves at FLC`, `Summer Intensive`, `Concert`.

---

## 4. Test strategy

### `shared/extractPlacement.ts` (new)

- `findItems(model, domain)` — string or grouped domains
- `assertPlacement(model, expectation)` — `contentContains`, `mustNotBeIn`
- `assertFixture(model, fixture)` — load `expected-domains.json`

### `shared/extractPlacement.test.ts`

- Helper smoke test with synthetic misplaced model
- Fixture JSON structure valid
- When `extract-snapshot.json` committed after live re-run, full `assertFixture` passes

**CI:** No live Gemini in default `npm test`. Optional `test:extract-live` for manual refresh.

---

## 5. CSV export (`App.tsx`)

When `impactStatement.content` non-empty:

```typescript
pushStringField('Impact Statement', m.impactStatement);
```

Omit row when empty. Domain column = `"Impact Statement"` (distinct from grouped Impact domain).

---

## 6. Critique pass (note — @critique-prompt owns wording)

- Evaluate items **as placed**; never move between domains.
- Critique `impactStatement`, `mission`, and `impact` separately.
- Flag misplaced content with Weak rating; do not re-bucket.

---

## 7. Downstream / follow-up

| File | Change |
|------|--------|
| `LogicModelEditor.tsx` | Add Impact Statement section (Phase 4) |
| `LogicModelPdfTemplate.tsx` | **Bug:** currently renders `impact.content` as "Impact Statement" — fix to `impactStatement.content` |

---

## 8. Risks

| Risk | Escalation |
|------|------------|
| Prompt-only insufficient for YouthMoves AC | Pattern 3 two-pass (defer) |
| `impactStatement` vs `mission` ambiguity | Fixture `mustNotDuplicate` |
| Schema without prompt fix | Ship together — schema alone insufficient |

---

## Implementation sequence

1. `types.ts` + Gemini schemas  
2. `logicModelValidate` tests  
3. `constants.ts` extract prompt  
4. `shared/extractPlacement.ts` + fixture + tests  
5. Manual YouthMoves re-run → `extract-snapshot.json`  
6. `App.tsx` CSV Impact Statement row  
7. `@critique-prompt` guardrails  
8. Editor + PDF template (same or follow-up PR)
