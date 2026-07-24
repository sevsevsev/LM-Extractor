# Logic Model Extractor

Local Vite + React app that extracts structured logic models from PDF/DOCX/PPTX via Gemini, critiques them against guidance, supports human editing, and exports CSV / branded PDFs.

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

## Architecture notes

- Gemini is **server-side only** (`/api/gemini/extract`, `/api/gemini/critique`).
- Document libs are npm packages (no script CDNs).
- Brand tokens: `config/brand.ts`
- Specs/roadmap: `docs/specs/`
- Agents: `.cursor/rules/` — see `AGENTS.md`
