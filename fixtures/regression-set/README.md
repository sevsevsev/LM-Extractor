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

**Session 6 (2026-09-20) qualifies this further, and changes the remedy.** Running the *same*
prompt twice against the same bundles: Performance Garage and HNW Core Reporter came back
byte-identical, while HNW Cub Reporter churned heavily at a constant item count. The two stable
documents are shallowly nested; the churning one nests four levels deep in its outcome columns.
So the wobble is not (only) seed non-determinism — it is the model re-rolling an *underdetermined*
choice about how to flatten 3-4 source levels into this schema's two (`Group.name` -> `items[]`),
which nothing in the prompt specifies. Seed noise would not sort itself by nesting depth.

**The census will not call a document stable on two runs (2026-09-20).** The asymmetry is the
whole point: runs that DIFFER prove instability, runs that MATCH only fail to disprove it. So
`npm run census` prints `STABLE` only at `--passes=3` or more; below that it says "no differences
seen in 2 runs — NOT proof of stability" and lists those documents at the end. Two passes stay the
default because they are the cheap way to FIND instability.

Even three is a floor for the word, not a standard of proof. While this was being built,
Performance Garage — unstable in every prior census — produced two matching runs and then three
matching runs in a row. That is why every verdict states the run count it is based on.

Two consequences. First, "re-run once more before concluding anything" is not a general remedy:
for a deeply nested document a re-run is another roll of the same die, not a tiebreak. Prefer
running the *unchanged* prompt twice as an explicit control arm, and compare the prompt-change
diff against that floor. `scripts/capture-bundles.mjs` makes this cheap — bundles are rebuildable,
so arms can be re-run at will. Second, item counts on nested documents are not a meaningful
regression signal until the over-nesting policy is decided (friction-log session 6, Finding 3).

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

**Scripted (preferred — works on any machine, including a fresh clone):**

```bash
npm run dev     # in another shell; GEMINI_API_KEY must be set
node scripts/capture-bundles.mjs \
  healthy-newsworks-core-reporter=/abs/path/to/7_30\ -\ Healthy\ NewsWorks...pdf
```

It drives the real app in headless Chromium and reads the bundles App.tsx already retains on
`window.__lmRegressionBundles`, writing each to `bundles/<id>.json`. Each document costs one
Gemini extract call, since it runs the normal pipeline. Playwright and Chromium come from the
environment, not from `package.json`; point `LM_PLAYWRIGHT` / `LM_CHROMIUM` at them if they are
not on the default resolution path.

Because bundles are gitignored, this script — not the bundle files — is what keeps the Tier-1
loop reproducible. Before it existed, a fresh clone could not run `regression:check` at all:
every document reported "bundle not captured" and the runner exited 2 without one API call.

**Manual (browser console):**

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
| `vision-only` | 2 (BioEYES, Trinity) — added 2026-09-20, first of this variant ever run |
| `vision-only+lowleg` | 1 (Art Thru Youth — hard-stop case, yields no extraction to score) |
| `vision+text`, clean/no-lowleg raster gap | Oxford Circle no longer covers this; still open |

**`vision-only` is no longer untested (2026-09-20).** Session 4 Finding 2 named it and `+lowleg`
as the two variants where the known failures live, and neither had ever been run. Both PNGs now
in the set extract well — Trinity matches its source infographic column for column, including a
three-level OUTCOMES structure routed to the correct time-horizon domains with no text track to
lean on. What they are NOT is stable: both differ between identical runs, on grouping only.
`+lowleg` remains genuinely untested for *accuracy*, because the one `+lowleg` entry hard-stops
and so produces nothing to score. Closing that needs a low-DPI raster the app still attempts.

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
