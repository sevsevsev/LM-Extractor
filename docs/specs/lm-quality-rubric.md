# LM overall quality rubric (v0.1)

> **Deprecated 2026-09 — removed from the app.** See
> `docs/specs/scope-extraction-only-2026-09.md`. Kept for historical reference only.

Status: **Active — tweakable**  
Owners: `@lm-quality` (rubric), `@critique-prompt` (item/domain prompts), `@product` (scale/IN-OUT changes)  
Implements in: `constants.ts` critique prompt + `types.ts` / critique schema (when built)  
Last updated: 2026-07-24

## How to change this later

1. Bump **version** in this file (v0.2 wording; v1.0 if scale/fields change).
2. Add a **Changelog** row.
3. Sync prompt excerpt → `constants.ts` / server critique schema.
4. Field/scale changes → `@architect` (`types.ts`, validators) + `@integrator` (exports).
5. Edit **this file first**, then code — do not leave rubric-only decisions in chat.

Item-assessment noise policy lives in § Item assessments.

---

## Scale (locked for v0.1)

| Rating | Meaning (model document quality — not program worth) |
|--------|------------------------------------------------------|
| **Strong** | Domains are present, correctly typed, and coherent as a causal chain; few or no guidance violations. |
| **Adequate** | Usable LM with notable gaps or misplacements; fixable without rewriting the whole model. |
| **Weak** | Missing critical domains, systematic mis-binning (e.g. outcomes in outputs), or little usable structure. |

Single overall rating only in v0.1 — **no** multi-dimension scores yet.

## Rationale (required with overall rating)

2–4 short bullets stating **why** the rating was chosen. Each bullet should cite evidence (domain or pattern), e.g.:
- “Short-term outcomes include behavior change (belongs in medium-term).”
- “Inputs omit financial resources.”
- “Activities→outputs→outcomes chain is readable.”

Ban unexplained ratings (e.g. Strong with many Weak critical domains).

## Rollup hints (guidance for the model — not hard code)

Prefer **Weak** if any of: empty/missing **outcomes chain that the source document includes**; outputs packed with outcome language; majority of **present** outcome items Weak; mission describes only activities (when mission text exists).
Prefer **Strong** only if ratings on **present** domains are mostly Strong/Adequate **and** progression across **present** outcome horizons holds (e.g. do not require medium-term if source had no Medium-Term column).
Otherwise **Adequate**.

**Presence-aware (v0.2):** Do not penalize empty optional domains (Mission, Medium-Term, grid Impact) when absent from source. Do not cite missing Mission in overall rationale. See `structure-aware-extract.md`.

**Causal-chain guardrail (v0.3 — implemented (local), tune thresholds from next 3-5 real docs):** A deterministic, code-level check (`shared/causalChain.ts` `applyCausalChainGuardrail`) caps a model-assigned `Strong` down to `Adequate` when structured CMO-lens signals (`causalRole` mechanism/context leaks on present outcome items, or `causalChainAssessment.coherence === "broken"`) cross a threshold (default: ≥2 leak items or ≥25% of present outcome items). Downgrade-only — never upgrades a model-assigned `Weak`/`Adequate`. Full design in `causal-chain-critique-v1.md`.

Human edits + re-critique may change overall; overall should be recomputed on critique pass.

## Proposed data shape (names for @architect)

```text
overallQuality: {
  rating: "Strong" | "Adequate" | "Weak"
  rationale: string[]   // 2–4 bullets
}
```

Full CSV / DB export: include overall rating + rationale (e.g. joined bullets or repeated rows — implementer choice, document in export spec).
Coding CSV: **omit** overall and item critiques (lean `outcome_text` handoff).

## Item assessments (v0.1 policy)

**Store all** domain and item ratings/critiques in the model and in the **full** export.  
Revisit later if exports are too noisy; change policy here first.

## Prompt excerpt (v0.2 — paste/adapt into critique prompt)

After domain/item critiques on **present** domains, assign `overallQuality.rating` and `overallQuality.rationale` (2–4 bullets). Skip critique/rating for empty optional domains (Mission, Medium-Term, grid Impact). Never cite absent Mission in overall rationale. See `constants.ts` `getAiCritiquePrompt()` for full text.

## Acceptance checks

- [ ] Every critiqued model has overall rating ∈ {Strong, Adequate, Weak}
- [ ] Rationale has 2–4 non-empty bullets
- [ ] Re-critique refreshes overall + rationale
- [ ] Full export includes overall + all item assessments
- [ ] Coding export excludes quality fields

## Changelog

| Version | Date | Change |
|---------|------|--------|
| v0.3 | 2026-09-14 | Causal-chain guardrail: deterministic downgrade-only cap on `Strong` from CMO-lens `causalRole`/`causalChainAssessment` signals (`causal-chain-critique-v1.md`) |
| v0.2 | 2026-07-28 | Presence-aware rollup: ignore absent domains; Mission not mandatory; progression across present horizons only (`structure-aware-extract.md`) |
| v0.1 | 2026-07-24 | Initial: single S/A/W + rationale bullets; store all item assessments; tweakable doc process |
