# The three grouping defects were one bug, and it was ours

**Date:** 2026-09-23 · **Prompt version:** 2026-09-20.6 (unchanged; no prompt edit here) ·
**Documents:** the 14 recaptured ones · **Cost:** 46 extract calls

[The accuracy audit](./2026-09-23-accuracy-audit.md) found six structural defects and filed three
of them — A New Dawn's empty Short-Term Outcomes column, Cub Reporter's four misfiled items, YMCA
Youth Civic's fifth section — as one bug, "a label with no bullet marker". That attribution was
reasoned from the shape of the pages. It is wrong.

## What it actually is

Every extraction was replayed with Gemini's raw JSON dumped beside the normalized result. In all
three documents **Gemini put the items in the right column and our own code moved them out.**

`applySourceAwareMapping` remaps a group when its header names another column. It asked
`synonymToDomain`, which matches a domain word anywhere at a word boundary — right for reading what
a header means, wrong for overruling a column, because a sub-heading inside a correctly-placed
column is almost always "\<qualifier\> \<domain word\>":

| Group name | Column the model chose | Read as | Result |
|---|---|---|---|
| `Youth Outcomes`, `School/Community Outcomes` | Short-Term Outcomes | "outcomes" → General Outcomes | 9 items moved, both names flattened to "General", the column left empty |
| `Teacher/School Resources` | Activities, Outputs | "resources" → Inputs | 4 items moved under "General", both groups lost |
| `Sustained Community Impact` | Long-Term Outcomes | "impact" → Impact | no move: `inlineLabelGroups.ts` refuses to promote a band containing a label that names another column, precisely to stop that move. The cost was the grouping — four sections of five promoted their labels, this one did not |

**Across all fourteen documents the remapper fired a move four times, and was wrong all four.**
Every one is in the table above. It never moved anything correctly on any document we have.

The two failure directions are not symmetric. Not moving leaves items where the model's own reading
of the page put them, with the sub-heading intact and visible. Moving deletes the sub-heading, files
the items under "General" in another column, and looks deliberate to a reviewer.

## The fix

`columnNameToDomain` in `shared/domainSynonyms.ts`: a move now needs the **unqualified** column
name. `Outputs` under Activities still moves. `Teacher/School Resources` does not. The inline-label
guard asks the same predicate, so the two passes cannot drift apart — a label that would not trigger
a move can no longer disqualify a band.

Measured over the fourteen documents, holding Gemini's output constant:

| | |
|---|---|
| Documents whose normalized output changes | **3** |
| Documents byte-identical | **11** |
| Items gained or lost anywhere | **0** |

A New Dawn's Short-Term Outcomes goes from empty to `Youth Outcomes` (5) and `School/Community
Outcomes` (4). Cub Reporter's `Teacher/School Resources` returns to Activities (1) and Outputs (3)
and the spurious Inputs/General group disappears. YMCA Youth Civic's Long-Term Outcomes promotes its
three labels like the other four sections. Nothing else moves.

## The second fix: a section stop that is not a heading

The impact-statement fallback took the first stop word it found anywhere in the slice, so a
legitimate statement using one of those ordinary words was cut there. [PR #14](https://github.com/sevsevsev/LM-Extractor/pull/14)
recorded it and left it alone pending its own measurement. Here it is.

A stop word now only ends the statement when it **starts a heading**, and in flattened text a
heading is what sits between the end of the last sentence and the stop word with no lower-case prose
in it. Run the harvester over all fourteen text tracks:

| Document | Before | After |
|---|---|---|
| Performance Garage | cut after "...educational pathways and" | full sentence, ends "in the arts and beyond." |
| Oxford Circle | cut after "...support and family" | full sentence, ends "support and family resources." |
| The other 12 | — | unchanged (2 harvested identically, 10 return nothing) |

Neither shows up in an extraction, because Gemini fills `impactStatement` on both of those documents
and the fallback only runs when it does not — which is exactly why this was worth fixing before it
was needed.

Two smaller things went with it. The fast path had a floor of 80 characters and no ceiling, so a
slice that found no stop at all could return the rest of the document; it now shares the 600-character
ceiling the sentence path always had. And "reads as a list" counted asterisk pairs, so a statement
written as one emphasised sentence read as two bold runs and was thrown away — it counts complete
spans now. That one had a passing test only because the truncation bug was cutting the closing `**`
off the end before the check ever saw it.

## Re-baselining

Every committed snapshot was captured on prompt `2026-09-19.2` against a live `2026-09-20.6`, so
`regression:check` reported a change for every document it could test and the tier-1 guard was
guarding nothing. All 14 documents with a captured bundle are re-baselined here on `2026-09-20.6`,
with these fixes in: **7 refreshed, 7 given a first baseline.**

Re-running the check immediately afterwards, 12 of the 14 come back byte-identical. The two that do
not are Gemini's own run-to-run variation, not the code's — the request, the seed and the prompt are
unchanged by anything here:

- **Trinity** varies only in `unmapped`, where one run-on blob is one item in some passes and two in
  others. All seven grid columns are identical across the baseline and two further passes.
- **Achieve Now** differed on one run of four; the other three agree item for item in all six of its
  columns.

Both are inside Severin's gate — same items in the same columns. Worth knowing anyway: a baseline is
a single capture, so for a document that flips, which run got blessed is luck.

`harlem-lacrosse`, `philadelphia-ballet-lets-dance` and `seamaac-urban-arts` still have no captured
bundle, so their snapshots stay at `2026-09-19.2` and the check still exits non-zero naming them.
They are the three documents that were never uploaded.

One guard got weaker, and it is worth saying so. `inlineLabelGroups.test.ts` asserted that the
label-promotion pass regrouped exactly one snapshot of ten — the blast-radius measurement PR #9
shipped on, which worked because those snapshots predated the pass. Recaptured with the pass live,
every snapshot already carries its result, so the assertion becomes "changes nothing". That is
still a real guard over seventeen documents — the pass is idempotent and does not newly fire on any
blessed document — but the original question, how many real documents the pass changes at all, no
longer has a test. It has this document instead. Any baseline refresh does this to a test written
against pre-change snapshots; the thing to check after one is which tests just got quieter.

## What this does not fix

- **Defect 5**, Trinity self-reporting `partial` on a complete extraction.
- **Defect 6**, Rock School's DATE and contact fields, which have no schema field to land in.
- **The DesignPhiladelphia silent drop**: two versions of one logic model on slides 1 and 3, slide 3
  discarded, reported `ok` with high confidence.
- **A heading in Title Case** rather than caps would still read as prose to the new section-stop
  test. All fourteen documents set their headings in caps; there is no document in hand that shows
  the other case.
