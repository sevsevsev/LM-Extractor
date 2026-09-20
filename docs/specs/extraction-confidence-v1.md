# Extraction confidence + abstention (v1)

> **2026-09 note:** document-quality critique (`overallQuality`, per-domain/item critique) referenced
> throughout this doc was removed from the app — see `scope-extraction-only-2026-09.md`. The
> fidelity/abstention design below is unaffected and still active; "critique" mentions are historical
> context for why fidelity was deliberately kept separate from it.

Status: **Implemented (local)** (owner 2026-08-10) — tune thresholds from next 3–5 real-doc sessions  
Agents: @product (this doc), @architect (schema / rollup), @ux (banners / gates)  
Related: `extraction-provenance-and-color.md`, `source-aware-mapping-v1.md`, `source-review-v1.md`, `structure-aware-extract.md`, `tech-extraction-confidence-v1.md`

## Problem

Operators cannot tell **whether the extract is trustworthy** vs whether the **logic model document itself is weak**. Today:

- `overallQuality` (Strong / Adequate / Weak) answers *document* quality after critique.
- Item `verbatim` / `sourceNote`, mapping mismatch, and legibility warnings answer *pieces* of fidelity — but nothing rolls them up or lets the model **stop** when the job is impossible.

Without an explicit abstain / partial path, Gemini still fills JSON. Fluent invention (proper nouns, clipped cells, false columns) remains the worst failure mode — already seen on Oxford Circle–class rasters.

## JTBD

After extract (and before leaning on critique or coding export), **know how faithful the capture was**, **see why**, and **either fix via source review or stop** when the pipeline should not pretend it succeeded.

## Users

Same as MVP: tool owner + one colleague, local session, quality-time over throughput.

## Product stance

1. **Fidelity ≠ LM quality** — never fold extraction confidence into `overallQuality` S/A/W.
2. **Empty / abstain beats invention** — inventing plausible content is worse than a partial or failed extract.
3. **Prefer derived signals over model self-scores** — categorical confidence from deterministic rollups + explicit model status; no fake 0–100 accuracy.
4. **Human remains the gate** — confidence surfaces review debt; it does not auto-rewrite the LM.
5. **Reuse what we have** — `verbatim`, `sourceNote`, mismatch score, low-legibility warnings, source review pane; add document-level status + rollup + light export gating.

## In scope (v1)

### A. Document-level extraction status (model + normalize)

Additive fields on the extracted model (names illustrative for architect — product meaning fixed):

| Field | Meaning |
|-------|---------|
| `extractionStatus` | `ok` \| `partial` \| `abstained` |
| `extractionConfidence` | `high` \| `medium` \| `low` |
| `extractionBlockers` | 0–4 short strings explaining status (why partial/abstained, or why low) |

**Model may set status** when it can honestly refuse or partially complete (prompt + schema).  
**Server/normalize may upgrade severity** (never downgrade `abstained` → `ok`) from deterministic evidence (see rollup).

**Abstain when (any):**
- Document does not appear to be a logic model (or has no extractable LM layout).
- Grid / core structure is largely illegible and Track A cannot salvage it.
- Column/header inventory cannot be established with any confidence.

**Partial when (any, and not abstain):**
- Overview (e.g. Impact Statement / Mission) recoverable but multi-column grid weak or incomplete.
- Material share of items flagged non-verbatim (see thresholds).
- Layout family `unknown` (or hard non-grid) **and** elevated unmapped/mismatch signal.
- Model explicitly reports incomplete coverage of visible content.

**Ok when:** none of the above; core visible domains populated with mostly verbatim items.

On **abstained** or **`extractionConfidence === 'low'`**: hard-stop — human-readable blockers, Retry / Remove; do **not** present a fake full LM as “editing ready.” Critique and editor are skipped. (Architect: map to `error` status — product requires no silent empty/junk success.)

On **partial** with **`medium`** (or `ok`/`high`): continue to editor + critique; fidelity banner when partial/medium; source review encouraged.

### B. Deterministic confidence rollup (no second Gemini call)

Compute / reconcile `extractionConfidence` after extract from existing signals. v1 default rules (tune from friction log after 3–5 docs):

Let:
- \(N\) = count of items with non-empty text  
- \(V_f\) = count of those with `verbatim === false`  
- \(L\) = low-legibility (or equivalent) warning present on the file/bundle  
- \(M\) = mismatch banner would fire under `source-aware-mapping-v1.md` thresholds  
- \(U_{unk}\) = `layoutFamily === 'unknown'`

| Confidence | When (defaults) |
|------------|-----------------|
| **low** (hard-stop) | `abstained` **or** \(L\) and \(N \ge 6\) (Oxford-class dense low-DPI grids) **or** (`partial` and (\(L\) or \(V_f / N \ge 0.40\) with \(N \ge 6\))) **or** no recoverable content |
| **medium** (proceed + banner) | Not low, and any of: `partial`; \(V_f / N \ge 0.15\) with \(N \ge 6\); \(M\); \(U_{unk}\) |
| **high** | `ok` and none of the medium/low triggers; if \(N < 6\), allow **high** only when status is `ok` and not \(L\) |

**Hard-stop policy (owner 2026-08-10):** Do not run critique or open the editor when confidence is `low` or status is `abstained`. Prefer stopping over asking the operator to rewrite a fluent-but-wrong extract (Oxford Circle failure mode).

Blockers should name the firing conditions in plain language (e.g. “Low-resolution source — many items need verification”).

### C. UX chrome (minimal)

