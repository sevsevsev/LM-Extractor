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
extraction runs at `temperature: 0`. So re-running an unchanged prompt is *intended* to reproduce
the same output, so that any difference the runner reports is attributable to the prompt change
rather than to sampling noise. That turns "estimate a rate, which needs ~100 documents per arm"
into "diff ten outputs" — in the common case, with no statistics needed.

**This is not absolute, and it's been observed to matter in practice.** `geminiSeed.ts`'s own
comment is upfront that Gemini's seed is "mostly deterministic... not a guaranteed absolute
deterministic behavior" — a stabilizer for sampling noise, not a hard guarantee. Confirmed
2026-09-19: running `regression:check` twice in a row against the **same** prompt version and the
**same** committed bundles produced two different item counts on more than one document (e.g. Cub
Reporter 111 vs. 115 items). So a single diff can mix real prompt effects with residual sampling
noise, and a document that changes between runs isn't automatically evidence the prompt made things
worse (or better) — check whether it *also* moves under an unchanged prompt before trusting the
diff. For a change you're not sure about, re-run `regression:check` once more without `--update`
against the same prompt version before concluding anything from a single pass.

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

## Why these eleven

The set is chosen, not sampled — a random ten over-samples the easy middle. Each entry's `covers`
field in `manifest.json` says which prompt variant and which failure class it is there for. The
2026-09-19 17-doc batch ran 15 `vision+text` and 2 `text-only` documents and **zero** `vision-only`
or `+lowleg`, leaving the two variants where the known failures live completely untested.

Real-document validation (2026-09-19, same day) against actual Drive-sourced files found two of
this set's own entries didn't cover what their `covers` field claimed — see the `CORRECTION` notes
on `oxford-circle-carnell-frc` and `performance-garage-youthmoves` in `manifest.json`. Neither
currently exercises `+lowleg`; `performance-garage-youthmoves` runs `text-only`, not `vision+text`.
`art-thru-youth` was added the same day to give `vision-only`/`+lowleg` real, verified coverage —
it's a genuine hard-stop case, not a hypothetical one.

Coverage today (actual, confirmed against the committed bundles — see `CORRECTION` notes above for
what changed from the original design intent):

| Variant | Documents |
|---|---|
| `vision+text` | 7 |
| `text-only` | 2 (FirstHand, Performance Garage) |
| `vision-only+lowleg` | 1 (Art Thru Youth — hard-stop case) |
| `vision+text`, clean/no-lowleg raster gap | Oxford Circle no longer covers this; still open |

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
