# Tech — Extraction confidence + abstention v1

Implements `extraction-confidence-v1.md`. Golden Path only; no new npm deps.  
Owner defaults locked 2026-08-10: coding confirm dialog; banner + CSV columns; critique always runs on `partial`.

## Data shapes (`types.ts`)

```ts
export type ExtractionStatus = 'ok' | 'partial' | 'abstained';
export type ExtractionConfidence = 'high' | 'medium' | 'low';

/** Document-level extraction fidelity — not LM document quality (overallQuality). */
export interface ExtractionFidelity {
  status: ExtractionStatus;
  confidence: ExtractionConfidence;
  /** 0–4 plain-language reasons; empty when ok + high with nothing to note */
  blockers: string[];
}

// LogicModel additions (all optional for backward compat with stored JSON / older fixtures):
extractionStatus?: ExtractionStatus;
extractionConfidence?: ExtractionConfidence;
extractionBlockers?: string[];

// ProcessingFile additions:
/** Session: user dismissed fidelity banner for this file. */
fidelityBannerDismissed?: boolean;
/**
 * Session: user confirmed coding export despite partial/low fidelity.
 * Reset on re-extract / Retry.
 */
codingExportFidelityAck?: boolean;
/**
 * When extract abstains: structured blockers for error panel.
 * `status` is `error`; `result` stays undefined (not editable).
 */
extractionBlockers?: string[];
```

Prefer reading/writing via helpers that treat the three LogicModel fields as one `ExtractionFidelity` object. Do not add `extractionFidelity` nested object to the Gemini JSON schema (flat fields match existing `overallQuality` style and CSV columns). Nested helper type in shared code is fine.

## Severity order

`ok` < `partial` < `abstained`

Normalize may **upgrade** status (e.g. `ok` → `partial`). Never downgrade `abstained` → `partial`/`ok`, and never downgrade `partial` → `ok`.

Confidence is **authoritative from deterministic rollup** after status reconciliation (model may omit confidence; ignore model confidence if present and conflicting unless it is *more severe* — prefer rollup-only for v1 simplicity).

## Boundaries

| Layer | Responsibility |
|-------|----------------|
| `shared/extractionFidelity.ts` (new) | Count items / non-verbatim; reconcile status; compute confidence + blockers; `shouldSoftGateCodingExport`; format error headline. Pure + unit-tested. |
| `shared/extractNormalize.ts` | After mapping/harvest, call `reconcileExtractionFidelity(model, { lowLegibility })`. |
| `shared/logicModelValidate.ts` | Optional parse/clamp of status, confidence, blockers (trim, max 4 blockers, valid enums). Extract path: fields optional until reconcile fills them. |
| `shared/provenance.ts` | After critique, restore fidelity fields from pre-critique model if the critique model drops them (same pattern as `verbatim`). |
| `shared/domainPresence.ts` / `App.tsx` CSV | Add columns: Extraction Status, Extraction Confidence, Extraction Blockers (join with ` \| `). Repeat on each granular row like overall quality. |
| `server/geminiLogicModel.ts` | Add three properties to **extract** schema (enum strings + blockers array). Critique schema: allow same fields so the model can echo them, but server always reconciles from pre-critique via provenance. Pass `lowLegibility` into normalize. |
| `constants.ts` | Extract prompt: abstain / partial criteria + required field meanings. **Do not** change critique rubric / overall quality text beyond what’s needed to say critique assesses the LM as extracted. |
| `services/geminiService.ts` | No API shape change (`POST /api/gemini/extract` still returns LogicModel JSON). Abstained is a normal 200 body with `extractionStatus: "abstained"` **or** map server throw — see flow below. |
| `App.tsx` | Branch after extract; fidelity banner state; coding export confirm; skip critique on abstain. |
| `components/LogicModelEditor.tsx` (or thin banner sibling) | Fidelity banner UI; one-line disambiguation near Overall quality. |

## Extract → critique flow

```
convert → extractLogicModel(bundle)
       → normalizeExtractedLogicModel(..., { sourceText, lowLegibility })
       → reconcileExtractionFidelity  // inside normalize or immediately after
       → if shouldHardStopExtraction (status abstained OR confidence low):
            set file status 'error'
            error = formatHardStopMessage(blockers)
            extractionBlockers = blockers
            result = undefined
            STOP (no critique)
       → else:
            critiqueLogicModel(...)
            reconcileProvenance (includes fidelity fields)
            status 'editing'
            auto-open source pane when mismatch OR confidence === 'medium'
```

### Server vs client abstain

**Preferred (v1):** Client handles abstain after successful extract parse — keeps `/api/gemini/extract` a LogicModel, no new error protocol. Server still runs reconcile so returned JSON already has final status/confidence/blockers.

Optional later: server throws 422 with `{ code: 'EXTRACTION_ABSTAINED', blockers }` — not required for v1.

## `reconcileExtractionFidelity` algorithm

Inputs: `LogicModel`, `{ lowLegibility: boolean }`.

