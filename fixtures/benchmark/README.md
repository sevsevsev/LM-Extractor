# Accuracy benchmark

Seven invented logic-model documents whose correct extraction is known by construction, and a
scorer that turns an extraction into four numbers.

## Why this exists beside the regression set

`fixtures/regression-set/` answers **"did anything change?"** — it diffs today's output against a
snapshot blessed on some past day. `npm run census` answers the same question a different way, by
comparing two runs with each other. Neither can answer **"is it right?"**, because a snapshot is
whatever the pipeline happened to emit when someone accepted it. Reproducible-and-wrong is the one
failure that loop cannot see, and this set is the answer to it: the expected answer comes from the
document's own source spec, never from a previous run, so a number moving means accuracy moved.

The only accuracy measurement this project had before was a person reading 678 items against page
images (`docs/verification/2026-09-23-accuracy-audit.md`). That is the better instrument on real
documents and it should stay the instrument of record for them — but it cannot run on every change.

## The documents are invented, and that is load-bearing

Every real logic model in this project is a client file naming a real organisation and must never
enter the repository. So the organisations, programmes and items here are fictional, written for
this benchmark. Two things follow. The benchmark is shareable: anyone with a clone and a key can
run it. And the raw Gemini answers to these documents are committable too, which is what makes
`fixtures/normalize/` possible.

`shared/benchmarkDocuments.test.ts` fails if a known partner name appears in any spec.

## One source, two artefacts

`documents/<id>.json` declares what is printed: slides, column headings, and the items under each
heading. Both the .pptx the benchmark extracts from and the expected answer are generated from it,
so they cannot drift, and the expectation is never transcribed by hand.

Everything else here is build output and gitignored — `decks/`, `bundles/`, `extractions/`, `runs/`.

## Running it

```bash
npm run dev                              # API and app up, GEMINI_API_KEY set
npm run benchmark:accuracy -- --capture  # regenerate decks, capture bundles (Playwright), score
npm run benchmark:accuracy               # score again from the captured bundles (one call each)
npm run benchmark:accuracy -- --replay   # re-score the saved answers, zero calls
npm run benchmark:accuracy -- --passes=3 # report whether the SCORE moves between runs
```

## The four numbers

| | |
|---|---|
| **recall** | expected items found anywhere in the extraction. Below 1 = content lost. |
| **precision** | extracted grid items matching something expected. Below 1 = surplus text. |
| **placement** | found items sitting in their expected column. Below 1 = items moved. |
| **unsourced** | extracted items whose wording is not findable in the source. A "look at the page image" cue, not proof of invention. |

Items in `unmapped` are excluded from precision: parking content there is the correct conservative
move, and penalising it would push the extractor toward forcing content into a column, which is
the behaviour this benchmark exists to catch. They still count toward `unsourced`.

Group names are not scored at all. Grouping is the axis measured as unstable without items moving,
and the launch gate is "same items in same columns", so scoring group names would fail documents
the gate passes.

## What it cannot tell you

The documents are as hard as they were written to be and no harder. A perfect score is evidence
that a change did not break the failure modes in the set — the ones this project has actually
shipped bugs against — and is not evidence about a partner's real document.

Deliberately **not** in the set: a three-level-nested document. The two-level schema cannot
represent one, so its correct answer is undecided policy rather than fact, and a benchmark must not
pretend to score an open question.
