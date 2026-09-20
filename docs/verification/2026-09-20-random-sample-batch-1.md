# Random sample, batch 1 — invention and completeness

**Date:** 2026-09-20 · **Prompt:** 2026-09-20.6 · **Arm:** vision+text, one pass each

The first batch of documents drawn at random rather than chosen. This matters: every earlier
completeness number in this repo (including the 119/119 in
`2026-09-20-scorecard-summary.md`) came from the fixture set, which was *selected* — mostly for
being interesting or for having previously failed. A rate measured on selected documents is not a
corpus rate. These four are, so far as the method allows, a sample.

## Result

| Document | Source items | Extracted | Invented | Missed |
|---|---|---|---|---|
| PlayArts Play Loud | 33 | 33 | 0 | 0 |
| ArtWell We the Poets | 18 grid + 3 scalar | 18 + 3 | 0 | 0 |
| Lantern Illumination | 33 grid + 3 scalar | 33 + 3 | 0 | 0 |
| Your Voice Heard (grief support) | not a logic model | 0 grid, 4 preserved | 0 | n/a |

**Invention: 0 of 88 items. Completeness: 84 of 84 gridded items, plus 6 of 6 scalar fields.**

Four documents is a small sample and one of them turned out not to be a logic model, so the
denominator for "real logic model, fully read" is three. Read this as a spot check that found
nothing, not as a rate.

## What each document exercised

**PlayArts** — a clean 6-column grid, the easy case. Notable only for two things the
never-repair rules exist for: the source spells the same place `Moffet Maker's Space` in
Resources and `(Moffett)` in Long-term, and the extraction preserves both rather than
normalising; `Providing scholarships spots` and `Increased skills public speaking and
performance` keep their source grammar.

**ArtWell** — a School District template with instruction text still in it. The extraction
correctly dropped the italic template prompts (`Human, material, financial & knowledge (ie.
Program Curriculum)`), the upload banner and the footer, while keeping the one line inside the
template box that the organisation actually filled in (the impact statement). Discarding
boilerplate without discarding the answer written into the boilerplate is the harder half of
that, and it got it right.

Two audit notes, neither a defect:
- The impact statement landed in the scalar `impactStatement`, not in the `impact` group field.
  A flattener that only walks group-bearing fields reports this document as missing its impact
  statement. It is not; scan scalars first.
- `targetPopulation` ("K-12th grade students across Philadelphia") was *inferred* from a span of
  the impact statement — this document has no "who the program serves" box. Compare Lantern,
  which has one and was read directly. Scalar fields carry no `mappedBy`/`mappingConfidence`, so
  there is no record downstream of which of those two happened. Worth knowing before anyone
  treats `targetPopulation` as read-from-source.

**Lantern** — two pages, and the only document here with a meaningful colour encoding: grey for
resources, and then teal / blue / navy running left to right across all five other columns for
the residency, matinee and teacher-training strands. All 33 items carry the right colour. The
source prints no key for it, so `colorLegend` is correctly empty — which means the strand is
captured but not interpretable downstream. That is a limit of the source, not of the extraction.

**Your Voice Heard** — a promotional one-pager for a grief-support practice, not a logic model
at all. `documentTypeAssessment: not_logic_model`, zero grid items, and the four body paragraphs
preserved under `unmapped`. This is the 2026-09-20.4 and .6 behaviour working: nothing invented
into columns, nothing thrown away.

It also produced a clean demonstration of why the bundle carries two tracks. The page image
renders one word as `prac t ced` (a ligature the rasteriser drops). The extraction says
`practiced`. That looks like a never-repair violation until you check the bundle's text track,
which has the word intact — so this is Track A supplying what Track B could not render, which is
what the dual track is for.

## Finding: `verbatim` is undefined but still gates the rollup

Not a sample result; found while auditing. `verbatim` is no longer defined anywhere in the prompt
(2026-09-20.2 removed it), but `server/geminiLogicModel.ts:26` still requests it in the response
schema and `shared/extractionFidelity.ts:193` still counts it into the ratio that can drive
`extractionConfidence` to `low`. It comes back `true` on 100% of items so the gate never fires —
which is luck, not a guarantee. Full write-up and the three candidate fixes: friction log session 19.