1. **Parse model status** — if invalid/missing → `'ok'`. If `'abstained'`, keep; still compute blockers (merge model blockers + “Model abstained from extraction”); set confidence `'low'`; return.
2. **Counts** (canonical + unmapped groups; non-empty `item.text` only):
   - `N`, `V_f` (`verbatim === false`)
3. **Signals**
   - `L` = `lowLegibility`
   - `M` = `shouldSuggestMismatch(model)`
   - `U_unk` = `layoutFamily === 'unknown'`
4. **Upgrade to `partial`** (if current status is `ok`) when any:
   - Model status was already `partial` (keep)
   - `N >= 6` and `V_f / N >= 0.15`
   - `M`
   - `U_unk`
   - `L` and `V_f >= 1`
   - Model blockers non-empty and status claimed `ok` (treat as partial)
5. **Do not** auto-upgrade to `abstained` from rollup alone in v1 (abstain is model-declared). Exception: if after normalize there is **no extractable content** (no string domains, no grouped items, empty org/program optional) **and** model did not abstain — still leave as `partial` + low confidence + blocker “No logic-model content recovered”; product can tighten to abstain later.
6. **Confidence** (product table):

| Result | Conditions |
|--------|------------|
| `low` | status `abstained` **or** (`L` and `N >= 6`) **or** (status `partial` and (`L` or (`N >= 6` and `V_f/N >= 0.40`))) **or** no content |
| `medium` | not low, and any of: status `partial`; `N >= 6` and `V_f/N >= 0.15`; `M`; `U_unk` |
| `high` | else; if `N < 6`, only `high` when status `ok` and not `L` |

Hard-stop when `shouldHardStopExtraction` (`abstained` or `low`). Soft-gate coding when `partial` or `medium`.

```ts
shouldHardStopExtraction(model: LogicModel): boolean
// true when status === 'abstained' || confidence === 'low'

shouldSoftGateCodingExport(model: LogicModel): boolean
// true when status === 'partial' || confidence === 'medium'
```
## Gemini extract schema additions

```ts
extractionStatus: { type: Type.STRING, enum: ['ok', 'partial', 'abstained'] },
extractionConfidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
extractionBlockers: { type: Type.ARRAY, items: { type: Type.STRING } },
```

Not required in `required[]` — reconcile fills gaps. Prompt instructs the model to set them honestly.

Critique schema: same three optional properties (echo only); ratings/overallQuality unchanged.

## Prompt (extract) — product requirements for implementer / `@critique-prompt`

Add a short section (no rubric rewrite):

- Set `extractionStatus` / `extractionBlockers` per PRD abstain & partial criteria.
- Prefer empty domains + `verbatim: false` over invention; abstain when not an LM / illegible / unmappable columns.
- `extractionConfidence` may be omitted (server rollup wins).
- Never use critique/quality language here.

## UI contracts (no boilerplate — for `@ux` / implementer)

1. **Fidelity banner** — show when `status === 'partial'` or `confidence !== 'high'` (and not dismissed). Distinct from mismatch banner. CTA: focus needs-review / open source pane.
2. **Overall quality** — one-line helper: document quality ≠ extraction fidelity.
3. **Abstain** — existing error row + list `extractionBlockers`; Retry / Remove.
4. **Export for coding** — if any selected/ready file soft-gates and lacks `codingExportFidelityAck`, `window.confirm` (or equivalent) with copy per microcopy pass; on OK set ack and proceed. Full CSV unchanged (always on when editable results exist).
5. **Auto-open source** — when `partial` or `low`, set `sourcePaneCollapsed: false` (same as mismatch today).

## CSV

| Column | Value |
|--------|--------|
| Extraction Status | `ok` / `partial` / `abstained` (abstained rows normally absent) |
| Extraction Confidence | `high` / `medium` / `low` |
| Extraction Blockers | blockers joined with ` \| ` |

Coding export: **no** new fidelity columns required (outcomes intake unchanged); soft-gate is UI-only.

## Tests (`shared/extractionFidelity.test.ts`)

- ok + few verbatim false → high
- `V_f/N` thresholds → medium / partial upgrade / low
- `L` + non-verbatim → medium or low per table
- mismatch true → at least medium + partial upgrade from ok
- abstained sticky; confidence low
- never downgrade partial → ok when signals clear (if we only upgrade, re-running reconcile on already-partial keeps partial)
- `shouldSoftGateCodingExport` true for partial and for low

## Secrets / deps

- No client `GEMINI_API_KEY`; no new packages.
- `lowLegibility` from existing `bundleImpliesLowLegibility(bundle)` into normalize options.

## Implementation order

1. Types + `shared/extractionFidelity.ts` + tests  
2. Wire normalize + validate + provenance  
3. Gemini extract schema + prompt section  
4. App abstain branch + banner + coding confirm + CSV columns  
5. Editor one-line quality disambiguation  
6. `npm run typecheck` / `test` / `build`

## Out of tech scope (v1)

- Second Gemini verify pass / dual extract  
- Nested `extractionFidelity` in API JSON  
- Hard-block full CSV/PDF  
- Changing `overallQuality` semantics  
- Pre-model LM classifier package  
