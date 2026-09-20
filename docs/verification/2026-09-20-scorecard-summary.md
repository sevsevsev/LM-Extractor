# Extraction verification — first run of `extraction-verification-protocol-v1.md`

**Date:** 2026-09-20 · **Reviewer:** agent session (`claude/loving-hawking-r436g3`) ·
**Prompt version:** 2026-09-20.1 · **Extraction arm:** session 7 run C1 (C2 where noted)

The protocol had never been run. This is the project's first measured accuracy figure — before
this, every number in `friction-log.md` described whether output *changed*, never whether it was
*right*.

## Method note — read before trusting the numbers

This is a **mechanical** review, not the human read the protocol describes. Source structure was
reconstructed from PDF text coordinates (`x`/`y` per glyph run) and PPTX shape XML, then compared
to the extraction by normalised string matching. That makes **non-invention** (Pass 2) genuinely
rigorous — every extracted item is checked for existence in the raw source text. It makes
**completeness** (Pass 1) only as good as the column parser, which is the weak link: see below.

Three of my own checker's findings turned out to be checker bugs, each confirmed by hand:

| Apparent finding | Reality |
|---|---|
| 4 Core Reporter Long-Term items "not in source" | My column parser skipped the Long-Term column (it has no bullet markers). All 4 present. |
| 2 Cub Reporter Activities items "not in source" | Colon-folded items (`parent: child`); my prefix-stripper only handled `—`. Both correct foldings. |
| PG "Implementation of FLC Dance & Youth Moves…" not in source | XML entity bug — `&amp;` normalised to `amp`. Present in source. |

Treat any *future* automated finding here as a checker bug until proven otherwise.

## Results

| Document | Variant | Items | Pass 2 — non-invention | Pass 1 — completeness |
|---|---|---|---|---|
| HNW Core Reporter | vision+text | 45 | **45/45 (100%)** | **42/42 grid bullets (100%)** |
| HNW Cub Reporter | vision+text | 113 | **113/113 (100%)** | not measurable — see below |
| Performance Garage | text-only | 46 (C1) / 47 (C2) | **46/46, 47/47 (100%)** | ~45 source paragraphs; see below |

**Invention rate: 0 / 204 items across three documents.** That is the headline, and it is a good
number — the failure mode that motivated most of `constants.ts` (Oxford Circle's
"Joseph J. Peter Institute" → "St. Christopher's, Peter's Place") did not occur once here.

Core Reporter is **clean on every dimension**: 42/42 source bullets present, correct domain,
correct group, exact text, and the Outputs column's three-level nesting rendered in the canonical
form rules 7-9 specify. Per the protocol's own guidance this is a golden-set fixture candidate.

## What this does NOT establish

- **Completeness is not measured.** My Cub Reporter parser reported 94%, but hand-checking the
  15 flagged items showed the great majority were parser artifacts (short strings like "Writing"
  matching loosely; text merged across column boundaries; genuinely duplicated source strings).
  The real figure is higher and unknown. Completeness is the dimension a human reader is actually
  needed for — you cannot find what was never extracted by comparing two extractions, and my
  parser is a worse reader than a person.
- **One real placement error**, Performance Garage run C2: the slide-2 overview prose
  ("The Performance Garage's YouthMoves Program provides student-dancers with…") was filed as an
  Inputs/Financial item. Present in source, wrong domain. Not present in C1.
- **n = 3 documents, 2 vision + 1 text-only.** The protocol's minimum, not a corpus rate.
- Nothing about `+lowleg` or `vision-only`, where the known failures live.

## Faithfulness detail worth keeping

Cub Reporter's Community Partners item reads "Schools, businesses, nonprofits, and schools" — the
duplication is **in the source document**. The model transcribed it rather than tidying it, which
is the LOW-RESOLUTION block's "never repair odd-looking wording" rule behaving correctly on a
document that never triggered that block.

## Next

1. A human Pass 1 on these same three documents would convert the one soft number here into a
   real completeness rate. That is the single highest-value hour available to this project.
2. Core Reporter → golden-set fixture (`expected-domains.json`), per the protocol.
3. Extend to a `+lowleg` document once one with a real bundle exists (`art-thru-youth`).

---

# Addendum — visual audit (same day, method changed)

The section above said completeness "needs a human reader" and that my parser "is a worse reader
than a person". The owner pushed back: *"Are you truly not capable of replicating the human review
that you are asking for?"* Largely, no — that was over-deferral, and it conflated two different
things.

The MECHANICAL PARSER is weak: it produced three false findings above. But reading the document
directly is a different method, and it works. The page images are inside the bundles; written out
and read, they support an item-by-item audit of exactly what the model saw.

## Method

For each document: extract the bundle's own page images, read them, enumerate every leaf item by
column, then compare against the extraction one item at a time. No string matching, no parser.

## Results

| Document | Variant | Source items | Found | Invented | Placement |
|---|---|---|---|---|---|
| SEAMAAC — Urban Arts | vision+text | 33 | **33/33** | **0** | all correct |
| Oxford Circle — Carnell FRC | vision+text | 44 | **44/44** | **0** | all correct |
| HNW Core Reporter | vision+text | 42 | **42/42** (mechanical) | **0** | all correct |

**Completeness: 119 of 119 source items across three documents.** That is the protocol's stated
minimum for drawing a conclusion, and it is the first completeness figure this project has had.

## The two historical fabrications are fixed, and verifiable

Oxford Circle is the document that motivated most of `constants.ts`. Both original failures are
gone, checked against the page image:

| Failure | Session | Now |
|---|---|---|
| "(Joseph J. Peter Institute)" became "(St. Christopher's, Peter's Place)" | 2 | exact |
| "Arts & crafts supplies" became "Therapy curriculum" | 3 | exact |

A third, unplanned check: the Activities box reading "Referrals to Trauma-focused Cognitive
Behavioral Therapy (TF-CBT) for students of all" is visibly TRUNCATED in the source — the phrase
stops mid-sentence. The extraction preserved the truncation rather than completing it to
"...of all grade bands". That is the never-repair rule working on a real clipped box.

Colour is captured per box and genuinely informative: Oxford's yellow/orange/purple/coral track
resources / student-focused / family-focused / school-focused, and SEAMAAC's blue vs teal
distinguish two otherwise-identical "Number of students served" rows belonging to different
program strands.

## What is still weaker than a human doing this

Not capability — **correlated error**. I am the same class of system that produced the extraction,
so content missed because it is visually subtle could be missed twice, and my "nothing is missing"
is worth less than yours would be. That risk scales with how degraded the source is: on these
three, the images are crisp and the type is large, so it is low. On a 1024px dense grid like
art-thru-youth it would be materially higher, and a human should check that one.

The honest summary is that this is strong evidence, not proof — and "weaker than a human" was a
bad reason to keep having no measurement at all.

## Remaining

- Cub Reporter (113 items, four levels deep) and Performance Garage (text-only) are audited for
  invention but not completeness.
- A random sample is still what is needed for a RATE; these three are from a set chosen to
  over-weight hard cases, so 119/119 is not a corpus figure.
