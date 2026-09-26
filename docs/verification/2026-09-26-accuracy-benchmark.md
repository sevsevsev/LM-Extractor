# An accuracy instrument, and a free loop for post-processing changes

2026-09-26. Built on Severin's "assess the codebase and consider any improvements… feel free to set
up some recursive tests… develop a benchmark and test to gauge accuracy of extraction behavior."

## The gap this closes

Every measuring instrument in the repository before today compares the pipeline with **itself**.
`npm run regression:check` diffs an extraction against a snapshot blessed on a past day.
`npm run census` compares two runs with each other. Both answer "did anything change". Neither can
answer "is it right", because a snapshot is whatever the pipeline emitted the day someone accepted
it. The project's own record says so plainly: *"reproducible and wrong is the one failure this loop
cannot see"*, and *"a reproducibility gate cannot see a reproducible defect"*.

The only accuracy measurement ever taken was the 2026-09-23 audit — a person reading 678 items
against page images, 678 of 678 found, 0 invented. That is the better instrument on real documents
and stays the instrument of record for them. It cannot run on every change.

A second gap sits behind it. `normalizeExtractedLogicModel` composes six passes: impact-statement
harvest, inline-label promotion, colon trimming, source-aware mapping, fidelity reconciliation and
the page-coverage check. Each has unit tests over hand-built objects. Their **composition over a
whole answer** had none — and both post-processing defects this project has shipped were
composition defects, invisible in every unit test that existed:

- the impact-statement harvester filling a field Gemini had correctly left empty (fixed in #14);
- the synonym remapper moving items out of columns the extraction got right (fixed in #16).

## What was built

**`shared/extractionScore.ts`** — a pure scorer. Given a known-correct answer and an extraction, it
reports recall (was anything lost), precision (is there surplus), placement (did anything move
column) and unsourced (is the wording findable in the document). 19 unit tests, including the
thresholds and the pairing rule, and the normalisation clauses are the ones `audit-coverage.mjs`
learned the hard way — this repo's oldest recurring mistake is a probe narrower than the data.

**`fixtures/benchmark/`** — seven invented logic-model documents, one JSON spec each, from which
both the .pptx and the expected answer are generated. Nothing is transcribed by hand, so they
cannot drift. Invented is load-bearing: every real logic model here is a client file, and a
committed benchmark could not carry one. A test fails if a known partner name appears in a spec.

The set covers the failure modes this project has actually shipped bugs against: a clean baseline
grid; inline `Label:` prefixes with no bullet marker (#9); group headings that END in a column word
(#16); one undifferentiated OUTCOMES column; columns headed in the organisation's own words; a
budget table that is not a logic model at all; and two drafts of one model on separate slides.

**`fixtures/normalize/` and `npm run replay`** — the model's raw answer to each benchmark document,
captured at the seam by a new `LM_DUMP_RAW` diagnostic in `server/geminiLogicModel.ts`, with the
blessed output of our post-processing over it. Because normalization is a pure function of the raw
answer plus three bundle-derived options, replaying it is free and a diff is attributable to your
change and nothing else. `shared/normalizePipeline.test.ts` enforces the same thing in CI, with no
key and no network, and also asserts idempotence — `App.tsx:48` normalizes a second time on the
client, so a pass that is not idempotent would quietly produce a third answer.

## Measured

**The benchmark, full run through the real app** (PPTX → LibreOffice → rasters → Gemini vision+text,
prompt 2026-09-20.6, 7 documents, 88 items extracted against 83 expected):

```
recall 100.0%   precision 100.0%   placement 100.0%   unsourced 0.0%
```

Run twice in full, identical both times. Every document came through the `vision+text` prompt
variant with page images, not the text-only fallback — the variant is printed on every row so a
benchmark cannot silently grade a path users do not take.

**The harness is faithful.** Replaying normalization offline over the captured raw answers produces
output byte-identical to what the server itself returned, checked on four documents against live
API responses. Without this the loop could measure its own error.

**The loop catches the regression it was built for.** Reverting one line of `shared/sourceMapping.ts`
to the pre-#16 loose form and running `npm run replay -- --score`, with zero Gemini calls:

```
column-word-in-group-name      CHANGED  (13 -> 13 items)
    moved  Activities/Youth Outcomes   -> General Outcomes/General: After-school homework club…
    moved  Activities/Youth Outcomes   -> General Outcomes/General: Saturday football coaching…
    moved  Outputs/Teacher Resources   -> Inputs/General: Sixty homework club places filled…
    moved  Outputs/Teacher Resources   -> Inputs/General: Twelve coaching sessions delivered…
    moved  Outputs/Community Impact    -> Impact/General: Four hundred pantry visits recorded…

column-word-in-group-name   placement 61.5%      TOTAL placement 94.0% (was 100.0%)
```

It names the five items, says where each went, and the accuracy number falls — in about a second.
The line was restored; `git diff` on that file is empty.

**A finding about the one known launch-gate failure.** The benchmark's `two-versions-one-model`
rebuilds, synthetically, the shape of the document that fails the gate: two differently worded
drafts of one model on slides 1 and 3 with an impact statement between them. Across three passes it
returned **18 of 18 items every time, from both drafts**, at 100% recall. So the two-draft shape on
its own does not reproduce the drop. Whatever causes it is something else about that real document.
This is a measurement only — what a two-draft document should produce is still an open product
question and no fix is proposed here.

## What this does not claim

The documents are as hard as they were written to be and no harder. 100% is evidence that nothing
in the set broke, not evidence about a partner's real document. A three-level-nested document is
deliberately excluded: the two-level schema cannot represent one, so its correct answer is undecided
policy rather than fact.

The scorer measures what was lost and what moved column. It does not proofread: two short items
differing in one salient word pair up at 0.8 similarity, which the threshold comment states and a
test pins. Group names are not scored, because the launch gate is "same items in same columns" and
grouping moves inside it.

Nothing here asks a model to grade a model. `docs/specs/scope-extraction-only-2026-09.md` cut that
pass in September and this keeps to its principle: code checks the model.

## Verification

`npm test` 354 pass / 0 fail / 1 skipped (was 324), `npm run typecheck` and `npm run build` clean.
No behaviour change to extraction: the only non-test change to shipped code is the `LM_DUMP_RAW`
diagnostic, which is off unless the env var is set and never touches the response.
