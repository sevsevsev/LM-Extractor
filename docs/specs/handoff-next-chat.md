# Handoff — Logic Model Extractor (next chat)

Paste this into a **new Agent chat** in this workspace to continue with full context.

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
