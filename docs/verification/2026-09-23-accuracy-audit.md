# Are the new extractions right? All 678 items, read against the pages

**Date:** 2026-09-23 · **Prompt version:** 2026-09-20.6 (unchanged; nothing here re-ran an
extraction) · **Cost:** zero API calls

The stability re-measurement ([the previous document](./2026-09-22-evidence-after-the-renderer-fix.md))
ended on a warning: item counts had moved — Cub Reporter 144 to 124, Rock School 63 to 61 — so
those were different extractions from the ones anybody had audited, and nobody had checked the new
ones. Reproducible and wrong is the one failure that loop cannot see. This is the check.

Every one of the 14 recaptured documents was audited item by item: the bundle's own page images
written out and read against the extraction, in both directions. Missing asks whether anything on
the page failed to reach the extraction. Invented asks whether anything in the extraction is absent
from the page.

## The number

**678 items across 14 documents. 678 found on the pages. 0 invented.**

| Document | Source | Items | Missing | Invented | Structural defects |
|---|---|---|---|---|---|
| sample-mamadele-axe-puro | PDF | 80 | 0 | 0 | — |
| healthy-newsworks-cub-reporter | PDF | 124 | 0 | 0 | 4 items in the wrong column |
| sample-rock-school-rockreach | PDF | 61 | 0 | 0 | template metadata unmapped |
| a-new-dawn | DOCX | 60 | 0 | 0 | short-term column empty; impactStatement is raw Markdown |
| trinity-boys-girls-rising | PNG | 54 | 0 | 0 | self-report says partial on a complete extraction |
| sample-achieve-now | PDF | 52 | 0 | 0 | — |
| performance-garage-youthmoves | PPTX | 47 | 0 | 0 | — |
| healthy-newsworks-core-reporter | PDF | 45 | 0 | 0 | — |
| firsthand-pptx | PPTX | 45 | 0 | 0 | — |
| oxford-circle-carnell-frc | PDF | 44 | 0 | 0 | — |
| ymca-teen-workforce | DOCX | 29 | 0 | 0 | — |
| ymca-youth-civic-engagement | DOCX | 18 | 0 | 0 | label promotion skipped one section |
| art-thru-youth | PNG | 13 | 0 | 0 | — |
| upenn-bioeyes | PNG | 6 | 0 | 0 | — |

The invention rate is now 0 in 678 items measured on the path the tool actually runs, replacing the
0-in-586 figure that was earned through a broken renderer. Nine of the fourteen documents are clean
on every axis.

## The 20 items Cub Reporter "lost" are all accounted for, and none of them is content

This was the headline worry, and it dissolves on the page. The 124 items are all 124 things on the
document; the 144 counted 20 things that are not items:

- **18 category labels.** The three outcome columns each carry "Academic Skills", "Soft Skills" and
  "Health Knowledge & Behaviors" under both Core and Cub Reporters — 3 x 2 x 3 = 18 underlined
  headings. They are now prefixes on the items they head, which is PR #9's promotion pass doing its
  job.
- **2 section headers** that became group names instead of items.

124 + 18 + 2 = 144, exactly. Rock School's 63 to 61 cannot be attributed the same way — the old
extraction was made through the broken renderer and is gone — but its 61 are verified complete
against the pages, so nothing is missing now whatever the old run was counting.

## What the audit found wrong

None of it is content loss. All of it is structure, and two of them a user would see.

**1. A New Dawn's `impactStatement` is a raw Markdown fragment.** It reads
`(3-5 years)** **For Students** - Increased graduation rates...` — it begins mid-heading, carries
literal asterisks, duplicates the whole of longTermOutcomes and ends on a dangling hyphen. This is
DOCX text-track Markdown landing in a scalar field. It shows in the review board and in the PDF
export. The most visible defect in the audit.

**2. A New Dawn's short-term column is empty.** The source heading is
"4. SHORT-TERM OUTCOMES (3-12 months)" — about as explicit as a document gets — and all 9 of its
items sit in `generalOutcomes` while `shortTermOutcomes` is `[]`. Its two subheadings were also
flattened into one "General" group, while section 6 of the same document kept both of its
subheadings as groups. The rule worked three sections later on the same page.

**3. Cub Reporter files 4 items under the wrong column.** `inputs` carries a group called "General"
holding one item from the Activities column and three from the Outputs column — both source groups
being plain-text headers with no bullet marker, the same shape as the Musicopia miss. Nothing is
lost; `activities` and `outputs` are each short a group that exists on the page.

**4. YMCA Youth Civic Engagement promotes labels in four sections out of five.** Inputs, Activities,
Outputs and Short-Term Outcomes all lift the bold label to a group name. Long-Term Outcomes does
not, and keeps its labels inline in the item text. Same page, same markup, two behaviours.

**5. Trinity's self-report under-claims.** `extractionStatus` is `partial` and confidence `medium`
on an extraction that is in fact 54 of 54. Wrong in the safe direction, but the model's self-report
is the only coverage signal the app has, so it being wrong either way is worth knowing.

**6. Rock School drops the template's metadata.** DATE, NAME OF PROGRAM CONTACT and E-MAIL ADDRESS
are on pages 1-2 and appear nowhere in the extraction, not even `unmapped`, which did capture the
PROBLEM STATEMENT. There is no schema field for them; this is a schema question, not a bug.

