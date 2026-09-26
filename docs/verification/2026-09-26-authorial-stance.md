# Who is speaking decides whether there is a grid

2026-09-26. Fixes the regression found in PR #21: `philadelphia-ballet-lets-dance`, the one
regression document that must yield no grid items, went from 0 to 50 on prompt `2026-09-20.6`.

## What the pages showed

All six pages read at full size against the 50 items.

**Nothing is invented.** Twelve of the 36 grid items are exact substrings of the page text; the
other 24 are reworded from printed prose, and every low scorer traces to real content — the lists
filed as General Outcomes are printed as indented lists, the survey counts appear on two pages, the
weakest item fuses two sentences from two pages into one. The failure is not hallucination. It is
the model rewriting an evaluator's observations into logic-model phrasing: prose reporting that
teachers say students enjoy the classes, which give them the chance to express themselves
physically, becomes an outcome reading that students express themselves physically. The substance
is real; the grammatical frame is manufactured.

**It is findings, not a plan.** The document is a signed Final Programme Assessment Report by a
named external evaluator, first-person retrospective throughout. The items filed as outcomes sit
under a sentence about what could be seen the students had learned at the performances — evidence
of what happened. The only forward-looking content is three lists of recommendations, and those
were correctly routed to `unmapped`.

## Why it cannot be an item-level test

The report contains genuine intent sentences: it states the goals of the afterschool programme and
what a project is designed to give students. Judged item by item on what the text *is* — the test
`WHEN THERE IS NO GRID` prescribes — those are legitimately activities and outcomes. Any
item-level rule classifies them as grid content however it is worded.

`harlem-lacrosse` is the contrast, and the reason a blanket rule was not an option. It is a Theory
of Change one-pager in the organisation's own present-tense voice, headerless, reaching the same
fallback — correctly, because it genuinely is a statement of a programme's plan. Its 19 to 50
growth through that section was reviewed and accepted. Both documents are headerless prose. The
difference is **authorial stance and tense**: the organisation setting out its own programme,
versus an observer reporting what happened.

## The change

`WHEN THERE IS NO GRID` now decides for the whole document before it decides any item. It applies
when the organisation is setting out its own programme. It does not apply when the document is
someone reporting on a programme — an assessment, an evaluation, a review, a case study, a funder
report — with a named external author, a signature, a methods or survey passage, or findings
written about the programme rather than by it as the tell. When it does not apply, everything goes
to `unmapped`, every grid domain stays empty, and `documentTypeAssessment` is `not_logic_model` —
**explicitly including the case where individual sentences state the programme's goals.**

`PROMPT_VERSION` `2026-09-20.6` to `2026-09-26.1`.

## Measured

Two new benchmark documents make this measurable with no client document: the same invented
programme written twice, both headerless, differing only in who is speaking.

| | on `2026-09-20.6` | on `2026-09-26.1` |
|---|---|---|
| `assessment-report-third-party` | precision **0.0%**, 10 items, 6 in the grid | precision **100%**, 12 items, **all 12 unmapped, 0 grid** |
| `theory-of-change-own-voice` | 100% on every axis, 11 grid items | 100% on every axis, 11 grid items |
| the other nine documents | 100% on every axis | 100% on every axis |

All eleven captured through the real app. Total 138 extracted / 113 expected, recall 100%,
precision 100%, placement 100%, unsourced 0%.

The report half filed the evaluator's own observations under `outputs` and `generalOutcomes`,
including an item of the same shape as the one read on the real document's page 3. **PR #22's
scorer fix is what makes that visible** — before it, tolerance excused a surplus item wherever it
landed, so the report half scored a clean 100%.

## Measured on the real documents

Replayed on the owner's machine against the captured bundles. Judged on items in columns only —
this is the first prompt change since the `2026-09-20.6` baselines, so group-name, delimiter and
wording churn across the set is expected and the launch gate ("same items in same columns") does
not count it.

| document | grid items, old to new | columns | verdict |
|---|---|---|---|
| `philadelphia-ballet-lets-dance` | 36 to **0** (42 unmapped) | all cleared | **gate met** |
| `harlem-lacrosse` | 23 to **27** | none moved, 4 gained in `impact` | **gate met** |
| `seamaac-urban-arts` | 33 to 33 | **identical distribution** | wording and grouping only |
| `upenn-bioeyes` | 6 to 6 | **one moved**, `inputs` to `generalOutcomes` | owner's call |

Ballet's counter reads `0 -> 42 items` because that total sums grid and unmapped; the split is what
matters and the grid is empty. Stable across two runs. Harlem Lacrosse gained items and lost none,
so the narrowing does not empty a document written in the organisation's own voice — the thing that
had to hold. SEAMAAC is the control: an ordinary headed grid, same 33 items in the same six columns
before and after, `{inputs 10, activities 10, outputs 5, short 3, medium 4, long 1}`.

`upenn-bioeyes` was examined for the first time. It is a single image of six boxes joined by
arrows — teachers gaining skills, students doing experiments, students developing skills and
attitude, seeing science careers, pursuing further opportunities, employment in STEM — with no
named author, no signature and no findings passage, in the present and future tense. That is an
organisation's own chain of intended change, so the fallback correctly applies and extracting is
right. The one moved item is the first box, teachers acquiring skills and equipment, going from
`inputs` to `generalOutcomes`; that reads as the better placement, being a change in people rather
than a resource the programme holds, but it is a movement and so the owner's to accept.

## The flag no longer decides whether to extract

`documentTypeAssessment` is `not_logic_model` on all three of Ballet, Harlem Lacrosse and UPenn
BioEyes — including the two that legitimately extract. The flag describes layout: there is no
column grid to read domains off, so the app assigned them. The extract-or-not decision now keys on
authorial stance instead, so the two are independent. **Reading the flag alone will mislead**, and
`fixtures/regression-set/manifest.json` should not be read as saying a flagged document yields
nothing.

## What this does not measure

Thirteen of the seventeen regression documents. Bundles are gitignored, so a fresh clone
holds none, and only the four above had one. Capturing the rest needs their source files plus one
call each. The four cover both sides of the new rule and an unaffected control, but they are not
the whole set.

The replay fixtures for the other nine documents were deliberately **not** re-collected. They pin
post-processing, which this change does not touch, and letting them churn with every prompt edit
would cost the harness the one thing it is for.
