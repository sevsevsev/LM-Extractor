# Tech — Extraction confidence + abstention v1

Implements `extraction-confidence-v1.md`. Golden Path only; no new npm deps.  
Owner defaults locked 2026-08-10: coding confirm dialog; banner + CSV columns.

Document-quality critique was removed from the app 2026-09 (see
`docs/specs/scope-extraction-only-2026-09.md`) — the pipeline below is extract-only. Mentions of
critique/`overallQuality` elsewhere in this doc are historical context for the fidelity design,
not current behavior.

## Data shapes (`types.ts`)

```ts
export type ExtractionStatus = 'ok' | 'partial' | 'abstained';
export type ExtractionConfidence = 'high' | 'medium' | 'low';

/** Document-level extraction fidelity. */
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
| `shared/domainPresence.ts` / `App.tsx` CSV | Add columns: Extraction Status, Extraction Confidence, Extraction Blockers (join with ` \| `). Repeat on each granular row. |
| `server/geminiLogicModel.ts` | Add three properties to the extract schema (enum strings + blockers array). Pass `lowLegibility` into normalize. |
| `constants.ts` | Extract prompt: abstain / partial criteria + required field meanings. |
| `services/geminiService.ts` | No API shape change (`POST /api/gemini/extract` still returns LogicModel JSON). Abstained is a normal 200 body with `extractionStatus: "abstained"` **or** map server throw — see flow below. |
| `App.tsx` | Branch after extract; fidelity banner state; coding export confirm. |
| `components/LogicModelEditor.tsx` (or thin banner sibling) | Fidelity banner UI. |

## Extract flow

```
convert → extractLogicModel(bundle)
       → normalizeExtractedLogicModel(..., { sourceText, lowLegibility })
       → reconcileExtractionFidelity  // inside normalize or immediately after
       → if shouldHardStopExtraction (status abstained OR confidence low):
            set file status 'error'
            error = formatHardStopMessage(blockers)
            extractionBlockers = blockers
            result = undefined
            STOP
       → else:
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

## Prompt (extract) — product requirements for implementer

Add a short section:

- Set `extractionStatus` / `extractionBlockers` per PRD abstain & partial criteria.
- Prefer empty domains + `verbatim: false` over invention; abstain when not an LM / illegible / unmappable columns.
- `extractionConfidence` may be omitted (server rollup wins).

## UI contracts (no boilerplate — for `@ux` / implementer)

1. **Fidelity banner** — show when `status === 'partial'` or `confidence !== 'high'` (and not dismissed). Distinct from mismatch banner. CTA: focus needs-review / open source pane.
2. **Abstain** — existing error row + list `extractionBlockers`; Retry / Remove.
3. **Export for coding** — if any selected/ready file soft-gates and lacks `codingExportFidelityAck`, `window.confirm` (or equivalent) with copy per microcopy pass; on OK set ack and proceed. Full CSV unchanged (always on when editable results exist).
4. **Auto-open source** — when `partial` or `low`, set `sourcePaneCollapsed: false` (same as mismatch today).

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
2. Wire normalize + validate  
3. Gemini extract schema + prompt section  
4. App abstain branch + banner + coding confirm + CSV columns  
5. `npm run typecheck` / `test` / `build`

## Completeness signal (`shared/completenessCheck.ts`, added 2026-09-15, **removed 2026-09-18**)

Recall had no code-level signal at all — text fidelity has `verbatim` ratios, placement has
mismatch/causal-chain checks, resolution has the legibility floor, but a model that silently
*dropped* visible items was invisible to the rollup. `estimateCompleteness(sourceText, N)` was a
rough proxy: it counted candidate item-like lines in Track A (bullets, numbered lines, short
standalone lines) and compared against `N` (extracted item count). A gross mismatch
(`candidateSourceLines - N >= 5` and ratio `>= 1.5`) set `possiblyIncomplete`.