## What the audit retracts, and it is mine

**The Achieve Now fixture correction in PR #12 was wrong, and it is on main.** That correction said
the never-repair guard had turned backwards — that the source does not read `Hjgh rate of volunteer
retention`, that it reads `High`, and that the renderer was substituting the glyph.

Magnified 6x, the first Long-term box reads **`Hjgh`** on today's renderer. Cropped at the same
coordinates, the pre-fix render reads **`Hjgh`** too, in a substituted sans-serif face. The typeface
moved; the letters never did. The typo is the source document's own, the guard as originally written
is right, and an extraction that tidies it to `High` is still a regression. The manifest, the
previous verification document and the friction log are all corrected in this change.

Achieve Now has two boxes in play — the genuinely damaged mojibake one, which today reads
"Volunteers and students receive stronger, more targeted support", and the `Hjgh` one three rows
above it. I treated them as one box and published the conclusion without cropping and reading the
second. That is the same failure as the scan verdict that the previous document opens by confessing
to, committed an hour later, on the same document, in the same session.

One thing the retraction does not have to undo, checked rather than assumed: **nothing executable
ever asserted `High`.** This document's guard is the `covers` prose in `manifest.json`, PR #12 added
a contradicting CORRECTION after that prose rather than replacing it, and `sample-achieve-now` has
no entry in `fixtures/regression-set/snapshots/`, so `regression:check` had no baseline for it at
all. The string `High rate of volunteer retention` appears nowhere in the repository. The bundle and
the stored extraction both carry `Hjgh`. Restoring the prose here restores the whole guard.

## Four near-misses the audit had to walk back before filing

Each of these looked like a finding and was not. The pattern is the one this project keeps
relearning: the probe is narrower than the data.

- **Core Reporter's impact statement looked dropped.** It was below the fold in my own dump script's
  output. It is captured, verbatim.
- **Performance Garage's impact statement looked rewritten.** Slide 2's headline and the extraction
  open with different clauses. Slide 1 carries the extraction's wording under an IMPACT STATEMENT
  heading. Reading one page of two manufactured the discrepancy.
- **firsthand's medium-term column looked one item short.** Counting the raster gives 7; the 8th is
  clipped off the converted slide and is in Track A. Counting from the picture alone is wrong.
- **Oxford Circle's TF-CBT item looked truncated.** It ends mid-phrase because the box on the page
  ends mid-phrase.

## Where the extraction is doing something genuinely hard

Worth recording, because the defect list alone reads more bleakly than the set does.

- **Mamadêlê is a 6x6 matrix** — six pipeline columns crossed with six "Core Values" rows — and the
  extraction uses the row labels as group names inside every column, producing exactly 36 groups and
  all 80 cells in the right places.
- **Never-repair held four times.** `Hjgh` (Achieve Now), `Suport` and `Art/ArtnCrafts` (Art Thru
  Youth), `Excell` (Performance Garage), "science in relevant in everyday life" (firsthand), and
  "Schools, businesses, nonprofits, and schools" (Cub Reporter) are all reproduced as written. The
  YMCA sibling documents disagree with each other about "Great" versus "Greater Philadelphia YMCA";
  each extraction copies its own title.
- **Nothing was invented into an empty field.** Oxford Circle's page 1 has a bare "-" in both
  BRIEF PROGRAM OVERVIEW/MISSION and WHO THE PROGRAM SERVES, and the extraction emits neither field.
- **The two tracks covered for each other twice.** Both PPTX conversions clip text out of their
  boxes, and both times the full item came back off Track A.
- **Undifferentiated outcome columns went to `generalOutcomes`, not to a guessed time axis.** Rock
  School and Art Thru Youth both head their column "OUTCOMES" with no horizon, and both leave
  short/medium/long empty rather than inventing a split. BioEYES is correctly reported as
  `not_logic_model` / `partial` / `medium` — it is a Theory of Change pathway, and says so.

## What this means for the launch gate

Severin's gate is same items in the same columns, and the re-measurement met it: 14 of 14, every
pass. This audit says the items being reproduced are the right ones — the gate is measuring real
extractions, not a stable wrong answer.

It does not say the columns are always the right columns. Defects 2, 3 and 4 are all
column-or-group assignment, all on the same underlying mechanism — a label with no bullet marker —
and all three are reproducible, which means the gate as defined will pass them forever. A
reproducibility gate cannot see a defect that reproduces. That is the argument for this audit
existing, and the argument for repeating it whenever the grouping code changes.

## What is left

1. **Decide on the A New Dawn `impactStatement` bug.** It is a user-visible string of Markdown
   noise in an export. Smallest real fix in the list.
2. **Decide whether the inline-label rule should be one rule.** Defects 2, 3 and 4 are one bug wearing
   three hats. Any change here needs a paired census, because grouping is the unstable axis.
3. **The three documents still unmeasured:** `harlem-lacrosse`, `philadelphia-ballet-lets-dance` and
   `seamaac-urban-arts`.
4. **The DesignPhiladelphia silent-drop defect**, still open and still unqueued: two versions of one
   logic model on slides 1 and 3, slide 3 discarded, reported `ok` with high confidence.
5. **Give `manifest.json` an explicit `sourceFormat` field**, so the ingest-path sorting the previous
   document had to do by reading prose becomes mechanical.
