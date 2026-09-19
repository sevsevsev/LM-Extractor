# Tier-1 regression set

A small, **stratified** set of documents replayed through the extract API on every prompt change,
diffed against committed snapshots. Ten documents, not a hundred — see "Why ten" below.

```bash
npm run dev                             # API must be running, GEMINI_API_KEY set
npm run regression:check                # diff vs snapshots; exit 1 if anything changed
npm run regression:check -- --update    # accept current output as the new baseline
npm run regression:check -- --only=oxford
```

## Why this works at ten documents

`server/geminiSeed.ts` keys Gemini's seed on **document content only** — never the prompt — and
extraction runs at `temperature: 0`. So re-running an unchanged prompt reproduces the same output,
and any difference the runner reports is attributable to the prompt change rather than to sampling
noise. That turns "estimate a rate, which needs ~100 documents per arm" into "diff ten outputs",
which needs no statistics at all.

Estimating an actual error *rate* still needs the full corpus. That's a milestone activity (Tier 3),
not something to do on every change. See `docs/specs/friction-log.md` session 4.

## Why bundles, not source PDFs

Conversion (pdfjs, canvas, html2canvas) is browser-only — there is no Node path from a PDF to a
`DocumentBundle`. So the runner replays **saved bundles**. That is also the better experiment: it
holds the conversion step constant, so a diff isolates the prompt instead of also picking up a
slightly different JPEG render.

Bundles are multi-MB base64 page rasters, so `bundles/` is gitignored. Snapshots are committed —
they are what the diff is against.

## Capturing a bundle (once per document)

1. `npm run dev`, then upload the document as normal.
2. In the browser console:
   ```js
   __lmRegressionBundles                          // names captured this session
   __lmSaveRegressionBundle('<name from above>')  // downloads <name>.json
   ```
3. Move the download to `fixtures/regression-set/bundles/` under the `bundle` filename the
   manifest specifies for that document.
4. `npm run regression:check -- --update` writes the first baseline.

The console helpers exist only in dev builds (`import.meta.env.DEV`); see
`captureRegressionBundle` in `App.tsx`.

## Why these ten

The set is chosen, not sampled — a random ten over-samples the easy middle. Each entry's `covers`
field in `manifest.json` says which prompt variant and which failure class it is there for. The
2026-09-19 batch ran 15 `vision+text` and 2 `text-only` documents and **zero** `vision-only` or
`+lowleg`, leaving the two variants where the known failures live completely untested — Oxford
Circle is in this set specifically to close that gap.

Coverage today:

| Variant | Documents |
|---|---|
| `vision+text` | 8 |
| `vision+text+lowleg` | 1 (Oxford Circle) |
| `text-only` | 1 (FirstHand PPTX) |
| `vision-only` | **0 — gap**, add an image-only PDF with no text layer |

## Reading the output

- `=` unchanged.
- `~` changed, with `field`, `moved`, `-` and `+` lines beneath it.

`moved` is reported separately from `-`/`+` on purpose: an item relocating between columns is a
*placement* change (COLUMN FIDELITY behaviour), while one appearing or vanishing is a *recall* or
*invention* change. Collapsing a move into a remove-plus-add would hide the distinction a prompt
change is usually being judged on.

A document with no captured bundle is reported loudly and exits non-zero. It is never silently
skipped — that is the failure mode the gold-fixture tests in `shared/extractPlacement.test.ts` had
for months, where both snapshot tests passed while asserting nothing.
