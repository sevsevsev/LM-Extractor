# The four assessment findings, taken care of

2026-09-26, on Severin's "Yes, take care of them, please." after the codebase assessment in PR #18.
Four findings were raised there and left unchanged pending his word. All four are done here.

## 1. `services/fileService.ts` had 1610 lines and no test file

The largest untested file in the repository, and the layer behind the renderer bug (#8) and both
PowerPoint failures (#10, #17). Conversion itself is browser-only and cannot be tested in Node —
but most of what was in there is not conversion, it is arithmetic and string handling that happened
to live in a browser-only module.

Four modules came out, verbatim, with their comments:

- **`shared/pdfRasterPlacement.ts`** — the matrix replay that recovers how large a PDF painted each
  embedded image. The pdfjs operator codes are now passed in rather than imported, so the module
  pulls in no browser dependency and a test can name its own op numbers. 8 tests, including the
  save/restore stack (without which a second image inherits the first one's scale) and a rotated
  placement, whose true size is in the matrix's `b` and `c` terms where reading `a` and `d` alone
  reports zero.
- **`shared/pageRasterAnalysis.ts`** — ink detection, the content box, the column bands and the
  render-scale decision. `analyzeCanvasPixels` already took a pixel array rather than a canvas, so
  it was always testable; it just had nowhere to be tested from. 12 tests, including the contract
  that matters under budget pressure: a flattened raster never falls below its density floor,
  because its glyphs have no other source of detail.
- **`shared/pdfTextTrack.ts`** — pdfjs's per-run fragments into the Markdown Track A the prompt
  reads. This is the only structural signal a PDF's Track A carries, and it had no test. 11 tests,
  including that the heading threshold is the median and not the mean, so one oversized cover title
  cannot suppress the real section headings beneath it.
- **`shared/documentBundleAssembly.ts`** — the single funnel every converter's bundle passes
  through. Two invariants live here and nowhere else, and both were bugs once: the low-legibility
  warning deduped against `bundleImpliesLowLegibility`'s own matcher rather than a second copy, and
  binary payloads stripped from every Track A. 9 tests.

`services/columnDetect.ts` moved to `shared/` with its existing tests, so `shared/` no longer
imports from `services/`.

`fileService.ts` is 1360 lines. Nothing in it changed behaviour; the code was moved, not rewritten.

## 2. `App.tsx` had 1553 lines and no test file

Two modules out:

- **`shared/sessionRecord.ts`** — the session checkpoint round trip. This is where a reload either
  keeps the operator's work or silently loses it, and it is two hand-written field lists that must
  stay in step: add a field to `ProcessingFile`, forget one list, and a resumed session comes back
  subtly wrong with nothing failing. 11 tests, the central one being a full round trip over every
  field. **It earned its place the same afternoon**: adding `modelId` for finding 4 broke it
  immediately, which is exactly the failure it was written to catch.
- **`shared/friendlyError.ts`** — the error-to-sentence mapping. 9 tests, including that a vision
  failure passes through before the later patterns rewrite it into something vaguer.

`App.tsx` is 1464 lines.

## 3. `npm run regression:check` failed in its resting state

It exited 2 whenever any manifest document had no captured bundle. Bundles are gitignored, so that
was true on every fresh clone and was the repository's ordinary state: the tier-1 guard reported
failure while nothing was wrong. A guard that cries wolf at rest is one people learn to ignore.

The decision is now `shared/regressionOutcome.ts`, judged by what the run achieved rather than what
it lacked: **0** when something was measured and nothing changed, **1** when a measured document
changed, **2** when an extract call errored or nothing was measured at all. Skipped documents are
still named loudly in the output. `--require-bundles` restores the strict behaviour for a machine
that should hold the whole set.

The case the old rule was really guarding is kept: a run that tested nothing never looks like a
pass. Verified in place — on this clone, which has no regression bundles at all, the check reports
"Nothing was tested: all 17 document(s) in scope have no captured bundle" and exits 2. The partial
case that used to be the annoyance has a test per row of the table.

## 4. The served model was recorded nowhere

`EXTRACT_MODEL_ID` is `gemini-flash-latest`, a rolling alias, and deliberately so — a pinned
snapshot gets sunset for new keys. The cost of that choice is that Google can rotate what answers
underneath us with no change here, and the record carried only the prompt version. An accuracy
shift originating at Google would have left no trace, and the search would have started in our own
diff.

The server now returns `modelId` beside `promptVersion`, it is carried on `ProcessingFile`, kept
across a reload in the session checkpoint, written into the `LM_DUMP_RAW` diagnostic, and exported
as a `model_id` column in the extraction log. Verified against the live API: the extract response
returns `modelId: gemini-flash-latest`.

## Verification

`npm test` 426 pass / 0 fail / 1 skipped (was 395 at the start of this work, 324 before PR #18),
`npm run typecheck` and `npm run build` clean.

No extraction behaviour changed. `npm run replay -- --score` over all seven benchmark documents is
byte-identical to the blessed output and still scores 100% recall, precision and placement — which
is the point of having built it: a refactor this size would otherwise have been argued about rather
than measured.
