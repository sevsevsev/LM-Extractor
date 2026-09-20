# Friction log — real-doc validation (running)

Populated log. Template: [`friction-log-template.md`](./friction-log-template.md).
Cause tags: `prompt` | `ui` | `setup` | `doc-quality` | `export` | `other`

---

## Session 1

```
Date:                     2026-07-30
Operator:                 owner
File name:                Oxford Circle CCDA Logic Model submission.pdf
Format:                   PDF (2 pages)
Approx pages/slides:      2
Host mode:                npm run dev :3000

--- Quality (1–5) ---
Extraction fidelity:      1  (fabrication + miscategorization + OCR errors)
Critique usefulness:      3
Overall "would use again": 3

--- What happened ---
Stage that hurt most:     extract
Expected:                 Faithful transcription; Resources buckets stay in Resources; other columns "General".
Got:                      Resources sub-headings copied into other columns and mutated; fabricated
                          "St. Christopher's Hospital" and "classroom-based Behavioral Therapy Specialists";
                          reversed outcome ("reduction in trauma-related behaviors" → "prosocial behaviors");
                          OCR errors ("grade bands" → "green bands", "donation" → "practicum");
                          dropped "Language Line"; ignored (unlabeled) colour coding and clipped TF-CBT box.
Error text (verbatim):    n/a (no error — silent low-fidelity extraction)
Workaround used:          none

--- Root causes ---
#1 Prompt told the model colour-coded rows count as tracks; "General" framed as last resort. | cause: prompt
#2 Page 2 is a flattened raster (no text layer) rendered whole-page at scale 2.5 with ~45% margin
   → ~8 px body text; tier degradation was size-based and silent.                              | cause: doc-quality + prompt
#3 Schema had nowhere to record colour (a real cross-cutting axis, meaning unlabeled) or transcription uncertainty. | cause: export/prompt

--- Notes ---
Would you stop using the tool over this? Not stop, but this class of error is high-severity for coding.
Fix shipped: docs/specs/extraction-provenance-and-color.md. Regression fixture:
fixtures/oxford-circle-carnell-frc/.
```

---

## Session 2

```
Date:                     2026-07-30
Operator:                 owner
File name:                Oxford Circle CCDA - Carnell FRC_SDP_Branded(1).pdf (export) vs source submission.pdf
Format:                   PDF (re-run on post-fix / deployed build)
Approx pages/slides:      2
Host mode:                hosted (Vercel) — re-extract after provenance/colour/raster fix

--- Quality (1–5) ---
Extraction fidelity:      3  (structure fixed; residual raster-OCR misreads remain)
Critique usefulness:      3
Overall "would use again": 4

--- What happened ---
Stage that hurt most:     extract (OCR fidelity on flattened raster, page 2)
Expected:                 Faithful transcription of every box on the page-2 grid.
Fixed vs session 1:       Resources sub-headings NO LONGER copied into other columns (grouping gate works);
                          "green bands" → "grade bands"; "Language Line" restored; "practicum" → "Grant donation".
Still wrong:              #A Fabricated proper noun — source "Part-time Therapist (Joseph J. Peter Institute)"
                             rendered as "(St. Christopher's, Peter's Place)" (invented, familiar-name swap).
                          #B Garbled/split — "4-6 Parent Cafe Facilitators (Catholic Community Services)" became
                             "4-6 Parent Leaders" + "Facilitators for Family Community Services".
                          #C Reversed direction — "Sustained reduction in trauma-related behaviors" →
                             "Sustained use of trauma-related behaviors".
                          #D Misread scope — "SEL focus groups for referred students of all grade bands" →
                             "…for targeted students in K-2 grade bands".
                          None of the above were flagged verbatim:false — they read as confident.
Error text (verbatim):    n/a (silent low-fidelity extraction)
Workaround used:          none

--- Root causes ---
#1 Page 2 is a single flattened raster; even at IMAGE_DOMINANT_SCALE small glyphs stay marginal, so the
   model confidently substitutes plausible tokens (esp. proper nouns / direction words).   | cause: doc-quality + prompt
#2 Prompt lacked an explicit "never auto-complete proper nouns/numbers from memory" and
   "never flip polarity/scope words" rule, so confident substitutions went unflagged.       | cause: prompt

--- Fix shipped (this session) ---
- constants.ts: EXTRACTION RULES 4 (proper nouns/numbers → verbatim:false, never swap familiar names) and
  5 (never flip direction/polarity words); two matching KNOWN FAILURE MODES bullets.
- fileService.ts: IMAGE_DOMINANT_SCALE 3.2 → 3.6, MAX_SCALE 4.0 → 4.5, LEGIBILITY_FLOOR_PX 1000 → 1150.

--- Notes ---
Would you stop using the tool over this? No — output is now usable with review; residual errors are the
kind the needs-review flag is meant to catch, hence the prompt push toward verbatim:false on risky tokens.
```

