# Logic Model Extractor

Local Vite + React app that reliably extracts structured logic models from PDF/DOCX/PPTX via Gemini for downstream processing, supports human editing, and exports CSV / branded PDFs.

## Run locally (development)

1. `npm install`
2. Set `GEMINI_API_KEY` in `.env.local`
3. `npm run dev` — Express API (`:3011`) + Vite (`:3000`)

## Production (single process)

```bash
npm start
```

Builds the client, then serves API + `dist` from Express on `:3011` (override with `PORT`).

## Scripts

- `npm run dev` — API + Vite client
- `npm run build` — client only
- `npm run typecheck` — `tsc --noEmit`
- `npm start` — build + production server

## Hosted deploy (Vercel)

The same API is exposed two ways so one codebase serves both targets:

- **Local:** Express (`server.ts`) on `:3011`
- **Vercel:** serverless functions in `api/` (`/api/health`, `/api/gemini/extract`,
  `/api/gemini/detect-logic-models`, `/api/convert/pptx-to-pdf`)

The Gemini extract and detect routes delegate to shared handlers in `server/apiCore.ts`, so their
request/response behavior stays identical between the two paths. `/api/health` and the PPTX convert
route diverge: `/api/health` shares only `getApiKey()` — `server.ts`'s handler additionally reports
`libreOfficeWasm` and a `'production'|'development'` `mode`, while `api/health.ts` omits
`libreOfficeWasm` entirely and reports `mode` from `VERCEL_ENV || NODE_ENV || 'unknown'`. The PPTX
convert route shares `server/pptxConvertApi.ts`'s `handlePptxToPdfRequest`, but the two entry points
parse the request body differently (Express uses `express.raw`; the Vercel function hands the
handler whatever Vercel itself already parsed) — found via codebase audit
(`docs/specs/codebase-audit-2026-09-19.md` #18).

Setup:

1. In Vercel → Settings → Environment Variables, add `GEMINI_API_KEY` (Production + Preview).
2. Redeploy — env vars only apply to new deployments.
3. Verify `https<!-- -->://<your-app>/api/health` returns `{"ok":true,"configured":true,...}`.

Hosted limits to be aware of:

- **Request body ~4.5MB.** PDF page images are auto-downscaled to fit; local runs keep full fidelity.
- **60s function timeout.** Very long documents may still time out — run locally for those.

## Architecture notes

- Gemini is **server-side only** (`/api/gemini/extract`).
- Document libs are npm packages (no script CDNs).
- Brand tokens: `config/brand.ts`
- Specs/roadmap: `docs/specs/`
- Agents: `.cursor/rules/` — see `AGENTS.md`