**PDF/PPTX-specific fix required before this was usable:** Track A for these formats is a flat
text stream from pdfjs, and line breaks follow *visual* wrapping, not logical item boundaries — a
single bullet in a narrow grid column routinely spans 2-4 lines. Naive per-line counting massively
over-counted on exactly the dense multi-column documents this signal most needs to work on
(caught via live regression against a real, previously-verified-correct document — "Foster
Grandparent Program" — before this shipped). Fixed with `reflowWrappedLines()`: a "sticky" merge
that absorbs non-bulleted, non-heading continuation lines into the preceding open bullet, the same
behavior a markdown renderer gives a wrapped list item. DOCX's Turndown-generated Markdown doesn't
have this problem (HTML list items already reflow to one line each), so the merge is a no-op there.

**Removed after a real 112-file batch audit (2026-09-18):** despite the wrapping fix, the line-count
proxy remained a systematic false positive. Manual, exhaustive item-by-item verification against 3
real flagged PDFs (cross-referenced against the extraction log) found the heuristic fired on content
that was never meant to be counted as grid items — numbered academic references, a legitimate
non-grid evaluation-framework section, and a stat-tile infographic — while true item counts matched
the extraction exactly (e.g. Healthy NewsWorks: 45/45 items, both pages still incorrectly flagged).
It was the dominant driver of a ~65% "Needs review" flag rate across that batch. Per owner decision,
disabled entirely rather than tuned further; `shared/completenessCheck.ts` and its test file were
deleted. `possiblyIncomplete` is now driven **solely** by Gemini's own per-image self-report
(`LogicModel.possiblyMissedRegions`, see `## EXTRACTION FIDELITY STATUS` in `constants.ts`) — a
signal that fired rarely and, on manual spot-check, matched real gaps rather than layout noise.

Was wired into `reconcileExtractionFidelity` (`options.sourceText`, threaded from
`normalizeExtractedLogicModel` → `server/geminiLogicModel.ts`'s `textTrack`). Deliberately excluded
from every `low`/`abstained` condition — same ceiling as `mismatch`/`unknownLayout` — since it was
unvalidated against real documents; it could only ever push `ok` → `partial` / `medium`. The
Gemini-self-report replacement keeps the same ceiling.

## Determinism: seed + temperature=0, and a schema-required gap (2026-09-19)

Trigger: recurring-improvement audit found the batch's per-file results weren't stable — re-running
the same 112 files a day apart gave a different result for at least one file (Imagine That Philly:
33 items one run, 11 the next, both from a genuinely narrative, non-grid document — see the
`documentTypeAssessment` finding below for why that document is high-variance by nature).

Neither Gemini call set a `seed`, and extraction ran at `temperature: 0.1` (the detect-logic-models
pre-pass was already at 0). Added `server/geminiSeed.ts`'s `deriveGeminiSeed()` — a SHA-256 hash of
the exact request content (prompt + text track + all images), reduced to a signed 32-bit int via
`Buffer.readInt32BE` — and wired it into both `server/geminiLogicModel.ts` and
`server/geminiLogicModelGroups.ts`, alongside dropping extraction's temperature to 0. Same document
re-run now gets the same seed, so results are reproducible as far as Gemini's own contract allows
("mostly deterministic... not a guaranteed absolute deterministic behavior" — this stabilizes
sampling noise, it does not resolve genuine prompt ambiguity in how a document's content should be
structured).

**Real bug found while verifying this**: `hash.readUInt32BE(0)` can exceed `INT32_MAX`, but Gemini's
`seed` field is a *signed* `TYPE_INT32`. Caught live, not in a unit test — a large real batch file
(After-School All-Stars, 15 images) produced a seed of 3867915212 and the API rejected the whole
request with `400 INVALID_ARGUMENT`. Fixed by switching to `readInt32BE` (reinterprets the same 4
bytes as signed, always in-range by construction); regression-guarded with a 200-input range check
in `geminiSeed.test.ts` rather than one fixed case, since the bug was about the *range* of possible
outputs, not any single input.

**Second, unrelated finding from the same investigation**: Imagine That Philly's actual PDF turned
out to be a pure program brochure (Mission/Vision/Workshops/Before-Care/After-Care/Summer-Camp,
all prose and nested bullets — no input/output/outcome grid at all), and `documentTypeAssessment`
was silently coming back `undefined` instead of `"not_logic_model"` — the exact gap already noted
against After-School All-Stars earlier in this doc's history. Root cause: the prompt calls the field
"REQUIRED — DO THIS FIRST", but it was never in the schema's `required` array, so Gemini's
structured-output mode (which only enforces schema-required fields, not prose instructions) could
freely skip it. Added `'documentTypeAssessment'` to `extractModelSchema`'s `required` list. Also
tightened the DOCUMENT TYPE CHECK prompt section itself (`constants.ts`) to state the test as
**structural, not topical** — a document can be entirely about programs/activities/goals in prose
or nested bullets and still be `"not_logic_model"`, since the earlier wording's closed example list
("ToC narrative, impact report, budget") didn't include anything resembling a program brochure, so
the model had nothing to pattern-match against and defaulted to `"logic_model"`.

Verified live end-to-end, both fixes together: Imagine That Philly now returns
`documentTypeAssessment: "not_logic_model"` with an accurate note, 0 fabricated items, and identical
structural output (status/confidence/blockers/item count) across repeated runs — only the free-text
note's exact wording still varies slightly, which is expected (categorical fields are far lower-
entropy than free text, even at temperature 0 + a fixed seed). After-School All-Stars, re-tested
after the seed-range fix, now also correctly returns `"not_logic_model"` (previously silently
`undefined`, per the open gap noted in the session that first found it).

## Determinism: two more schema/logic gaps found via codebase audit (2026-09-19)

Trigger: `docs/specs/codebase-audit-2026-09-19.md` #2 and #3, an independent audit commissioned
specifically to catch what a session anchored on its own prior work would miss — it worked: both are
the same bug class as fixes already made in this doc, in code this doc's own fixes sat right next to
without the pattern being generalized.

**#2 — `extractionStatus` not schema-required.** The prompt's EXTRACTION FIDELITY STATUS section
heads itself `(REQUIRED — NOT DOCUMENT QUALITY)`, and the abstain path depends on Gemini actually
emitting `extractionStatus: "abstained"`. It was never in `extractModelSchema`'s `required` array —
exactly the `documentTypeAssessment` gap fixed earlier this same day (see the "Determinism..."
section above), on the field sitting right next to it, missed at the time. Missing
`extractionStatus` silently defaults to `'ok'` in `reconcileExtractionFidelity`, skipping the entire
abstain-handling branch: a document Gemini tried to refuse would present as a high-confidence
success with no indication anything was wrong. Fixed by adding it to `required`, same as
`documentTypeAssessment`.

**#3 — small extracts (N<6) ignored their own non-verbatim ratio.** The confidence rollup's small-
doc branch only checked `status !== 'ok' || L` — with status staying `'ok'` (nothing else upgrades
it below N=6) and legibility uninvolved, a 5-item extract with 4 non-verbatim items still fell
through to `high` confidence with zero blockers. A `Vf === 0` override a few lines below looked like
it guarded exactly this case, but every code path that could reach it had already been assigned
`high` by the same default — dead code shaped like a safety check. Fixed by adding `Vf > 0` to the
small-doc branch's condition (`N < 6 && (status !== 'ok' || L || Vf > 0)`) and removing the now-fully-
redundant override; added a matching arm to the blocker logic so the resulting `medium` confidence
carries a stated reason (`nonVerbatimShare`) instead of an unexplained banner. Verified with two new
unit tests (N=5/Vf=4 → medium with blocker; N=5/Vf=0 → high, unchanged, confirming no over-
correction) plus the full existing suite (162/162 passing, no regressions — the old suite had no
test covering this exact combination at all).

Both verified live where relevant (#2 is pure schema/rollup logic, covered by unit tests only; #1 in
the same audit — see `tech-source-review-v1.md` — got the live Gemini re-run since it's a wire-format
change). No regression in either case.

## Out of tech scope (v1)

- Second Gemini verify pass / dual extract  
- Nested `extractionFidelity` in API JSON  
- Hard-block full CSV/PDF  
- Pre-model LM classifier package  
