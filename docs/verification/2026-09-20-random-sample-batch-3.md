# Random sample, batch 3 — invention, completeness, and the first XLSX

**Date:** 2026-09-20 · **Prompt:** 2026-09-20.6 · **5 Gemini calls + 2 controls**

Fills the two manifest gaps (`philadelphia-ballet-lets-dance`, `a-new-dawn`) and adds the first
spreadsheet to any audit.

## Result

| Document | Source | Extracted | Invented | Missed |
|---|---|---|---|---|
| Philadelphia Ballet — Let's Dance | prose report, not a logic model | 49 | 0 | n/a |
| A New Dawn | 60 bullets | 60 | 0 | 0 (but misrouted — see below) |
| Educators of Colors 1865 | 17 | 17 | 0 | 0 |
| Philadelphia Zoo — Animal Academy (XLSX) | 8 sheets | 77 (60 real + 17 bare numbers) | 0 | 0 |
| Greener Partners | 48 | 48 | 0 | 0 |

**0 inventions in 251 items.** Cumulative over three batches: **0 in 586 items across 14 documents.**

## The audit probe was wrong again — fourth time

`a-new-dawn` first read as 50/61, with 11 outputs like `500 lbs. of produce grown and shared`
apparently absent from Track A. They were present, wrapped in Markdown bold: `**500 lbs. of
produce** grown and shared`. The extraction correctly strips emphasis markers; the probe did not.

That is the fourth blind spot in this tool (whitespace, line breaks, scalar fields, inline markup),
and the failure mode has been identical every time: **the extraction is right and the probe is
narrower than the data, so the probe manufactures an absence.** `scripts/audit-coverage.mjs` now
normalises Markdown escapes and emphasis on both sides, and each clause carries the session that
forced it. After the fix: `a-new-dawn` 61/61, Zoo 79/79, Greener Partners 51/51.

## Findings

### 1. A stated short-term horizon is routed to `generalOutcomes` (reproduces 3/3)

A New Dawn's source has three explicitly labelled sections:

```
4. SHORT-TERM OUTCOMES (3–12 months)      -> generalOutcomes   (9 items)   WRONG
5. INTERMEDIATE OUTCOMES (1–2 years)      -> mediumTermOutcomes (7 items)  correct
6. LONG-TERM IMPACT (3–5 years)           -> longTermOutcomes  (11 items)  correct
```

`shortTermOutcomes` comes back **empty** while its two siblings populate correctly. Three runs on
an unchanged prompt give the identical split, so this is deterministic, not the instability the
census measures.

**Cause.** Rule 7 (`constants.ts:401`) carries a prohibition naming one field: *"Never default
undifferentiated outcomes into `shortTermOutcomes` just because it's the first outcomes-shaped
field in the schema"*. Its escape clause is written purely in column terms — *"Only use
`shortTermOutcomes`/`mediumTermOutcomes`/`longTermOutcomes` when the source itself actually
distinguishes those three (separate columns, or explicit per-item labels)"*. A New Dawn is prose:
no columns, no per-item labels, so the escape does not fire and the prohibition does. Medium and
long carry no equivalent prohibition, which is exactly why they route correctly. The asymmetry
inside one document is the evidence.

**Consequence, and it is not cosmetic.** The coding CSV writes these rows as `General Outcomes`,
which `services/codingExport.ts:21` defines as *"No time horizon in the source — a coder assigns
short/medium/long-term during coding."* The source says `(3–12 months)`. A coder is being asked to
supply a horizon the document already stated.

**UPDATE (session 23): two prompt fixes were built, measured and withdrawn.** Widening rule 7's
escape clause to name section headings was a no-op (the no-grid section already carried a working
escape, so that clause was never the binding constraint). Qualifying the prohibition itself —
"this forbids GUESSING a horizon, not USING one the source states" — was also a no-op. Six runs,
zero movement, controls unchanged throughout. The diagnosis below explains the asymmetry but does
not yield a wording fix; see friction log session 23. The finding stands, unfixed.

### 2. The first XLSX: 8 logic models merged into one, and 17 junk items

The Zoo workbook holds **eight complete logic models**, one per program (TOC overview, Wild
Connections, WPZS, Animal Tales, Animal Academy, Guided Tours, UNLESS, Programs), sharing a mission
and column headers but differing in inputs and activities. All eight are merged into a single
extraction; `program` comes back as "School and Community programs" while the file is named for one
of the eight.

`shared/documentBundleSlicing.ts` splits multi-logic-model uploads but matches `## Page N` and
`## Slide N` only, so `## Sheet:` bypasses it silently. Slicing also assumes page ranges and images,
and an XLSX has neither, so this needs its own mechanism and more than one spreadsheet to design
against. **Addressed by stating the fact rather than guessing**: the bundle now carries a warning
naming the sheet count and saying they were read as one document.

Separately, **17 of 77 items are bare numbers** (`33`, `43`, `44`, `77`…) in inputs, activities and
generalOutcomes. These are not inventions — they are real cells in the Activities column and in
otherwise-empty rows, almost certainly navigation anchors. The prompt has no rule for a
content-free cell, and `transcribe what you read` makes them items. Three of them reach the coding
CSV through `generalOutcomes`. Left alone deliberately: a bare number can be a legitimate output
value under a `# of participants` header, and one spreadsheet is not enough to design a rule that
will not do harm elsewhere.

The app did warn — `partial`/`medium`, with the honest blocker *"This document could not be read as
images, only as text, so the columns and formatting may be wrong"*. That is the text-only variant
from 2026-09-20.3 working on a real document for the first time.

## What the documents exercised

**Philadelphia Ballet — Let's Dance** is a 6-page narrative *Final Program Assessment Report*
covering three programs, correctly flagged `not_logic_model` / `prose_sections`. 23 of its 49 items
are not verbatim-findable because prose must be condensed — which is what the flag warns about.
Every specific was checked against the source: 23 of 26 names, school lists and counts matched
directly, and the remaining three resolved (`27 returning dancers, 50 first-year participants`
against *"27 dancers had been in HSCMP in at least one prior year; 50 dancers were first year
participants"*). One genuine nit: the source's `Kensington Creative and Performing Arts High
School` is abbreviated to `Kensington CAPA` — proper-noun abbreviation during summarisation.

**Educators of Colors 1865** is an organisational overview, correctly flagged, with an accurate
note. Its source paragraph genuinely begins `Is a group that advocates...` — a fragment whose
subject is the heading above it — and the extraction preserved it rather than repairing it. Contact
details, fax number and Zelle payment line were correctly left out.

**Greener Partners** is a clean 6-column grid, 48 for 48, with the same colour-strand encoding as
Lantern.

## Also observed

`mission` on Educators of Colors concatenates two non-adjacent source paragraphs, and its
`targetPopulation` is composed from spans across the document — the fifth and sixth instances of
the scalar-composition pattern recorded in `types.ts` (session 21, finding 2).
