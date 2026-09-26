# A non-logic-model that fills a grid — what is known, and what the benchmark now measures

2026-09-26. Opened by refreshing the last three regression baselines onto prompt `2026-09-20.6`
(PR #21) and finding that `philadelphia-ballet-lets-dance` went from **0 items to 50** — 36 grid
plus 14 unmapped, stable across two runs — while still flagging `documentTypeAssessment:
not_logic_model`. Its manifest entry reads `must extract 0 grid items without inventing any`, and
the owner confirmed the source is not a logic model and nothing should be extracted from it.

## The cause

`WHEN THERE IS NO GRID`, added to the extract prompt in `2026-09-20.6` (commit 0f1a9f2). It tells
the model that when a source has no column headers, it should decide each item by what it *is* —
a resource, something the programme does, a countable product, a change in the people served —
rather than by where it sits. That section was written for Theory-of-Change documents, and its own
commit note records that its benefit was never demonstrated. This is the first measured effect it
has had.

It is not a code defect. The model did what the prompt asked.

## The conflict any fix has to survive

Three of the seventeen regression documents are flagged `not_logic_model`, and two of them hold
grid items. `harlem-lacrosse` went 19 to 50 through the same prompt section, and that change was
reviewed and accepted as wider capture rather than invention. `upenn-bioeyes` holds 6. So a blanket
"no grid items when the document is flagged" rule would empty a document whose current behaviour is
wanted. Whatever narrows the fallback has to separate a document that *states* a programme's logic
from one that *reports on* a programme.

## What the benchmark could see, and now can

Two gaps, both closed here, neither of which needed a client document.

**1. The scorer excused a manufactured grid.** Everything a non-logic-model prints is `tolerated`,
and tolerance excused a surplus item wherever it landed. So an extraction that sorted the whole
document into four grid columns scored a clean 100% on the one document in the set that exists to
catch exactly that. Tolerance now stops at the grid: on a document whose expected answer holds no
grid items, an item may land in `unmapped` freely and in a grid column not at all. Heading
tolerance on documents that *do* have a grid is unchanged, and all nine documents still score 100%
on every axis.

**2. The set had no headerless document.** Its only non-logic-model was a budget table *with*
column headers, so it never exercised the fallback at all. `evaluation-report-no-headings` is a
two-column, heading-free evaluation report: prose full of staffing, sessions, attendance and
outcome-shaped sentences that nonetheless report on a programme rather than setting out its logic.
`BenchmarkColumn.heading` now accepts the empty string, meaning a box printed with no heading.

## What this did NOT establish

**The synthetic document does not reproduce the defect.** Captured live on `2026-09-20.6`, the
extraction returned 8 items and put **all 8 in `unmapped`, zero in the grid** — the right answer.
So the fallback does not fire on every headerless document, and whatever trips it on the real one
is a property of that document's own content, not of headerlessness alone.

That makes the next step a first-hand look at the real document: are those 50 items text printed on
its pages, and does that text read as programme logic or as findings? Until that is answered, any
narrowing of the prompt is a guess. The raw answer for the synthetic case is committed at
`fixtures/normalize/raw/evaluation-report-no-headings.json`, so the correct behaviour is pinned
offline and a future change that breaks it will be caught in CI without a key.

## State

`philadelphia-ballet-lets-dance` stays at prompt `2026-09-19.2` in PR #21 so its failing diff stays
visible until the extraction is fixed. Nothing about the prompt has been changed.
