# Extraction verification protocol (v1)

Status: **Active — use starting now**
Owner: `@product` (this doc), reviewers: any colleague with the source document in hand
Related: `friction-log-template.md` (general UX friction — different purpose, see below), `structure-aware-extract.md`, `extraction-confidence-v1.md`, `source-aware-mapping-v1.md`

## What this is (and isn't)

This checks one thing only: **did the extraction correctly capture what's actually in the source document** — every item present, nothing invented, everything in the right domain and group. It does not touch whether the logic model itself is well-written (`overallQuality`), whether the causal chain holds together, or any other qualitative judgment. Ignore those entirely while doing this review — rating the *program's* logic is a separate, later concern, and mixing the two muddies what you're actually testing.

This is also **not** the same thing as `friction-log-template.md`. The friction log captures UX pain (confusing buttons, slow waits, unclear errors) during normal use. This protocol is a deliberate, structured accuracy check against the source document — slower, more tedious, and only needs to happen on a handful of documents to be useful.

There are two separate reliability questions in this app, and this protocol only answers one of them:

1. **Does the CSV export faithfully preserve what the model produced?** (Pipeline correctness.) This is now covered by an automated test (`shared/exportRoundtrip.test.ts`) — deterministic, runs in CI, no human needed, no Gemini call involved.
2. **Did the model correctly read the source document in the first place?** (Extraction accuracy.) This can only be checked by a human comparing the output against the real document. **This protocol is entirely about #2.**

## What "100% correct" means here

Three distinct failure modes, checked separately — a document can fail one and pass the others:

| Dimension | Question | Failure example |
|---|---|---|
| **Completeness** | Does everything visible in the source appear *somewhere* in the extraction? | A bullet under "Outputs" in the source never shows up anywhere in the CSV. |
| **Non-invention** | Does everything in the extraction actually exist in the source? | The CSV has an item that isn't anywhere in the document. |
| **Placement** | Is each item in the right domain *and* the right group/sub-heading? | An outcome-sounding bullet from the "Short-Term" column ends up filed under Outputs; or a "Financial Resources" item ends up under the wrong sub-bucket within Inputs. |

A fourth, lighter check:

| **Text fidelity** | Does the transcribed text actually match the source wording (not paraphrased, not altered, no wrong numbers/names)? | Item says "increase by 25%" but the source says "increase by 20%." |

## What you need

- The original source file as uploaded (PDF/DOCX/PPTX) — open it in whatever you normally use.
- **Either** the app's Full CSV export for that one file, **or** the app itself open to that file's board view with the source-preview pane open ("Show source") — the board shows the same domain/group placement the CSV does, and the source pane can jump to the page the model claims each item came from (`sourcePage`). Use whichever is easier for you; the CSV is more portable if you're working outside the app.
- The scorecard templates: `extraction-verification-scorecard-template.csv` (per-item checks) and `extraction-verification-missed-items-template.csv` (things the extraction left out entirely).

## Procedure

Do this **one source document at a time.** Two passes — do them in this order, they catch different things.

### Pass 1 — Completeness (read the source, not the CSV)

Go through the **source document** domain by domain (column by column, or section by section) as a human would read it — ignore the CSV for this pass. For every distinct bullet/idea you see in the source:

1. Search the CSV (or the board) for that text.
2. If you find it — move on, it'll get checked in Pass 2.
3. If you **don't** find it anywhere — log it in the missed-items sheet: which domain it should be in (as labeled in the source), the text, and a short note if anything about it seems ambiguous.

This pass is the only way to catch omissions — you can't find what's missing by only looking at what's there.

### Pass 2 — Precision, placement, and text fidelity (row by row)

Now go through the **CSV row by row** (or item by item on the board) for this document, and for each row fill in the scorecard columns:

- **Present in source (Y/N):** Can you actually find this text/idea in the source document? If no — this is an invented item. Mark N and note where you looked.
- **Correct domain (Y/N):** Is it filed under the right top-level domain (Inputs/Activities/Outputs/Short-Term/Medium-Term/Long-Term/Impact)? Check the column header (or section label) directly above/around it in the source.
- **Correct group (Y/N):** Within that domain, is it under the right sub-heading (e.g. the right Resources bucket, the right named track)? Only applicable when the source actually has sub-headings — if everything in that domain uses one generic group, mark Y trivially.
- **Text accurate (Y/N/Partial):** Does the transcribed text match the source? Minor formatting differences (a straight vs. curly quote, trailing punctuation) don't count as errors — meaningfully different wording, a wrong number, a wrong name, or a flipped direction word (increase vs. decrease) does. Mark **Partial** for a close-but-imperfect paraphrase that preserves the meaning.
- **Notes:** anything worth flagging — what it *should* have said, source page number, anything ambiguous.

**A note on `verbatim: false` / `Needs Review` rows:** the model already flagged these as uncertain — that's the model being honest, not automatically an error. Give these extra scrutiny in Pass 2, but only mark **Text accurate: N** if the actual transcription is wrong, not merely because it was flagged.

### After both passes: fill in the document summary

At the top of your scorecard for this document, record:

- Total items in source (your Pass-1 count of everything you identified while reading)
- Total items extracted (row count in the CSV for this file)
- Missed items (from the missed-items sheet)
- Invented items (Present in source = N)
- Misplaced items (Correct domain = N or Correct group = N)
- Text errors (Text accurate = N, not counting Partial)

## How many documents, how thorough

Do **full** Pass 1 + Pass 2 (every item, not a sample) on **at least 3 documents** before anyone draws a conclusion about how trustworthy extraction is — a single document's result is an anecdote, not a rate. If you want to review more documents but don't have time for full coverage on all of them, a lighter option is: full Pass 1 (completeness) always, but for Pass 2 spot-check 2 domains fully and sample the rest — note on the scorecard that it was a partial review so it doesn't get miscounted as full coverage later.

## What happens with the results

- **A document that comes back clean** (zero misses, zero inventions, zero misplacements) is a strong candidate to become a new golden-set fixture — the same pattern already used for `fixtures/oxford-circle-carnell-frc/` and `fixtures/performance-garage-youthmoves/` (`expected-domains.json`). That turns a one-time human check into a permanent, automated regression test.
- **Recurring error patterns** (the same kind of mistake across multiple documents/reviewers) are exactly the evidence the extraction prompt (`constants.ts`) has historically been tuned from — feed them back the same way past real-doc friction has (see the "Known failure modes" section of the extraction prompt for the kind of pattern language that's useful here).
- Aggregate results across documents/reviewers into simple rates: miss rate = missed / (items in source); invention rate = invented / total extracted; misplacement rate = misplaced / total extracted. These rates, not any single document's outcome, are what should actually change anyone's confidence in extraction quality.

## Explicitly out of scope for this protocol

- Whether you agree with `overallQuality` (Strong/Adequate/Weak) or the causal-chain critique's judgments — that's a different, later review.
- Colour/provenance metadata accuracy (`fillColor`, `sourceNote` wording quality) — nice to note if something's obviously wrong, but not the point of this pass.
- Anything about the app's UI/UX — use the friction log for that.
