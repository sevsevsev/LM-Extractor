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

PowerPoint needs two things on a hosted deployment, and both are easy to lose:

1. **The LibreOffice WASM has to be in the function's bundle.** Nothing imports those ~237MB by
   path — `getLibreOfficeWasmPath()` builds the path at runtime — so a bundler that ships a
   function by tracing its imports leaves them out. `vercel.json` names them with `includeFiles`,
   and gives that one function 2048MB: LibreOffice peaks at ~1.07GB converting a one-line document,
   which is already over the 1024MB the route used to run with. 2048MB is the ceiling on a Hobby
   account — a deployment that asks for more is rejected outright at build time — so a deck heavy
   enough to need more than that has no headroom left to take.
2. **The upload has to arrive as bytes.** The browser sends `application/octet-stream`, not the
   OOXML presentation type: a serverless host parses the body by content type and hands the
   function `undefined` for anything outside its short list. Sent honestly, the deck's bytes never
   arrived at all and the route answered 400 before LibreOffice was reached. The function also
   reads the request stream itself as a backstop.

`GET /api/convert/pptx-to-pdf` answers whether that deployment can convert PowerPoint:
`{"ok":true,"libreOfficeWasm":true}`. It lives on the convert route rather than in `/api/health`
because each function is bundled separately, so only that function can answer for its own files.

Hosted limits to be aware of:

- **Request body ~4.5MB.** PDF page images are auto-downscaled to fit; local runs keep full
  fidelity. A PowerPoint is uploaded whole, so a deck above that limit fails hosted whatever else
  is configured.
- **60s function timeout.** Very long documents may still time out — run locally for those.

## Architecture notes

- Gemini is **server-side only** (`/api/gemini/extract`).
- Document libs are npm packages (no script CDNs).
- Brand tokens: `config/brand.ts`
- Specs/roadmap: `docs/specs/`
- Agents: `.cursor/rules/` — see `AGENTS.md`