---

## Session 3

```
Date:                     2026-07-30
Operator:                 owner
File name:                Oxford Circle CCDA Logic Model submission.pdf + logic_models_granular CSV
Format:                   PDF source vs granular CSV export (best review pairing — see note below)
Host mode:                hosted (Vercel), post session-2 fix
Method:                   CSV diffed against source rendered at scale 4.5 and cropped per column.

--- Quality (1–5) ---
Extraction fidelity:      2  (structure right, Resources column largely wrong)
Critique usefulness:      3
Overall "would use again": 3

--- What happened ---
Stage that hurt most:     extract (small-print transcription + colour capture)
Session-2 fixes CONFIRMED working:
                          "Sustained use of" → "Sustained reduction of" (polarity rule works);
                          "targeted students in K-2" → "referred students of all grade bands";
                          "Family Community Services" → "Catholic Community Services";
                          grouping still correct (Resources buckets only in Inputs, rest "General");
                          clipped TF-CBT box flagged Needs Review = Yes.
Still wrong (source → CSV):
                          "(Joseph J. Peter Institute)" → "(St. Christopher's, Peter's Place)"  [persistent fabrication]
                          "Shared classroom-sized space" → "Space: classroom-based, Mother's Room, FRC"
                          "Modified Second Step SEL curriculum" → "SEL curriculum"
                          "Arts & crafts supplies" → "Therapy curriculum"
                          "School Bilingual Counseling Assistants" → "Bilingual Interpreting Assistants"
                          "1-year donation" → "Grant duration"
                          "Master-level Social Workers on staff" → "Master-level SEL Educators"
                          "Multi-lingual staff" → "Bilingual staff"
                          "4-6 Parent Cafe Facilitators" → "4-6 Parent Group Facilitators"
                          "how they present themselves" → "how to regulate themselves"
                          "problem-solving steps" → "problem-solving"
Colour capture WRONG:     Source varies colour box-by-box within a column (orange = student-focused,
                          purple = family-focused, yellow = all Resources). CSV recorded ONE colour per
                          column: Activities all "blue" (actually purple/orange), Resources blank
                          (actually yellow), all outcomes "orange". The cross-cutting axis was lost.
Flagging under-fires:     Needs Review = Yes on 1 of 45 rows despite ~11 misreads; Source Note empty.
Error text (verbatim):    n/a (silent low-fidelity extraction)

--- Root causes ---
#1 Page 2's embedded raster is ~1211 px wide (~142 DPI). Rendering above native resolution interpolates
   and recovers no detail, so scale bumps alone cannot fix the Resources column.   | cause: doc-quality
#2 verbatim/sourceNote were left to model discretion; it rewrites small print fluently
   and reports confidence.                                                          | cause: prompt
#3 Nothing told the model colour is per-box; it inferred a column-level colour.     | cause: prompt

--- Fix shipped (this session) ---
- constants.ts: new low-legibility prompt block (renderer-triggered) that makes verbatim:false the
  DEFAULT for proper nouns/numbers/durations; per-box colour rule + uniform-column self-check;
  two new failure-mode bullets (colour stamping, fluent rewrites of small text).
- fileService.ts: PdfConversionResult gains `lowLegibility`; tall column tiles are split into up to 3
  overlapping vertical bands (MAX_TILE_ASPECT) so the densest column gets more attention.
- lowLegibility threaded App.tsx → geminiService → apiCore → geminiLogicModel → prompt.
- Fixture updated with the 11 verified source strings + 14 forbidden fabrications.

--- Notes ---
Best review pairing: **source PDF + granular CSV**. This session found ~11 discrepancies quickly;
the session-2 branded-PDF comparison found 4 and took longer (branded PDF is monochrome and
carries no provenance). Reserve the branded PDF for layout/print bugs only.
Open question: at ~142 DPI the Resources bullets may be beyond reliable OCR — if flagging still
under-fires, next lever is native embedded-image extraction (no re-compression) or per-box tiling.
```

---

## Session 4 — first instrumented batch (17 documents)

