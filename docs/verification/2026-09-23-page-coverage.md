# A second logic model on a later page, dropped without a word

**Date:** 2026-09-23 · **Prompt version:** 2026-09-20.6 (unchanged — nothing here touches the
prompt, the schema or the extraction call) · **Cost:** 26 Gemini extract calls

## The defect

DesignPhiladelphia's deck is three slides: a logic model grid, an impact statement, and a second,
differently worded grid of the same model. Page detection read it as one document, which by its own
rules is right — it splits only when a genuinely different organisation or programme appears, and
this is one programme twice.

Extraction then took the first grid. Reproduced on today's main, 2026-09-23: 39 items, every one of
them citing page 1, nothing from page 3, `extractionStatus: ok`, `extractionConfidence: high`,
`possiblyMissedRegions` absent. No banner, no flag in the file list, nothing in the
`extraction_blockers` column. A reviewer had no way to learn a second grid existed.

That is not a prompt failure and it is not really an extraction failure either — it is a *reporting*
failure. The app's only missed-content signal was Gemini's own `possiblyMissedRegions` self-report,
and a self-report cannot flag what the model never noticed it dropped.

## The deck does not behave the same way twice

Five runs against a byte-identical bundle, same prompt version, temperature 0, content-derived seed:

| Runs | Items | Where they came from |
|---|---|---|
| 3 of 5 | 39 | page 1 only |
| 2 of 5 | 51 | 39 from page 1, 12 from page 3 |

Gemini's own self-report is no steadier: it raised `possiblyMissedRegions` on two of the five runs
and stayed silent on three, including the run that dropped the most.

This matters for the launch gate. Same items in the same columns is the bar, and this document does
not clear it — not because of grouping, the axis every earlier instability sat on, but because 12
items appear or vanish. It is the first document measured where the count itself moves. It was not
in the set of 14 re-measured on 2026-09-23, so this is new ground rather than a regression.

## The check

`shared/pageCoverage.ts`, run inside the existing fidelity rollup. For each page of Track A that
structurally looks like a logic model grid, it asks whether that page's own wording came back in the
extraction. No Gemini call, no new sampling point, nothing the model chooses — so it cannot move the
gate above. It changes no item, no column and no group: it adds a warning and caps `ok`/`high` at
`partial`/`medium`, the same ceiling every other non-severe signal already has.

Two things keep it precise, and both were chosen from the measurement rather than from principle:

1. **A page is only examined when it holds a grid** — three distinct canonical column names, at
   least one structure column and at least one results column. The vocabulary is `synonymToDomain`,
   the same list source-aware mapping uses. Without this gate the two genuinely unextracted non-grid
   pages in the set — a colour legend at 0.058 recall and a cover page at 0.017 — would both have
   been false positives, and both were legitimately not extracted. This is the lesson of the
   line-counting heuristic removed in session 20 after going 3 for 3 on false positives: most page
   text is not meant to become grid items.

2. **Only the page's own n-grams count** — the ones no other page of the document carries. Two
   versions of one logic model share most of their wording, so a page discarded outright still
   scores 0.386 against the whole extraction, purely on what its twin contributed. Difference the
   pages first and it scores 0.009. It also catches the partial runs, which score 0.682 undifferenced
   (silent) and 0.520 differenced (flagged) — the honest answer, since two thirds of that page never
   arrived. On a document with one grid nothing changes; a lone grid page has no twin to share with.

Character n-grams, not word n-grams: LibreOffice's PPTX text layer splits kerned runs mid-word,
which shifts every word boundary around it and cost word-trigram recall about ten points on pages
that were extracted perfectly.

## What it was measured against

All 21 source documents available on 2026-09-23 — 7 PowerPoint decks, 7 PDFs, 3 Word files, 3
images, 1 spreadsheet — captured from source and extracted on today's code. Word, image and
spreadsheet uploads have no page markers in Track A, so the check no-ops on all seven of them by
construction. Sixteen pages across the rest satisfied the grid gate.

| | Own-wording recall |
|---|---|
| 15 intact grid pages | 0.780 – 0.992 |
| **DesignPhiladelphia page 3**, 3 runs that dropped it | **0.009** |
| **DesignPhiladelphia page 3**, 2 runs that took a third of it | **0.520** |

Nothing lands between 0.520 and 0.780. The threshold is 0.55, in the middle of that gap.

**Result: 1 of 21 documents flagged, and it is the one with the dropped grid. The other 20 come out
byte-identical in status, confidence and blockers.** All five runs of the deck are flagged, the two
partial ones included.

## What it deliberately does not do

It does not split the document, re-extract the page, or decide which version of a duplicated logic
model is the right one. Which of two versions a partner meant is a human call, and guessing it
silently is the same class of mistake as dropping one silently. The page is named; the reviewer
opens it.

It also does not write to `possiblyMissedRegions`. That field is documented as Gemini's own
per-image self-report, and a client-side heuristic was removed from it once already. Mixing a
code-side measurement back in would leave nobody able to tell which signal said what, which is
exactly the confusion this check exists to end.

## Still open on this document

The instability above is untouched. The check makes the drop visible every run, which is what was
asked for, but the deck still returns 39 items on some runs and 51 on others. If the goal is that it
returns the same thing every time, that is a separate piece of work and it needs a decision first:
what *should* a document holding two versions of one logic model produce?
