# Causal-chain critique (v1)

Status: **Proposed (draft)** — owner reviewing 2026-09-14; not yet scoped/locked
Owners: `@product` (this doc, scope), `@critique-prompt` (rubric language + worked examples), `@architect` (schema + rollup guardrail), `@lm-quality` (interaction with overall rollup — sign-off required), `@ux` (optional item-level chrome)
Related: `lm-quality-rubric.md`, `structure-aware-extract.md`, `extraction-confidence-v1.md` (precedent for deterministic rollup over model self-score), `current-prd.md`

## Problem

The critique prompt already assigns each outcome tier a required change-type (Short-Term = knowledge/attitude/awareness; Medium-Term = skills/behavior; Long-Term = status/condition) and asks the model to flag mis-binned items. But three specific causal-chain failure modes are only caught incidentally, inside one holistic per-domain critique pass, with no structured signal:

1. **Mechanism leak** — an "outcome" item that actually restates what the *program does* (an activity/mechanism) rather than a change *in the participant or system*.
2. **Context leak** — an "input" or "target population" item that's actually describing a precondition for success rather than a resource.
3. **Chain incoherence** — outcome tiers that don't read as plausible consequences of each other, even when each item individually looks fine in isolation.

`overallQuality.rating` currently comes entirely from the model self-aggregating its own per-domain findings in one persona-driven pass ("ruthlessly critique... then assign overall"). Nothing structured backs that aggregation the way `extractionFidelity` backs extraction trustworthiness — the model both grades the work and averages its own grades, with no code-level check.

## Framework grounding (and what we're explicitly not adopting)

Realist Evaluation's Context–Mechanism–Outcome (CMO) distinction is a useful **analytical lens** for the three failure modes above: it gives a principled way to ask "is this actually an Outcome, or is it a Mechanism/Context that leaked into the outcome column?" — sharper than "sounds like an output."

Two adjacent frameworks were considered and **rejected for v1**:

- **Behaviour Change Technique Ontology (BCTO)** — 259 techniques / 20 groups, designed to code intervention protocols and published trials at a granular level. Our source documents are mostly bare bullet phrases ("deliver weekly workshops," "provide rental subsidy") without the elaboration BCTO needs to classify honestly. Forcing every Activities item into one of 20 BCT buckets would produce confident-sounding but unsupported tags — the same failure mode the extraction prompt already guards against elsewhere ("never force a track that isn't real").
- **CFIR 2.0** — needs information about organizational culture, readiness, and policy environment that logic-model documents essentially never state. Same invention risk.

Also rejected: a **vector database / cross-document graph**. No cross-document use case has been identified — this app's surface is single-document extract → critique → export. That's a different product with its own dataset and validation needs, not a schema addition here.

**v1 imports the CMO *lens* only, as an internal critique-time classification — no new taxonomy dataset, no vector infra, no BCT/CFIR tags.**

## Product stance

1. **Lens, not new required extraction fields.** CMO informs how critique reasons about existing domains; it does not add a Context/Mechanism/Outcome field to every item at extract time.
2. **Presence-first still governs.** Classify only what the item text actually supports. Default to `unclear` over forcing a leak classification when the evidence is thin — mirrors "when unsure, prefer General" in the extraction prompt.
3. **Structured signal feeds a deterministic guardrail, not a full deterministic score.** Same philosophy as `extractionFidelity`: code can harden the model's own rating (downgrade) when structured evidence contradicts it, but never soften it. The model still writes the rating and rationale; code adds a ceiling.
4. **Causal-chain quality is part of `overallQuality`, not a sibling status.** Unlike extraction fidelity (deliberately kept separate from document quality), causal logic *is* logic-model document quality — this feature sharpens the existing single S/A/W rating, it does not add a second visible rating axis. (Matches PRD: "Multi-dimension overall scores... out of scope.")
5. **No added Gemini calls.** This is a schema + prompt + rollup change inside the existing critique pass, not a new verification pass.