```
Date:                     2026-09-19
Operator:                 owner
Files:                    17-document batch (11 PDF, 4 DOCX, 2 PPTX)
Prompt version:           2026-09-19.2 (all 17 — first run with prompt_version / prompt_variant)
Host mode:                npm run dev
Method:                   extraction-log CSV + granular CSV analysed together; no source documents
                          pulled yet, so this is a signal census, not an accuracy measurement.

--- Outcome ---
qa_status:                13 Successfully Processed / 4 Needs Review
extraction_status:        13 ok / 4 partial          confidence: 13 high / 4 medium
Items:                    685 grid items (+33 overview rows) across 17 documents

--- Finding 1: item-level flagging produced nothing at all ---
Needs Review (verbatim:false)   0 / 718 rows
Source Note                     0 / 718 rows
possibly_missed_regions         0 / 17 documents
fillColor / borderColor / legend 0 / 718 rows

All four `partial/medium` documents were flagged by DOCUMENT-level signals only — two text-only
fallbacks, two `not_logic_model`. Not one document was flagged because of anything about an item.

This is friction-log session 3's "flagging under-fires" measured at batch scale: session 3 was
1-of-45, this is 0-of-718. Note which rules were actually in play: the batch contains ZERO
`+lowleg` documents, so the LOW-RESOLUTION procedure block — the one rule shape that has
demonstrably worked — never fired. The only rules asking for `verbatim:false` here were
EXTRACTION RULES 3/4/5, which are written as prohibitions. They produced nothing on 718 items.
                                                                              | cause: prompt

--- Finding 2: the batch tested two of six prompt variants ---
vision+text 15 · text-only 2 · vision-only 0 · +lowleg 0

The two untested variants are exactly where the known failures live (Oxford Circle-class rasters,
image-only PDFs). Aggregate rates from this batch say nothing about them.        | cause: other

--- Finding 3: 100% PPTX vision-conversion failure ---
Both PPTX files fell back to text-only (pages_processed blank, conversion warning on both). Any
PPTX tuning done against this batch is accidentally tuning the text-only variant. Pipeline issue,
not a prompt issue — LibreOffice->PDF path, and the browser-WASM fallback structurally cannot work
(codebase audit #16).                                                            | cause: setup

--- Finding 4: candidate extraction errors visible without the sources ---
#A 7_31 Healthy NewsWorks Cub Reporter — 116 rows vs 49 for its sibling 7_30 Core Reporter;
   `program` came back "Core Reporters & Cub Reporters" (not the filename's program); groups
   `Core Reporters` AND `Cub Reporters` each span four outcome domains; no Impact Statement and no
   Mission while the sibling has both. Either the document genuinely covers two programs (in which
   case detection arguably should have split it) or content bled.
#B Cross-column read-across, same file: identical text in two time horizons —
   "students will demonstrate improvements in/increased: health knowledge" and
   "improved community-wide healthy behaviors" both in Medium-Term AND Long-Term;
   "annual updates" in both Inputs and Activities. COLUMN FIDELITY rule 2 violation; both copies
   would ship to the coding CSV as distinct outcomes.
#C Within-domain duplicates surviving `pushItem` dedupe (so, different groups): "sopa staff" x2,
   "avg student gains" x2, "number of students served" x2, "quantitative and qualitative
   evaluation" x2. Could be legitimate or double-counting across column tiles — needs the source.

--- What this batch does NOT tell us ---
Completeness. CSVs cannot show what was never extracted; that needs Pass 1 of
`extraction-verification-protocol-v1.md` by eye on a handful of documents. Do not read the
"13 Successfully Processed" as evidence that nothing was missed.

--- Actions taken (this session) ---
- server/geminiSeed.ts: seed now keys on DOCUMENT CONTENT ONLY, never the prompt. The prompt used
  to be in the hash, so every PROMPT_VERSION bump also moved the seed and an A/B between prompt
  versions mixed a prompt change with a sampling change. Prompt revision here is driven entirely
  by comparing runs, so this property is load-bearing for the whole loop.
- fixtures/regression-set/ + `npm run regression:check`: Tier-1 harness. Ten chosen (not sampled)
  documents replayed through the extract API and diffed against committed snapshots. Because the
  seed is document-keyed and temperature is 0, an unchanged prompt reproduces exactly, so any
  reported difference is attributable to the prompt change — no statistics needed. Oxford Circle is
  in the set specifically to close the `+lowleg` gap from Finding 2.
- shared/extractionDiff.ts reports a relocated item as a MOVE rather than remove+add, so placement
  changes stay distinguishable from recall/invention changes.

--- Next ---
1. Capture bundles for the ten regression-set documents; add an image-only PDF for `vision-only`.
2. Pull sources for #A and #B — that decides whether read-across is general or one-document.
3. THEN make Step 4 (EXTRACTION RULES 3/4/5 from prohibitions to transcription procedures) the
   single themed change for the next run, against this baseline.

--- Notes ---
Would you stop using the tool over this? No. But "13 of 17 Successfully Processed" is not evidence
of accuracy — it is evidence that the flags never fired, which Finding 1 shows is the actual
problem. Treat this batch as the baseline, not as a pass.
```

