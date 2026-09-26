# Splitting run-on cells — what was measured

2026-09-26. Closes the half of the 2026-09-22 ask that was held back when
`shared/inlineLabelGroups.ts` shipped: a source that writes several statements into one cell.

## The obstacle, and what changed about it

The proposal was parked because no single separator works — within one source column the lists are
separated by semicolons, by full stops, and by bare commas — and because the only measurable
option (semicolons, three or more parts) fired once across the ten snapshots that existed then,
leaving sentence-separated columns untouched and granularity inconsistent within one document.

The blessed set is now seventeen documents and 712 items, and it does contain sentence boundaries:
two genuine two-statement cells, and two that only look like one. Those two are the whole hazard
class, and they are what the guards below were built against:

- a personal initial inside a bracketed attribution (`… (Name X. Surname Institute)`), where a
  split would also cut a parenthetical in half;
- an abbreviation at the head of a cell (`Avg. …`).

So sentence splitting is measurable now in a way it was not on 2026-09-22.

## The rule

`shared/listItemSplit.ts`, run inside `normalizeExtractedLogicModel` after the inline-label
promoter and before source-aware mapping. Per cell, in strict precedence:

1. **Semicolons**, when the cell yields three or more parts. One semicolon usually joins a clause
   to its qualifier rather than separating entries, and the blessed set bears that out: of its four
   semicolon cells, the one with three parts is a list and two of the three with one are not.
2. **Sentence boundaries**, when the cell yields two or more sentences. A full stop is only a
   sentence end when the token before it is neither a single-letter initial nor a known
   abbreviation.
3. **Nothing else.**

Guards applied to every candidate part: at least two words (four, for a sentence part), no part
over 200 characters, balanced brackets and quotes, and — for a semicolon list — no part that is
itself several sentences. A cell under 60 characters, or one containing a colon, is not a
candidate at all: the colon case belongs to the inline-label promoter, and splitting a labelled
cell would scatter its list across rows that no longer say what they belong to.

**Bare commas are never split on.** `increased artistic skills, physical activity levels, and
improved goal-setting` is one statement written as a list, and no syntactic test separates it from
`demographics, attendance, retention`, which is three. The distinction is semantic, so a comma rule
is a coin flip on every cell. Leaving a coarse cell whole is a cost a reviewer can see and fix;
shredding a sentence into fragments is a cost they have to notice first.

Nothing here is a prompt rule. A separator chosen per cell by the model is a fresh decision on
every run, and granularity is the axis this project's reproducibility problem already lives on.
Every part is a substring of what Gemini transcribed, minus a terminal full stop, so no text is
invented and no item can move between columns by this pass alone.

## Measured over the blessed set

Every item of all seventeen committed snapshots, run through `splitRunOnCell`:

```
712 items, 3 cells split into 7 (net +4), 2/17 documents touched
```

All three are correct, and both hazard cells are left whole. The item-by-item list is not
reproduced here — the snapshots hold real client wording — but any clone can print it:

```
npm run split:survey             # every cell the rule touches, and what it becomes
npm run replay -- --score        # the pipeline consequence, offline and free
```

## Measured end to end

A new benchmark document, `fixtures/benchmark/documents/run-on-cells.json`, prints thirteen cells:
four run-on (two semicolon lists, two two-sentence cells) and nine that must survive whole,
including the comma list, the abbreviation and the bracketed initial. Captured through the real
app on prompt 2026-09-20.6:

- Gemini returned **all thirteen cells whole** — it did not split any of them itself.
- With the splitter: **recall 100%, precision 100%, placement 100%, 19/19 items.**
- Without it, the same extraction scores **68.4% recall** (asserted in
  `shared/benchmarkDocuments.test.ts`).

This is the first document in the benchmark that a correct-but-coarse pipeline gets wrong, so the
benchmark can now show an improvement and not only a regression. The raw answer is committed at
`fixtures/normalize/raw/run-on-cells.json`, so the whole thing replays in CI with no key.

The other seven benchmark documents and all seventeen snapshots are otherwise untouched:
`npm run replay` reports all eight unchanged, and the three splits above are the only differences
the rule makes anywhere in the repository.

## Also in this change: baselines are no longer blessed on sight

`npm run regression:check` with no `--only` used to write a baseline for any document that had a
bundle but no snapshot, and count it as a pass. That makes an unread run the thing every later run
is measured against, which is the one way this harness can launder a defect into its own reference.
A first capture is now reported and the run exits 1 until a person accepts it with
`--only=<id> --update`. `npm run replay` had the same hole and got the same fix (`--bless`).

## Retire or revise if

A document appears where a split part reads as a fragment rather than a statement, or where a
reviewer has to rejoin two rows by hand.