## In scope (v1)

### A. Per-item causal-role classification (critique-only field)

New optional field on `LogicModelItem`, set only during critique (like `critique`/`rating` — never at extract time):

```ts
causalRole?: 'outcome' | 'mechanism_leak' | 'context_leak' | 'unclear';
```

- Scoped to items inside `shortTermOutcomes` / `mediumTermOutcomes` / `longTermOutcomes` in v1. (Extending to `inputs`/`targetPopulation` for context-leak detection is a candidate follow-up — see Open questions.)
- Default is `outcome` (or omit) when nothing in the item text suggests leakage — this is not a mandatory tag on every item, it's a flag for the exception case.
- `mechanism_leak` / `context_leak` require a one-line justification folded into that item's existing `critique` text (e.g., "Reads as a program action, not a participant change — verify this belongs in Short-Term Outcomes"). No separate justification field; reuse what exists.

### B. Chain-coherence assessment (model-level, present horizons only)

```ts
causalChainAssessment?: {
  coherence: 'holds' | 'weak' | 'broken';
  evidence: string[]; // 1–3 short bullets, must cite specific items/horizons
};
```

- Computed only across **present** outcome horizons (respects `structure-aware-extract.md` — never penalize an absent Medium-Term column).
- Omit the field entirely when fewer than 2 present horizons exist (nothing to compare) — omit rather than force a placeholder, consistent with the export convention of omitting empty domains instead of "Not present" rows.

### C. Deterministic rollup guardrail (extends the `extractionFidelity` pattern to quality)

New pure function, e.g. `shared/causalChain.ts` → `applyCausalChainGuardrail(model)`, run server-side after the critique response is parsed, before `sanitizeAbsentDomainCritiques`:

- Count `mechanism_leak` + `context_leak` items among present outcome-domain items.
- If that count/ratio crosses a threshold (illustrative default: ≥2 leaks, or ≥25% of present outcome items — **tune from real-doc friction log**, same caveat as the extraction-confidence thresholds) **or** `causalChainAssessment.coherence === 'broken'`:
  - Enforce a ceiling: `overallQuality.rating` cannot be `Strong`. If the model returned `Strong`, downgrade to `Adequate`.
  - When a downgrade happens, append one rationale bullet citing the specific flagged item(s)/horizon — keeps `overallQuality.rationale` evidence-based per the existing rubric rule.
- Code only **hardens** (downgrades) the model's self-rating — never upgrades a model-assigned `Weak`/`Adequate` to `Strong`. Same asymmetry as extraction fidelity's "server may upgrade severity, never downgrade."

### D. Prompt changes (`constants.ts` → `getAiCritiquePrompt()`)