---

## Session 5 — static audit of constants.ts (no batch run)

```
Date:                     2026-09-19
Operator:                 agent session (claude/loving-hawking-r436g3)
Files:                    none — see "Blocker" below
Prompt version:           reviewed 2026-09-19.3; shipped 2026-09-19.4
Host mode:                npm test / npm run typecheck only
Method:                   full critical read of constants.ts + simulation of the fidelity rollup
                          against the ten committed regression baselines. No Gemini calls.

--- Blocker: the Tier-1 harness could not run ---
`fixtures/regression-set/bundles/` is gitignored, so a fresh clone has no bundles and
`regression:check` reports all 11 documents "bundle not captured" and exits 2 before any API
call. Anything in this session that would need a replay is unverified by construction. The
bundles live only on whichever machine captured them — that is a single point of failure for
the whole revision loop.                                                        | cause: setup

--- Finding 1: 2026-09-19.3 would have discarded most of the batch (WITHDRAWN) ---
Rule 3 of .3 said "For every item, default `verbatim` to `false`". `verbatim:false` is not only
a note to a human — it feeds `shared/extractionFidelity.ts`, whose thresholds were tuned when
`false` was rare:
    nonVerbatim/total >= 0.15  ->  extractionStatus ok -> partial
    nonVerbatim/total >= 0.40  ->  extractionConfidence low
    confidence low             ->  shouldHardStopExtraction
    hard stop (App.tsx:531)    ->  status 'error', result UNDEFINED — extraction discarded
Replaying the ten committed baselines through the real `reconcileExtractionFidelity` with every
item flagged puts 9 of 10 into the discard path (the tenth has N=0, below the N>=6 gate).

So .3 had no safe operating point: under 15% flagging it changes nothing, at 40% it throws the
batch away, and it asked for 100%. The more the rule worked, the worse the outcome. Its own
stated failure condition ("RETIRE/REVISE IF a batch doesn't move the flagging rate") was
watching for the wrong thing.                                                   | cause: prompt

Shipped 2026-09-19.4 in response: same observable-output procedure, but the trigger is bounded
to something the model can perceive — "did I read every character, or did I reconstruct part of
it?" — instead of an unconditional default. STILL UNVALIDATED; needs a replay.

Diagnostic for whoever has the bundles: `extractionDiff.ts` diffs `extractionStatus` and
`extractionConfidence`. If the .2 -> .3 run showed no `ok -> partial` lines, then .3's flagging
never crossed 0.15 and its headline intent did not land at all — while its side effects did.

--- Finding 2: the prompt names one regression document's own group labels ---
PHASE A rule 3's worked example is, verbatim: "YouthMoves at FLC", "Summer Intensive",
"Student Produced Concert". Those are exactly the three Activities group names in the committed
Performance Garage baseline. The fixture cannot measure grouping, because the model can emit
those labels from the prompt without reading the document.

This reframes the open "Performance Garage Activities collapsed to General under .3"
observation: .3 added ~265 chars directly below that example, and if the model stopped echoing
it and fell back to GROUPING GATE 1 ("Default is General"), the .2 baseline was the artifact and
.3 may be the more faithful read. Not resolvable from JSON — needs the source.
                                                                                | cause: setup

--- Finding 3: the Healthy NewsWorks prefix may be a partial FIX, not a regression ---
Observed under .3: Core Reporter's Outputs items gained a "Student Publications: " prefix.
"Student Publications" does not appear in the Core Reporter baseline at all — but it IS a real
Outputs group in the sibling Cub Reporter baseline (5 items, and it spans all three outcome
domains). And Core Reporter's .2 Outputs sit under "Program Delivery", a label carried over from
its Activities column — which GROUPING GATE 3/4 forbids. Four of those six items are plainly
publications ("40+ school newspapers published", "2 magazines published", "6+ videos",
"20+ interviews with health experts").

Best reading: the source does have a "Student Publications" sub-heading, .2 missed it and
carried a label across columns instead, and .3 began finding it but rendered it as item text
instead of a `Group.name`. If so the defect is placement, not grouping. Needs the source.

Real prompt gap either way: nothing in the file says a sub-heading belongs in `Group.name` and
must not ALSO be concatenated into `text`.                                      | cause: prompt

--- Finding 4: prohibition-vs-procedure is the wrong axis ---
The file header says a rule the model can't verify it's obeying has "repeatedly failed". But
rule 4 (polarity) is a pure prohibition and session 3 confirmed it HELD. The difference is not
prohibition vs procedure — it is whether the TRIGGER is perceptible. "reduction" vs "increase"
is a discrete visible lexical choice; "did I fabricate?" has no perceptible trigger at all.
Rule 2 ("Never add items... If you are unsure whether something is there, leave it out") is the
canonical imperceptible-trigger rule, it is marked (CRITICAL), it sits directly above rule 3 —
and the .3 change, whose whole theme was prohibitions -> procedures, left it untouched.
                                                                                | cause: prompt

--- Finding 5: rules that compete (file header point 4, measured) ---
a. Include-or-omit conflict. Rule 2 says "if unsure, leave it out" (omit); rule 3 says flag and
   keep (include); the LOW-RESOLUTION block says "prefer a partial transcription" (include).
   Two say include, the (CRITICAL)-marked one says omit. An ambiguous include/omit instruction
   is a plausible contributor to the Cub Reporter 111-vs-115 instability that is currently
   attributed wholly to sampling noise.
b. Rule 3 vs EXTRACTION FIDELITY STATUS: fidelity marks a document `partial` when "many items
   must be verbatim:false" and `ok` on "mostly confident verbatim transcriptions". Under .3,
   `ok` was unreachable by construction. (Finding 1 restated inside the prompt itself.)
c. The text-only variant contradicts itself. Line 6 says "no page images"; PHASE A step 0 says
   "You may receive multiple images for one document". Rule 3 told a text-only run to "point to
   the specific glyphs on the page". `possiblyMissedRegions` is defined entirely over "each
   TRACK B image", making it STRUCTURALLY UNREACHABLE in text-only — which is part of why it
   fired 0/17 in session 4. Root cause: only `inputTracksSection` and `colourAndEmphasisSection`
   take `isVision`; every other section keys off `hasTextTrack` alone, which is true for
   text-only documents, so they inherit dual-track language.
d. GROUPING GATE 5 ends "when unsure, prefer General". A global uncertainty default composes
   with that mechanically — a third candidate mechanism for Finding 2's collapse.
                                                                                | cause: prompt

--- Finding 6: EVIDENCE notes that have gone stale ---
- The LOW-RESOLUTION block was partly dead under .3: rule 3's "every item" default was strictly
  broader than the block's proper-noun/number/duration trigger, and "never repair an odd-looking
  phrase" was stated TWICE in the +lowleg variants. Commit 22cc776 was specifically "remove
  duplicated rule statements"; .3 reintroduced that class of redundancy. .4 narrows rule 3 again,
  so the block is load-bearing once more — but its RETIRE IF still doesn't cover being made
  redundant by a rule above it.
- COLOUR CODING is miscategorised by session 4's Finding 1, which lumps `fillColor 0/718` in
  with `verbatim 0/718` as one failure. The baselines disagree: Oxford Circle captures colour on
  44/44 items with genuine per-box variation (orange/purple/coral mixed WITHIN groups) — exactly
  what the rule asks for. The other nine documents have no coloured boxes. Same number, opposite
  diagnosis: the colour rule is working.
- SOURCE LOCATION's "plumbing fixed 2026-09-19 in server/apiCore.ts" is unverified. Baselines
  captured AFTER that fix carry `sourcePage` on only 3 of 10 documents, and 4 of the 7 blanks are
  `vision+text`, where image labels should exist. (The two text-only blanks are correct.)

--- RESOLVED (same session — owner supplied the three source documents) ---
Findings 2 and 3 above were inferences from JSON alone. With the sources in hand, BOTH were
partly wrong. Recording the original reasoning and its correction, because the error is the
instructive part: JSON-only inference produced confident, coherent, wrong structural stories.

Finding 3 (Healthy NewsWorks) — WRONG ON CAUSE, and the truth is more useful.
The Core Reporter Outputs column nests three levels:
    [x=250] Program Delivery                                  <- group heading
    [x=253] * Lessons delivered to 600 students in 24 classrooms
    [x=253] * Student Publications                            <- level-1 BULLET, not a heading
    [x=267]   o 40+ school newspapers published
    [x=267]   o 2 magazines published
    [x=267]   o 6+ videos
    [x=267]   o 20+ interviews with health experts
    [x=267]   o 7,000 students, teachers, family members reached
    [x=250] Teacher Training                                   <- group heading
    [x=253] * In-person and online teacher trainings held
Two claims in Finding 3 are retracted:
  - "Program Delivery is carried over from Activities, violating GROUPING GATE 3/4" is FALSE.
    Both columns print both headings at their own heading indent (x=135 Activities, x=250
    Outputs). No rule is violated; by PHASE A rule 3 they are a genuine two-column band.
  - "The source has a Student Publications sub-heading that .2 missed" is FALSE. It is a
    level-1 bullet with five level-2 children.
The real defect: the source has THREE levels, `LogicModel` has TWO (Group.name -> items[]).
.2 dropped the middle level (the parent label vanishes, its children become siblings of
"Lessons delivered..."). .3 inlined it as a text prefix. Neither is a grouping regression;
both are lossy encodings of unrepresentable structure, and .3's is the LESS lossy one — it
preserves a label .2 silently discarded. Nothing in constants.ts says what to do when source
nesting exceeds two levels. That is the actual gap.
The sibling confirms the phrase is level-ambiguous ACROSS documents: in Cub Reporter,
"Student Publications" IS a group heading, spanning Outputs + all three outcome columns
(x=379/533/683/827). Both extractions were right about their own document.
Cub Reporter also confirms session 4 Finding #A: its title is "Healthy NewsWorks Logic Model:
Core Reporters & Cub Reporters" — the document genuinely covers two programs, so the merged
`program` value was correct, not a bleed.                                       | cause: prompt

Finding 2 (Performance Garage) — CONTAMINATION REAL, CONCLUSION BACKWARDS.
Shape coordinates in ppt/slides/slide2.xml resolve the grid:
    row y~1.70M  YouthMoves at FLC        -> Outputs, Short, Medium, Long all present
    row y~3.12M  Summer Intensive         -> same
    row y~4.80M  Student Produced Concert -> same
The three labels are REAL horizontal bands spanning five columns. PHASE A rule 3's example is
not a coincidence — it was written FROM this document in session 1.
So the inference that ".2 may be the artifact and .3 the more faithful read" is retracted. The
labels are correct. The .2 baseline is ALREADY WRONG in the other direction: it captures the
bands in Activities only and uses "General" for Outputs and all three outcome columns. A
collapse in Activities too would move it from right in 1 of 5 columns to 0 of 5 — a real
regression, not a de-contamination.
Root cause is modality, not prompt: the band label is printed once, physically inside the
leftmost (Activities) shape; shapes 9/17/20/24 carry bullets and no label. This document runs
text-only (PPTX vision conversion fails), so no coordinates exist to carry the label rightward.
A text-only pipeline structurally CANNOT recover horizontal tracks here. The fixture is invalid
for track-band behaviour until PPTX conversion works — and the prompt contamination remains a
separate reason not to read grouping results off it.
Also visible: .2 merged two source paragraphs ("Performances (Apr + June)" and "students
participate in DanceVisions events") into one item, against EXTRACTION RULES 1.
                                                                                | cause: setup

--- What this changes about the queue ---
- "Separate Group.name from item text" is NOT the right next change. The problem is three
  source levels into two schema levels. Decide the policy first (drop the parent? inline it?
  flatten to `<parent> — <child>`? extend the schema?), then write the rule. A prompt rule that
  says "don't inline" without saying where the level goes just reinstates .2's silent drop.
- No fixture in the set can currently validate track-band detection: Oxford Circle has no
  bands, Performance Garage has real ones the text-only path cannot see. That gap is now
  measured, not suspected.


--- Actions taken (this session) ---
- constants.ts: rule 3 rewritten, PROMPT_VERSION 2026-09-19.3 -> 2026-09-19.4. One themed change;
  +265 chars, identical across all 9 prompt variants, nothing else moved.
- manifest.json: three `covers` corrections (Oxford Circle's "real horizontal track bands" claim;
  Performance Garage's contamination AND its invalidity as a track fixture; Core Reporter's
  three-level Outputs nesting).
- No fixes applied for Findings 3, 4, 5 or 6 — each is a separate themed change.
- Sources for Performance Garage + both Healthy NewsWorks documents read; Findings 2 and 3
  corrected above (see RESOLVED). manifest.json notes revised to match.

--- Next (queued, one per batch, not bundled) ---
1. Replay .4 against the bundles. Nothing here is validated until someone does.
2. Fix the variant gating (Finding 5c) — give the remaining sections `isVision` so text-only
   stops receiving image language. Pure correctness; touches no vision behaviour.
3. Decide the over-nesting policy (RESOLVED, Finding 3): three source levels into two schema
   levels. Pick where the middle level goes BEFORE writing any rule.
4. Resolve the rule 2 / rule 3 include-or-omit conflict (Finding 5a).
5. Proceduralize rule 2 via the existing `sourcePage`/`sourceColumn` fields (Finding 4).
6. De-duplicate the LOW-RESOLUTION block against rule 3 (Finding 6) — a prune, not an add.
7. Get `possiblyMissedRegions` off its self-confidence gate and its explicit opt-out.

--- Notes ---
The two grouping observations that opened this session were settled the moment the sources
arrived, and both had been read wrongly — including by this session's own first pass, which
produced two confident, internally coherent, wrong structural stories from JSON alone. Neither
turned out to be a grouping regression: one is a two-level schema meeting a three-level source,
the other is a text-only pipeline that structurally cannot see horizontal bands.

The session-4 lesson holds harder than before. JSON tells you something changed; it does not
tell you what the document says, and a plausible reconstruction of the document from its
extraction is not evidence. Two of the four things this session was asked to investigate could
only be answered by opening the file. Budget for that rather than for more diffing.
```

