# Handoff — Logic Model Extractor (next chat)

Paste this into a **new Agent chat** in this workspace to continue with full context.

> **Stale as of 2026-09-19 — read `current-prd.md` and `roadmap.md` first, not this file.** Found
> via codebase audit (`docs/specs/codebase-audit-2026-09-19.md` #20): this doc still describes the
> pipeline as "extract → critique → edit" and lists critique-era UI under "What works" — critique
> was removed in the 2026-09 scope narrowing (`scope-extraction-only-2026-09.md`). "`npm test` — 4
> validator tests" is also long stale (155+ now). A large amount of feature work has shipped since
> this doc was last accurate (multi-logic-model split, extraction fidelity/spot-check highlighting,
> document-type flags, coding export, extraction log export, and more) that isn't reflected below at
> all. Unlike `current-prd.md`, this doc carried no deprecation banner until now — pasting it as-is
> into a fresh chat would hand that agent a materially wrong picture of the app's current pipeline
> and status. The sections below are kept for their still-useful "how to run this" mechanics, not as
> a feature inventory.

---

## Status
In-scope **local MVP roadmap is complete**. Post-MVP plan is **validation-first** (see `docs/specs/roadmap.md` Phases 0–4). Agents in `.cursor/rules/`.

## Users / hosting (product decision — 2026-07-24)
- **Users:** Just the owner + one colleague (ingest/extract/edit/export).
- **Hosting:** Prefer **local** (`npm run dev` or `npm start`). Optional private Vercel is *not* the default.
- **Auth / public cloud:** Remain **out of scope** unless re-approved. Draft only: `docs/specs/phase-2-cloud.md`.

## What works
- Upload PDF/DOCX/PPTX → vision/text convert → Gemini extract → critique → edit → CSV/PDF
- Server-side Gemini on Express **:3011**; Vite **:3000** proxies `/api` in dev
- Brand tokens: `config/brand.ts` (SDP defaults)
- Errors/retry/remove; re-critique without unmounting editor; Weak-first collapsible sections
- npm file libs (no script CDNs); Tailwind v4; code-split (~230kb main)
- `npm start` serves API + `dist` in production mode
- `npm test` — 4 validator tests

## Key paths
- PRD: `docs/specs/current-prd.md`
- Roadmap: `docs/specs/roadmap.md`
- Friction log: `docs/specs/friction-log-template.md`
- Agents: `AGENTS.md`, `.cursor/rules/`
- API: `server.ts`, `server/geminiLogicModel.ts`
- Client Gemini: `services/geminiService.ts` (fetch only)
- Conversion/export: `services/fileService.ts`, `services/pdfService.ts`

## Run
```bash
# .env.local must contain GEMINI_API_KEY=...
npm run dev    # API :3011 + Vite :3000
# or
npm start      # build + Express serves everything on :3011
```

## Suggested next work (pick one)
1. **Real-doc validation** — run colleague workflow; fill `docs/specs/friction-log-template.md`
2. **Colleague onboarding** — short runbook (install, env, ports, `npm start`, refresh loses work)
3. **Small feature** — only after `@product` scopes IN/OUT from friction-log evidence

## Do not
- Put `GEMINI_API_KEY` back in the Vite client bundle
- Assume Vercel “just works” without an explicit deploy PRD
- Expand to auth/multi-tenant without updating `current-prd.md`
- Scope features without ≥5 friction-log sessions (unless pure docs/runbook)