- Add a short CMO-lens section teaching the three failure modes with 2–3 worked before/after examples (per `@critique-prompt`'s own operating rule: recognition over essay, short critique beats paragraphs).
- Explicitly allow/encourage `unclear` as a valid answer — do not let the model feel obligated to classify every item.
- No change to the extraction prompt — this is critique-only, consistent with keeping the two passes separate.

### E. Export

- Full CSV: add `causalRole` and `causalChainAssessment` as informational columns (same treatment as `extractionStatus`/`extractionConfidence` fields — additive, non-blocking).
- Coding export: omit — same policy as other quality/critique fields (`lm-quality-rubric.md`: "Coding CSV: omit overall and item critiques").

### F. UX (minimal, v1)

- No new dedicated UI surface required — `mechanism_leak`/`context_leak` items surface through their existing item critique text in the editor, same as any other critique.
- Open question below on whether a lightweight badge (reusing the existing "needs review" pattern for `verbatim: false`) is worth adding once real-doc evidence shows how often this fires.

## Out of scope (v1)

- BCTO technique tagging (259 techniques / 20 groups) — rejected, see framework grounding above.
- CFIR 2.0 contextual-determinant tagging — rejected, see framework grounding above.
- Vector database / cross-document knowledge graph / retrieval — no identified use case; different product surface.
- `causalRole` classification on `inputs`/`activities`/`outputs`/`targetPopulation` (context-leak beyond outcome domains) — candidate v1.1, not v1.
- A second Gemini call or disagreement/verification pass specifically for causal chain.
- A visible second quality dimension — causal-chain evidence feeds the single `overallQuality` rating, it does not become its own S/A/W.
- New npm dependencies.

## Acceptance criteria

1. `causalRole` and `causalChainAssessment` are additive/optional; models without them (e.g. pre-v1 sessions, or documents with <2 present outcome horizons) behave exactly as today.
2. A model with a clear mechanism-leak item (program-action language sitting in an outcome column) gets `causalRole: 'mechanism_leak'` and a critique sentence naming it, without the extraction pass or item `text` being touched.
3. `overallQuality.rating` cannot be `Strong` when the guardrail threshold fires; the rollup never *upgrades* a model-assigned `Weak`/`Adequate`.
4. A document with only one present outcome horizon never gets a `causalChainAssessment` (field omitted, no forced `n/a`).
5. Coding export excludes `causalRole` / `causalChainAssessment`; full CSV includes them as informational columns.
6. No item is classified `mechanism_leak`/`context_leak` without a corresponding one-line justification in that item's `critique` text.
7. Fixture regression: existing fixtures (`oxford-circle-carnell-frc`, `performance-garage-youthmoves`) still pass after the change — this feature must not alter extraction behavior or existing critique fields.

## Open product questions

1. **Guardrail threshold** — is "≥2 leaks or ≥25% of present outcome items" the right default, or should it be tuned before shipping using the next 3–5 real docs (matching how extraction-confidence thresholds were tuned)?
2. **Scope of `context_leak` detection** — ship outcome-domains-only in v1, or extend to `inputs`/`targetPopulation` now? (Leaning: outcome-only first, extend once real-doc evidence shows it's needed — same "evidence-gated" posture the roadmap uses elsewhere.)
3. **UI badge** — is item critique text sufficient, or does `mechanism_leak`/`context_leak` warrant a visible badge (reusing the "needs review" pattern) so operators can filter/scan without reading every critique?
4. **Does `@lm-quality` want the guardrail threshold documented in `lm-quality-rubric.md` itself** (like the existing rollup hints) rather than only in this spec, so the two docs don't drift?

## Sequencing

1. `@product` (this doc) — owner review, lock scope + threshold defaults.
2. `@critique-prompt` — CMO-lens prompt section + worked examples (narrow — does not touch extraction prompt or overall rollup rubric wording beyond citing the new signal).
3. `@architect` — `causalRole` / `causalChainAssessment` types, critique schema additions, `applyCausalChainGuardrail` function, CSV columns.
4. `@lm-quality` — sign off on guardrail interaction with `overallQuality` rollup; decide whether to mirror the threshold into `lm-quality-rubric.md`.
5. `@ux` — only if Open question 3 resolves toward a badge.
6. `@devops` — typecheck/build/test; confirm fixture regression still passes.
7. Validate on next 3–5 real docs before tightening thresholds (same posture as `extraction-confidence-v1.md`).

## Closed decisions (this scope, 2026-09-14)

- CMO adopted as an internal critique-time lens — no new taxonomy dataset, no vector DB/graph.
- BCTO and CFIR 2.0 explicitly rejected for v1 — source documents are mostly bare bullets, insufficient to ground either taxonomy honestly.
- Causal-chain evidence feeds the existing single `overallQuality` rating via a deterministic downgrade-only guardrail; it does not become a second visible quality dimension.
- No new Gemini call — this stays inside the existing single critique pass.

## Changelog

| Date | Change |
|------|--------|
| 2026-09-14 | Initial draft — CMO lens scoped in; BCTO/CFIR/vector-DB scoped out; guardrail pattern proposed |