---

## Session 6 — first controlled A/B (bundles rebuilt; noise floor measured)

```
Date:                     2026-09-20
Operator:                 agent session (claude/loving-hawking-r436g3)
Files:                    3 (Performance Garage YouthMoves, HNW Core Reporter, HNW Cub Reporter)
Prompt versions:          2026-09-19.2 vs 2026-09-19.4, same bundles
Host mode:                npm run dev + scripts/capture-bundles.mjs
Gemini calls:             14 extract (3 capture + A1 3 + A2 3 + B 3 + B2 2)
Method:                   bundles rebuilt from source via headless Chromium and HELD CONSTANT,
                          then each prompt version run TWICE. The repeat is the control session 5
                          lacked: it separates prompt effect from run-to-run variation.

--- Setup change: the harness is no longer machine-bound ---
scripts/capture-bundles.mjs drives the real dev app in headless Chromium and reads the bundles
App.tsx already retains on `window.__lmRegressionBundles`. Session 5's blocker (gitignored
bundles => `regression:check` unrunnable on a fresh clone) is gone; bundles are rebuildable
anywhere from the source documents.                                              | cause: setup

--- Results ---
                        .2 run1    .2 run2    .4 run1    .4 run2
Perf Garage items          44         46         46         46
Perf Garage Activities   General x3  3 bands    3 bands    3 bands
Core Reporter items        46         46         45         45
Core "Student Publications" present   present    absent     absent
Cub Reporter items        111          -        118        118 (heavy churn vs run1)
verbatim:false              0          0          0          0

--- Finding 1: 2026-09-19.4 is a confirmed no-op on the thing it was written for ---
0 of 209 items flagged under .4; 0 of 201 under .2. Not one `sourceNote`, not one
`possiblyMissedRegions` entry, in any arm. The REVISE IF condition written into rule 3's own
EVIDENCE note ("a batch shows the flagging rate still ~0") is MET. Bounding .3's trigger to
"did I read this or reconstruct it?" did not move the signal any more than the prohibition it
replaced. Two rewrites have now failed to move item-level flagging; the next attempt should not
be a third rewording.                                                            | cause: prompt

Worth noting what this also means: .3's unbounded version was withdrawn on arithmetic (session 5
Finding 1) showing it would discard 9 of 10 documents IF obeyed. These runs suggest it would
likely not have been obeyed either. The withdrawal was still right — the failure mode was
catastrophic and the obedience rate unknown — but the rollup collision was never tested live.

--- Finding 2: session 5's headline grouping observation was NOISE, and now reproduces as such --
Performance Garage's Activities column is BISTABLE under an unchanged prompt:
  .2 run 1 -> group "General" x3, band label inlined into the item text:
       "YouthMoves at FLC - 35 Classes, 35 Rehearsals (7 mos) Performances (Apr + June)..."
  .2 run 2 -> groups "YouthMoves at FLC" / "Summer Intensive" / "Student Produced Concert"
Same prompt, same bundle, opposite structure. The "Activities collapsed to General under .3"
observation that opened session 5 is therefore not attributable to any prompt change: .2
produces that collapse on its own. .4 produced the correct bands in both of its runs, but n=2
is not enough to claim .4 fixed anything.                                         | cause: other

--- Finding 3: one root cause under all of it — 2-level schema, 3-4 level sources ---
`LogicModel` is Group.name -> items[]. The sources nest deeper (Core Reporter Outputs is 3
levels; Cub Reporter outcome columns are 4: "Core Reporters" > "Students demonstrate
improvements in:" > "Academic Skills" > "Writing"). Nothing in constants.ts says how to flatten.
Four different encodings were observed across these runs, all from the same model on the same
input:
  a. promote parent to Group.name, children become items          (.4 on Perf Garage)
  b. inline parent into every child's text                        ("Student Publications: 40+...")
  c. concatenate parent AND all children into ONE item string     (.2 run 1 on Perf Garage)
  d. emit parent as its own sibling item                          (.2 on Core Reporter)
Every symptom chased since session 4 — the "grouping collapse", the "redundant prefix", and the
item-count churn — is this one underdetermined choice being re-rolled. They are not three bugs.
                                                                                 | cause: prompt

--- Finding 4: the instability is structural, not generic seed noise ---
fixtures/regression-set/README.md attributes the Cub Reporter 111-vs-115 wobble to Gemini's seed
being "not a guaranteed absolute deterministic behavior". That is not what these runs show. On
two IDENTICAL .4 runs: Perf Garage and Core Reporter came back byte-identical (diff reports
"unchanged"), while Cub Reporter churned heavily at a constant 118 items — items relabelled
across encodings (b) and (d), Impact group renamed "...impacts include:" -> "...impacts:".
The two stable documents are the shallow ones; the churning document is the 4-level one. Seed
non-determinism would not sort itself by nesting depth. Re-running is therefore NOT a general
remedy: a document either has an underdetermined flattening or it does not.       | cause: prompt

--- Finding 5: a small recall regression in .4, flagged not fixed ---
.2 emitted "Student Publications" as its own Outputs item in both runs; .4 dropped it in both
(46 vs 45 items). No within-arm variation on either side, so unlike Finding 2 this looks like a
real prompt effect — .4 loses a parent label .2 kept. It is one item on one document; recorded
so it is not discovered later as a mystery.                                       | cause: prompt

--- Actions taken (this session) ---
- scripts/capture-bundles.mjs added; bundles for the 3 documents rebuilt locally (still
  gitignored — the script, not the artifact, is the durable asset).
- No prompt change. Findings 1 and 3 say the next change should not be another rewording of
  rule 3, and Finding 3's fix needs a policy decision first.

--- Next ---
1. DECIDE the over-nesting policy (Finding 3). This is the highest-value open item and it is a
   product decision, not a prompt tweak: promote / inline / drop / extend the schema to 3 levels.
   Until it is decided, item counts on nested documents are not a meaningful regression signal.
2. Correct fixtures/regression-set/README.md: the determinism claim, and the advice to "re-run
   once more before concluding anything", both need Finding 4's qualification.
3. Stop attacking item-level flagging by rewording. Two rewrites, zero movement. If the signal
   is wanted, it likely needs a separate cheap pass over the extracted items rather than an
   instruction inside a 20-24k character prompt that is already losing rule competitions.
4. Capture the remaining 8 bundles from Drive and re-baseline once (1) is decided.

--- Notes ---
This session cost 14 Gemini calls and answered more than sessions 4 and 5 combined, because it
ran the same prompt twice. Every prior "regression" in this log that was diagnosed from a single
diff should be treated as unproven until it is reproduced against a same-prompt control.
```

---

## Running tally

| # | Date | Format | Stage hurt | Cause | Stop-using? |
|---|------|--------|------------|-------|-------------|
| 1 | 2026-07-30 | PDF | extract | prompt + doc-quality | N |
| 2 | 2026-07-30 | PDF | extract (OCR) | doc-quality + prompt | N |
| 3 | 2026-07-30 | PDF + CSV | extract (small print + colour) | doc-quality + prompt | N |
| 4 | 2026-09-19 | batch (17) | extract (flagging silent; variant coverage) | prompt + setup | N |
| 5 | 2026-09-19 | n/a (static audit) | extract (.3 would discard 9/10; harness unrunnable) | prompt + setup | N |
| 6 | 2026-09-20 | A/B (3 docs) | extract (.4 no-op; grouping churn = over-nesting) | prompt + setup | N |