- **Fidelity banner** (distinct from mismatch banner and from Overall quality):
  - Shows status + confidence + up to ~3 blockers.
  - `partial` / `low`: primary CTA toward source review / “Needs review” filter (reuse verify badge patterns).
  - Dismissible per file for the session; dismissal does not change stored status/confidence.
- **Needs review** = items with `verbatim: false` (and optionally unmapped) — existing patterns; banner should deep-link or state the count.
- **Abstained**: error-style panel with blockers; no editor chrome pretending success.
- Do **not** relabel Overall quality; optional one-line helper near overall quality: “Overall quality rates the logic model document, not extraction fidelity.”

### D. Export gating (soft, coding-path first)

| Export | Behavior (v1 default) |
|--------|------------------------|
| **Export for coding** | Soft-block when `extractionStatus === 'partial'` or `extractionConfidence === 'medium'` (confirm dialog). `low` never reaches export — hard-stopped after extract. |
| **Full granular CSV** | Always available when a model exists (operators need archive/debug); include new fidelity columns. |
| **Branded PDF** | Same as full CSV — available; no hard block in v1. |
| **Hard-stopped (`low` / `abstained`)** | No model exports (nothing successful to export). |

### E. Prompt / pipeline behavior

- Extract prompt: explicit abstain / partial criteria; prefer empty domains and `verbatim: false` over invention; set status + blockers when refusing or incomplete.
- Critique: unchanged rubric; **skip** on abstained; on partial, critique only what was extracted (presence-first already).
- Temperature / anti-fabrication rules remain; this feature does not replace provenance — it **aggregates and escalates** them.
- Full CSV (+ optional session fields) includes `extractionStatus`, `extractionConfidence`, and blockers (serialized).

### F. Pre-model gate (lightweight)

Reuse conversion warnings already produced:

- If bundle is empty / no usable tracks → fail before Gemini (existing or tighten messaging).
- Low-legibility warning alone does **not** abstain pre-model; it biases rollup + prompt flagging (already true). No new “is LM?” classifier package in v1 — model abstain covers non-LM docs.

## Out of scope (v1)

- Numeric accuracy / confidence percentages or calibrated probabilities
- Folding fidelity into `overallQuality` or multi-dimension quality scores
- Always-on second extract or disagreement ensemble
- Dedicated “verify each item against image” Gemini pass (candidate v1.1 if friction remains)
- Hard-blocking full CSV / PDF on partial
- Auto-repair / rewrite of low-fidelity items
- Cloud analytics on abstain rates
- New npm dependencies
- Changing LM quality rubric ownership (`@lm-quality`) except the one-line UI disambiguation

## Acceptance criteria

1. After extract, every successful (`ok` / `partial` with `high`/`medium`) model has `extractionStatus`, `extractionConfidence`, and blockers consistent with the rollup rules (model + normalize reconciled).
2. Model (or normalize) can produce `abstained` or `low` confidence; user sees failure-style UI with blockers and Retry / Remove; critique and exports do not run as a successful edit session.
3. `partial`/`medium` shows a fidelity banner distinct from mismatch and from Overall quality; banner lists reasons and points to verification / source review.
4. `overallQuality` remains document quality only; UI copy does not equate it with extraction fidelity.
5. Export for coding soft-gates on `partial`/`medium` (confirm); full CSV still exportable and includes fidelity fields. `low` is hard-stopped before edit.
6. No new npm packages; Gemini key remains server-side only.
7. Rollup thresholds are documented here and tunable without a product re-scope (friction-log note after 3–5 docs).
8. Dense low-legibility grids (\(L\) and \(N \ge 6\)) force `low` even if the model under-flags `verbatim` (Oxford Circle–class).

## Open product questions (closed 2026-08-10)

Owner confirmed **defaults fine**, then tightened hard-stop (2026-08-10):

1. **Coding export gate:** confirm dialog (for proceed-with-caution only).
2. **Colleague handoff:** in-app banner + CSV fidelity columns.
3. **Critique:** runs on `partial`/`medium` only — **`low` / `abstained` hard-stop** (no critique/editor).

## Follow-ups (not v1)

- Optional verify pass (supported vs unsupported items) on `medium`/`low` only.
- Dual-extract disagreement highlighting.
- Pre-model “is this a logic model?” cheap classifier if abstain noise is high.
- Harder export policies once coding pipeline consumers complain about bad intakes.

## Sequencing

1. `@architect` — additive types, schema, normalize rollup, abstain → terminal UX contract, CSV columns (`tech-extraction-confidence-v1.md`).
2. `@ux` / implementer — fidelity banner, abstain panel, coding soft-gate, one-line quality disambiguation.
3. `@critique-prompt` (narrow) — extract-prompt abstain/partial language only; do not change `lm-quality-rubric.md`.
4. `@devops` — typecheck/build/test; no secrets regression.
5. Phase 1 — log fidelity banner usefulness on next 3–5 real docs; tune thresholds.

## Closed decisions (this scope)

- Fidelity is a **separate** product surface from Overall quality.
- v1 = status + categorical confidence + blockers + rollup + banner + soft coding gate — **not** a second model pass.
- Soft-gate coding export on `partial`/`medium`; hard-stop on `low`/`abstained`; do not hard-block full CSV/PDF for successful edits.
- Abstain / low is a first-class unsuccessful outcome, not an empty Strong/Weak LM.
- Dense low-legibility + \(N \ge 6\) → `low` (owner 2026-08-10, Oxford Circle).
