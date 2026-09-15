# Tech spec — Overall quality + Export for coding

> **Section 1 (Overall quality) deprecated 2026-09 — removed from the app.** See
> `docs/specs/scope-extraction-only-2026-09.md`. Section 2 (Export for coding) is unaffected and
> still active.

Status: Ready for implementer  
Stack: existing Golden Path only (no new packages)

## 1. Overall quality (`LogicModel`)

Add to `types.ts`:

```ts
export interface OverallQuality {
  rating: 'Strong' | 'Adequate' | 'Weak';
  rationale: string[]; // 2–4 bullets
}

// on LogicModel:
overallQuality?: OverallQuality;
```

- Extend critique JSON schema in `server/geminiLogicModel.ts` to require `overallQuality` on critique responses.
- Extend `getAiCritiquePrompt()` in `constants.ts` to instruct overall rating + rationale per `docs/specs/lm-quality-rubric.md` v0.1.
- Validator (`shared/logicModelValidate.ts`): on critique result, require rating enum + rationale length 2–4 (or ≥1 soft / 2–4 preferred — prefer enforce 2–4).
- Editor: show overall rating + editable rationale bullets (keep simple; re-critique overwrites unless product says preserve human edits — **v1: model overwrites on re-critique**, human can edit fields like other critiques).
- Full CSV: add columns `Overall Rating`, `Overall Rationale` (rationale joined with ` | ` or `; `) on each row **or** once per org/program — prefer **repeat on every row** for flat DB load simplicity.

Rubric source of truth: `docs/specs/lm-quality-rubric.md` (tweak doc first, then prompts).

## 2. Export for coding

- Client-only CSV builder in `App.tsx` (or small helper in `services/` if cleaner) — no server change.
- Spec: `docs/specs/export-for-coding.md` v1.0.
- Domains allowlist: exact labels used in export today (`Short-Term Outcomes`, etc.).
- Do not include quality columns.

## 3. Non-goals
- Third Gemini pass (fold overall into existing critique pass).
- Changing coder app.
- Auth/cloud.

## 4. Test plan
- Validator unit tests for `overallQuality`.
- Manual: critique returns overall; full CSV has columns; coding CSV uploads to Qualitative Outcomes Coder.
