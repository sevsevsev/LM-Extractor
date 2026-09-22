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

## Session 7 — NESTING rules 7-9 (first prompt change validated against a control)

```
Date:                     2026-09-20
Operator:                 agent session (claude/loving-hawking-r436g3)
Files:                    3 (same bundles as session 6, unchanged)
Prompt version:           2026-09-20.1 (GROUPING GATE 7-9 + worked example, +1438 chars)
Gemini calls:             6 extract (C1 3 + C2 3)
Method:                   same bundles as session 6, new prompt run TWICE, compared against
                          session 6's same-prompt control as the before picture.

--- The change ---
GROUPING GATE gains NESTING rules 7-9: the outermost UNBULLETED label in the column becomes
`Group.name`; every deeper label folds into the item text joined with " — " (keeping a trailing
colon where the label has one); one item per leaf bullet; never emit a parent as its own item,
never merge parent and children into one item, never repeat `Group.name` in an item's text.
Plus a worked example taken from Core Reporter's actual Outputs column.

Deliberately NOT a 3-level schema. A fixed depth just moves the cliff — Cub Reporter already
needs four — and the deliverable is a flat CSV. Determinism, not depth, is what the harness
needs. If flat strings later fail real coders, the non-recursive upgrade is an optional
`subPath?: string[]` on `LogicModelItem`.

--- Result: the deep-nesting churn is gone ---
                          session 6 (.4)        session 7 (2026-09-20.1)
same-prompt churn          120 diff lines        9 diff lines
Cub Reporter               118/118, heavy churn  113/113, ZERO item churn
Core Reporter              45/45 stable          45/45 stable
Cub canonical form         (varied per run)      "Academic Skills — Writing", group
                                                 "Core Reporters" — exactly as specified
The four-level document that motivated this whole line of work now reproduces exactly across
identical runs. The 9 remaining diff lines contain no item-level churn on the vision documents:
Core and Cub differ only in the scalar `targetPopulation` field.            | cause: prompt

--- Result: the text-only document is NOT fixed, and the reason matters ---
Performance Garage remains BISTABLE: run C1 collapsed Activities to "General" x5 with
concatenated items, run C2 produced the three correct bands (and a spurious fourth Financial
input holding the slide's overview prose).

The cause is this rule's own trigger. "The outermost label carrying NO bullet marker, at the
column's left edge" is a VISUAL cue. A text-only document has no column, no left edge, and a
PPTX text track that does not reliably carry bullet markers — so the trigger is imperceptible
there. That is precisely the failure mode diagnosed for rule 2 in session 5 (Finding 4:
prohibition-vs-procedure is the wrong axis; trigger perceptibility is the right one), now
landing on a rule written in this session. The principle held and predicted its own limit.

Next themed change: restate the same policy for text-only over Track A Markdown list depth,
which is the structure that variant actually has. Not bundled here.        | cause: prompt

--- The detector caught nothing, and that is worth recording ---
shared/nestingConsistency.ts (rule-9 violations, unit-tested, analysis only, NOT wired into the
fidelity rollup so the prompt stays the batch's only variable) fired ZERO times across all six
real arms — including arm B, the output it was written for. Arm B emitted "Student Publications"
as a bare item, but its siblings were bare too, so no child carried it as a prefix. Detecting
that encoding needs the source: "is this item the parent of those?" is not decidable from the
extraction alone. So the check only catches a MIXED encoding and is insurance, not a validated
instrument. Kept with an explicit RETIRE IF rather than quietly counted as a win. | cause: other

--- Actions taken ---
- constants.ts -> PROMPT_VERSION 2026-09-20.1; one themed change, +1438 chars, additive only.
- shared/nestingConsistency.ts + 7 unit tests (218 tests total, all passing).
- No change to the fidelity rollup, so C1/C2 are attributable to wording alone.

--- Next ---
1. Text-only formulation of rules 7-9 over Track A Markdown depth (the Performance Garage gap).
2. Item-level flagging is still 0% at 2026-09-20.1, unchanged across every arm since session 4.
   Per session 6, stop rewording: the next attempt should be a Track A cross-check (free,
   deterministic, covers vision+text) then a second verification pass with a corruption eval.
3. Capture the remaining 8 bundles and re-baseline now that nested documents reproduce.

--- Notes ---
First prompt change in this log with a same-prompt control on both sides of it. It bought a real
answer — a decisive win on vision documents and a clean, explained failure on text-only — for 6
Gemini calls. Both prior changes (.3, .4) were judged on a single diff and taught nothing.
```

---

## Session 8 — verification protocol run + stability census (`npm run census`)

```
Date:                     2026-09-20
Operator:                 agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.1 (unchanged this session)
Gemini calls:             12 (2 census passes x 3 documents, run twice)

--- Correctness: the protocol finally ran ---
See docs/verification/2026-09-20-scorecard-summary.md. Three documents, 204 items.
  INVENTION RATE: 0 / 204.
Core Reporter is clean on every dimension (42/42 source bullets, correct domain, correct group,
exact text, canonical three-level nesting) and is a golden-set fixture candidate.
Completeness is NOT measured — the mechanical parser flagged 15 Cub Reporter items and
hand-checking showed the great majority were parser artifacts. Three of my own checker's
"findings" were checker bugs. A human Pass 1 is still the missing piece.       | cause: other

--- The census, and what it immediately caught ---
`npm run census` runs every regression-set document twice on the CURRENT prompt and reports
whether it reproduces. It answers the question `regression:check` silently assumes: is a diff on
this document meaningful at all?

Three independent same-prompt pairs at 2026-09-20.1:
                       pair 1 (C1/C2)   pair 2      pair 3
  Core Reporter          stable         stable      stable      -> 3/3 trustworthy
  Cub Reporter           stable         UNSTABLE    stable      -> 2/3
  Performance Garage     UNSTABLE       UNSTABLE    UNSTABLE    -> 0/3

CORRECTION TO SESSION 7. That session recorded Cub Reporter as "ZERO item churn" on the strength
of one pair. Three pairs say 2 of 3. The nesting rule is a large real improvement (from 120 diff
lines to near zero) but it did not make that document deterministic, and the stronger claim was
not supported by the evidence behind it. The census caught this on its first run, which is the
entire argument for having one: a single same-prompt pair beats no control and is still not
enough to call a document stable.                                              | cause: prompt

Performance Garage is unstable in 3 of 3 — consistent with session 7's diagnosis that the NESTING
rule's trigger is visual and cannot fire on a text-only document.

--- Practical limit hit: getting the other 8 bundles ---
The Drive connector returns file contents as base64 IN CONTEXT, and writing them back to disk
costs the same again, so each document round-trips at roughly 2x its base64 size (~20k tokens for
an 18KB DOCX; ~1.5M for the remaining eight). Uploading the files directly into the session is an
order of magnitude cheaper. Recorded so the next session does not rediscover it.  | cause: setup

--- Actions taken ---
- scripts/stability-census.ts + `npm run census`.
- docs/verification/2026-09-20-scorecard-summary.md (first protocol run).
- constants.ts evidence note corrected; the over-claim is left visible, not edited away.
- No prompt change: 2026-09-20.1 stands.

--- Next ---
1. Capture the remaining 8 bundles (upload, not Drive) and run the full census. Until then the
   set is 3/11 characterised.
2. Human Pass 1 on the three verified documents -> first real completeness rate.
3. Text-only NESTING formulation over Track A Markdown depth (Performance Garage, 0/3 stable).
4. Item-level flagging is STILL 0% at 2026-09-20.1. Do not reword again — Track A cross-check
   first, then a verification pass with a corruption eval.

--- Notes ---
Two sessions ago the question was whether a grouping change was a regression. It was noise. One
session ago the question was whether the fix worked. It mostly did, less than claimed. The thing
that moved both answers was not a better prompt, it was running the same thing twice.
```

---

## Session 9 — item-level flagging removed (PROMPT_VERSION 2026-09-20.2)

```
Date:                     2026-09-20
Operator:                 owner decision; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.1 -> 2026-09-20.2
Gemini calls:             12 (two census pairs)

--- The decision ---
Owner: drop item-level flagging. It adds a layer of work to the app, it is not that helpful, and
correctness will be checked instead by randomly sampling logic models and comparing them to the
extraction. That is the right call on the evidence: the apparatus was asked for four different
ways across four prompt versions (original rules 3/4, .3, .4, and 2026-09-20.1) and produced a
flag on 1 item in roughly 640. Random sampling is also a BETTER rate estimator than this
regression set, which is chosen-not-sampled and deliberately over-weights hard cases.

--- What was removed ---
`verbatim` / `sourceNote` instructions everywhere they appeared (rule 3, the LOW-RESOLUTION
block, Track A completeness check, track conflict resolution, ITEM SHAPE, OUTPUT FORMAT), the
whole `possiblyMissedRegions` procedure, and the two fidelity clauses keyed on flag counts
("Partial when many items must be verbatim:false", "Ok when mostly confident verbatim
transcriptions").

--- What was deliberately NOT removed ---
Every transcription rule tangled up with the flagging instructions:
  - "transcribe only what is legible - do not guess the missing part"
  - "Never replace an unclear name with a more familiar real-world one"
  - "Never repair odd-looking wording into something more idiomatic"
  - "Never flip direction / polarity words"
  - "Never add items, partner names, organizations, numbers..."
  - "Prefer a partial transcription over a complete-looking guess"
These are the likeliest cause of session 8's 0-inventions-in-204 result. Cutting flagging without
cutting them was the main risk in this change, and the snapshot diff was reviewed specifically to
confirm all seven survived.

Document-level signals all kept: `extractionStatus`, `extractionBlockers`,
`documentTypeAssessment`, the text-only fallback blocker, and the low-legibility hard stop. That
last one is renderer-driven, never model-reported, so the app still correctly refuses Art Thru
Youth's 1024px PNG despite model self-assessment being gone.

--- Size: the first net reduction in this file's history ---
  vision+text+lowleg   25817 -> 24354   (-1463)
  vision+text          24844 -> 23521   (-1323)
  text-only            22045 -> 20791   (-1254)
Working-agreement point 4 ("prune before adding") has existed since the start and every previous
change added. Code was deliberately left alone: `verbatim`/`sourceNote`/`possiblyMissedRegions`
are all OPTIONAL in the Gemini schema (`required: ['text']`), so the model simply stops emitting
them, `nonVerbatim` becomes 0, the ratio branches in extractionFidelity.ts never fire, and the
rollup degrades by itself to document-level signals. Prompt-only, fully reversible. | cause: prompt

--- Stability: two pairs, and the second one refuted the first ---
                        pair 1                      pair 2
  Core Reporter         STABLE byte-identical       STABLE byte-identical
  Cub Reporter          STABLE byte-identical       UNSTABLE (grouping)
  Performance Garage    UNSTABLE (grouping)         STABLE byte-identical

After pair 1 the tempting claim was "removing the flagging apparatus made everything
byte-identical". Pair 2 refutes it: Cub and Performance Garage each flip. The only defensible
statements are (a) the prune did not destabilise anything, and (b) Core Reporter is now
byte-identical, 2 of 2 here and stable 3 of 3 at 2026-09-20.1 — 5 of 5 overall, the only document
in the set a regression diff can currently be trusted on.

This is the second consecutive session where running it twice killed an over-claim before it was
made. Session 8's correction was caught after the fact; this one was caught before. | cause: other

--- Actions taken ---
- constants.ts -> 2026-09-20.2. Working-agreement point 3 rewritten: what decides whether a rule
  lands is whether its TRIGGER is perceptible, not procedure-vs-prohibition. The old wording cited
  `verbatim: false` + `sourceNote` as the pattern that worked — it was the apparatus just removed.
- No code change. No schema change.

--- Next ---
1. Capture the remaining 8 bundles (upload, not Drive) and census the full set.
2. Human Pass 1 on the verified documents -> first real completeness rate.
3. Text-only NESTING formulation over Track A Markdown depth (Performance Garage).
4. Dead-code pass on extractionFidelity.ts's ratio logic ONLY once this decision has held for a
   few batches — it is inert, not broken, and leaving it costs nothing while the call is "for the
   time being".

--- Notes ---
Worth recording what this session did NOT do: it did not try a fifth wording for flagging. Four
attempts, roughly 640 items, one flag. The decision to delete rather than reword came from the
owner, and it is the first time in this log that a rule was retired on its record rather than
rewritten — which is what the EVIDENCE/RETIRE IF notes were put there for in the first place.
```

---

## Session 10 — first `vision-only` test in the project's history

```
Date:                     2026-09-20
Operator:                 owner uploads; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.2 (unchanged)
Gemini calls:             22 (4 capture + 14 census + 4 inspection)

--- Setup: four new bundles, two of them a variant never before tested ---
Owner uploaded FirstHand (pptx), Oxford Circle (pdf), and two standalone PNGs that were NOT in
the regression set: UPenn BioEYES and Trinity Enrichment "Boys & Girls Rising". Both PNGs capture
as images=1 / textTrack=0 — `vision-only`. Session 4 Finding 2 flagged `vision-only` and
`+lowleg` as completely untested and said that is where the known failures live. Six sessions
later, `vision-only` has now actually been run.                                  | cause: setup

--- Census, 7 documents with bundles ---
  Oxford Circle        vision+text    44/44    STABLE byte-identical
  Core Reporter        vision+text    45/45    STABLE byte-identical
  Cub Reporter         vision+text  113/113    stable items, scalar drift
  FirstHand            text-only      45/45    STABLE byte-identical
  Performance Garage   text-only      46/46    UNSTABLE (grouping)
  BioEYES              vision-only      6/6    UNSTABLE (grouping)
  Trinity              vision-only    53/53    UNSTABLE (grouping)
                                               -> stable 4, unstable 3

--- Finding 1: vision-only EXTRACTS WELL. The worry was misplaced. ---
Trinity's extraction matches the source infographic column for column:
  inputs 8 · activities 9 · outputs 6 · short 5 · intermediate 5 · long 5 · impact 4
  unmapped: "SITUATION / NEED" 5 · "EVALUATION METHODS" 5 · "OUR BELIEF" 1
Every count is right against the image. More than that, its OUTCOMES column is a three-level
structure — three labelled sub-boxes (SHORT-TERM 0-3 MONTHS / INTERMEDIATE 3-6 MONTHS /
LONG-TERM 6-12+ MONTHS) each holding a bullet list — and the model routed each sub-box to the
correct time-horizon DOMAIN while keeping the sub-box label as the group name. That is NESTING
rules 7-9 and COLUMN FIDELITY 3 working together, on the variant nobody had ever tested, with no
text track to lean on. `SITUATION / NEED` and `EVALUATION METHODS` correctly went to `unmapped`
rather than being forced into a domain.

BioEYES: `documentTypeAssessment: not_logic_model`, `layoutFamily: diagram`, six boxes routed to
`generalOutcomes` rather than guessed into time horizons. For a linear outcome chain with no
input/activity/output structure that is the right call on both counts (DOCUMENT TYPE CHECK and
COLUMN FIDELITY 7).                                                              | cause: other

--- Finding 2: CORRECTION — "text-only is structurally broken" was too broad ---
Sessions 7 and 9 concluded that the NESTING rule cannot fire on a text-only document because its
trigger ("outermost label carrying no bullet marker, at the column's left edge") is visual, and
predicted the text-only variant would stay unstable. FirstHand is text-only and came back
BYTE-IDENTICAL. So the variant is not the explanation. Performance Garage is the outlier, and
what is distinctive about it is not that it is text-only but that its grouping is genuinely
ambiguous in its flattened representation: its band labels live inside the leftmost Activities
shape with no positional information to attach them to the other columns.

Revised reading: grouping bistability is DOCUMENT-specific, not VARIANT-specific. It appears in
text-only (PG), vision-only (both PNGs) and previously vision+text (Cub) alike. What the unstable
documents share is a source whose grouping is underdetermined once flattened — not an input
modality.                                                                        | cause: prompt

--- Finding 3: every unstable case is grouping ONLY ---
46/46, 6/6, 53/53 — item counts identical across runs in every single unstable document. Nothing
is being gained or lost between runs; the same content is being filed differently. That matters
for the sampling plan: a random-sample correctness check is measuring recall and invention, and
neither appears to move run to run. Grouping is the unstable axis, and grouping is also the axis
a human coder can most easily repair.

--- Actions taken ---
- manifest.json: two new entries (upenn-bioeyes, trinity-boys-girls-rising) closing the
  vision-only gap the README has flagged since session 4.
- Bundles captured for BioEYES, Trinity, Oxford Circle, FirstHand. Set is now 7 of 13 covered.
- No prompt change.

--- Next ---
1. Remaining bundles: harlem-lacrosse, philadelphia-ballet, ymca, a-new-dawn, seamaac,
   art-thru-youth.
2. Human Pass 1 for the completeness rate — still the missing number.
3. DO NOT write the text-only NESTING rule that sessions 7/9 queued. Finding 2 removes its
   premise. If grouping stability is worth chasing, the target is underdetermined grouping in
   general, not one variant.
4. Random-sample correctness run, per the owner's plan.

--- Notes ---
Two sessions of reasoning about a "text-only structural gap" were undone by uploading the other
text-only document and pressing go. The cheapest experiment available was the one that had not
been run.
```

---

## Session 11 — the `+lowleg` answer: it fails at the GATE, not at extraction

```
Date:                     2026-09-20
Operator:                 owner uploads; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.2 (unchanged)
Gemini calls:             30 (5 capture + 1 inspection + 24 census)
Coverage:                 12 of 14 manifest documents now have bundles

--- Finding 1 (headline): Art Thru Youth extracts ACCURATELY and is thrown away ---
`art-thru-youth` is the set's only `vision-only+lowleg` entry, and the manifest recorded it as
"a real hard-stop case ... the app correctly refuses to extract". That is not what happens.

Run through the API, the extraction is essentially perfect against the source image:
  Input 3 / Activities 3 boxes (split to 7 items by EXTRACTION RULES 1 granularity) /
  Output 1 / Outcome 3 -> generalOutcomes / Impact 3 boxes (split to 4)
Every string matches the source exactly. Zero inventions. The Outcome column has no time-horizon
label and went to `generalOutcomes` rather than being guessed into short/medium/long — COLUMN
FIDELITY 7, correct. And the source's own typo "Suport working families" is preserved verbatim,
which is the never-repair rule working on a real typo in the hardest variant in the set.

Then the app discards it. The chain:
  fileService.ts:1530  warns "This image is 1024px wide, which is low resolution for a dense
                       logic model, so small text may be misread. Verify the extracted wording
                       against the original."
  types.ts:235         bundleImpliesLowLegibility matches /low[- ]resolution/i -> true
  extractionFidelity   `if (L && N >= 6)` -> confidence = 'low', blocker lowLegibilityDense
  App.tsx:531          shouldHardStopExtraction -> status 'error', result UNDEFINED

So ANY uploaded image under the px threshold that extracts 6+ items is discarded, unconditionally
and regardless of how good the extraction is. Note the warning text itself asks the operator to
"verify the extracted wording against the original" — that is a REVIEW instruction, and the code
escalates it to a refusal.

Fair to the gate: this document is not stable. Three runs gave 18, 17 and 13 items, so its recall
genuinely varies and the underlying worry is not baseless. The problem is that `L && N >= 6`
measures nothing about the extraction — it cannot tell a perfect run from a poor one, and since
session 9 removed item-level flagging it no longer has any signal that could.
                                                                                | cause: setup

This is the `+lowleg` answer session 4 asked for. The variant does not fail at extraction. It
fails at the gate.

--- Finding 2: CORRECTION — item counts DO move run to run ---
Session 10 Finding 3 said "every unstable case is grouping ONLY ... nothing is being gained or
lost between runs", and I told the owner that recall and invention therefore would not
contaminate a random-sample correctness check. At 12 documents that is FALSE:
  Harlem Lacrosse      38 vs 49 items   (an 11-item swing)
  Cub Reporter        111 vs 113
  Art Thru Youth       17 vs 13
Recall moves, materially, on some documents. The claim was made on 7 documents where it happened
to hold, and the next five broke it.                                             | cause: other

--- Finding 3: the census's own 2-pass verdict is noisy ---
Between the 7-document census and this one, with NO prompt change:
  Oxford Circle   STABLE byte-identical  ->  UNSTABLE
  Trinity         UNSTABLE               ->  STABLE byte-identical
A 2-pass census classifies a document from a single pair, which is exactly the n=1 problem this
tool was built to catch in others. `--passes=3` or more is needed before a per-document verdict
should be trusted; 2 passes detects instability but cannot confirm stability.

--- Census, 12 documents (stable 6 / unstable 6) ---
  Core Reporter       vision+text    45/45   STABLE byte-identical  (stable in every census so far)
  FirstHand           text-only      45/45   STABLE byte-identical
  Trinity             vision-only    53/53   STABLE byte-identical
  YMCA Teen Workforce docx           29/29   STABLE byte-identical
  YMCA Youth Civic    docx           18/18   stable items
  SEAMAAC             vision+text    33/33   stable items
  Oxford Circle       vision+text    44/44   UNSTABLE (grouping)
  Performance Garage  text-only      46/46   UNSTABLE (grouping)
  BioEYES             vision-only      6/6   UNSTABLE (grouping)
  Cub Reporter        vision+text   111/113  UNSTABLE (item count)
  Harlem Lacrosse     vision+text    38/49   UNSTABLE (item count)
  Art Thru Youth      vision-only+lowleg 17/13 UNSTABLE (item count)

Only Core Reporter has been stable in every census run. Instability is spread across every
variant, which supports session 10 Finding 2 (document-specific, not variant-specific).

--- Actions taken ---
- Bundles captured for art-thru-youth, harlem-lacrosse, ymca-youth-civic-engagement,
  seamaac-urban-arts, and a new entry ymca-teen-workforce (sibling of youth-civic from the same
  partner, same house format — a difference between them is attributable to content, not layout).
- No prompt change, no code change. Finding 1 is a code issue and is written up, not fixed.

--- Next ---
1. DECIDE on the low-legibility gate (Finding 1). Options: drop the hard stop to a warning-plus-
   review flag, raise the px threshold, or gate on something that actually measures the
   extraction. Currently it discards good work on a document class that extracts well. This is
   an owner decision, not a prompt tweak.
2. Re-run the census with --passes=3 before trusting any per-document verdict (Finding 3).
3. Human Pass 1 for the completeness rate — still the missing number, and Finding 2 makes it
   more urgent, not less.
4. Remaining bundles: philadelphia-ballet, a-new-dawn.

--- Notes ---
Two claims of mine were corrected by the same batch that produced them: "the app correctly
refuses Art Thru Youth" (it refuses a good extraction) and "recall does not move between runs"
(it moves by 11 items on Harlem). Both were stated on smaller samples than the ones that broke
them. The pattern is consistent enough to be worth naming: on this project, a result from fewer
than ~10 documents has repeatedly failed to survive the next five.
```

---

## Session 12 — low-legibility warns instead of discarding

```
Date:                     2026-09-20
Operator:                 owner decision; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.2 (unchanged — this is a CODE change)
Gemini calls:             0

--- The decision ---
Owner: "I don't want it to discard good work. I just want it to flag it clearly as a warning."

--- The change (shared/extractionFidelity.ts) ---
`low` confidence is now reserved for "there is nothing worth showing the operator": the model
abstained, or no content came back (plus the non-verbatim-ratio arm, kept inert but intact in case
the session-9 flagging decision reverses). Low legibility no longer reaches it.

Removed from the `low` branch:  (L && N >= 6),  (status === 'partial' && L),
                                (L && N >= 6 && ratio >= 0.25)
Added to the `medium` branch:   L   (was `L && Vf >= 1`, dead since session 9 removed Vf)

That gives low legibility the same non-severe ceiling already documented in this file for
mismatch, unknown-layout and the document-type self-report: it can push ok -> partial/medium and
raise a blocker, never hard-stop. Blocker copy rewritten from "transcription is not reliable
enough to continue" (announces a refusal) to "Low-resolution source — small text may be misread.
Check every item against the original before using this extraction" (tells the operator what to
do), matching what the conversion warning in fileService.ts already asks for.

--- Verified on the actual document ---
art-thru-youth's real extraction through the changed rollup:
  bundle low-legibility:  true
  status/confidence:      partial/medium
  hard stop (discarded):  false      <- was true
  warning banner shown:   true
  QA label:               Needs Review
  blocker:                "Low-resolution source — small text may be misread. Check every item
                           against the original before using this extraction"
  items surviving:        18         <- was 0

--- Tests ---
Three tests asserted the old behaviour by name ("forces low", "low hard-stop") and were rewritten
to pin the new contract rather than deleted, each carrying why. Added one boundary test that
abstained and no-content STILL hard-stop, so a future change cannot quietly turn `low` into a
general doubt level again. 219 tests, all passing.

--- What this does NOT fix ---
art-thru-youth still returns 18/17/13 items across runs. The recall instability is real and
untouched; what changed is that a document with that profile is now shown-with-a-warning rather
than deleted. The gate never measured extraction quality and still does not — it now fails in the
direction that loses less.                                                        | cause: setup

--- Next ---
1. Human Pass 1 for the completeness rate.
2. Census with --passes=3 before trusting per-document verdicts (session 11, Finding 3).
3. Last two bundles: philadelphia-ballet, a-new-dawn.
4. Random-sample correctness run.
```

---

## Session 13 — plain-language pass on operator-facing flags

```
Date:                     2026-09-20
Operator:                 owner request; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.2 (unchanged — UI/copy + docs only)
Gemini calls:             0

--- The ask ---
Owner: make the flags and metadata plain enough that someone unfamiliar with the codebase, or with
coding/NLP vocabulary, can tell what is being said.

--- What was NOT changed, and why it matters ---
The coding CSV header row is an INTEGRATION CONTRACT, not a style choice. docs/specs/
export-for-coding.md names a downstream consumer (Qualitative Outcomes Coder) that "rejects
uploads without an outcome-text column alias", and every previous change to this file was appended
specifically so existing column positions stay stable.

So `outcome_text` stays, even though it is the single most confusing name in the file: it holds
the text of EVERY row, including Inputs and Activities, so a coder reading an Inputs row sees its
text under a column called "outcome_text". Renaming it would have been the obvious "fix" and would
have broken the downstream tool. Documented instead.        | cause: other

--- What changed ---
1. FIDELITY_BLOCKERS rewritten in plain language. These are the primary operator-facing strings —
   they appear in the amber banner, as the one-line reason beside a flagged file, and in the
   extraction log. Out went "Model abstained from extraction", "Layout/label mismatch — review
   unmapped items", "Layout family unknown", "Share of items flagged non-verbatim is high". In
   came sentences that say what happened to the document and what to do:
     "The AI could not read this document well enough to extract anything from it"
     "Some content did not fit any of the standard columns and was put under \"Unmapped\" —
      check whether it belongs somewhere"
     "The layout of this document could not be worked out, so items may have ended up in the
      wrong columns"
   A comment on the constant now states the rule: no schema words, no NLP words, no "the model".

2. The editor banner no longer prints internal enum values. It said "Extraction fidelity —
   partial · medium confidence", which is three pieces of jargon in six words. It now says
   "Check this against the document before exporting" over a sentence explaining why, with the
   specific reasons listed beneath.

3. SessionFileList stopped echoing `extractionStatus`/`extractionConfidence` as a fallback reason
   ("Extraction partial · medium confidence"). The exact values are still in the extraction log,
   where an analyst wants them; the file list now says "Worth checking against the document before
   exporting".

4. formatHardStopMessage: "Extraction stopped: ..." -> "Could not extract this document. ...".
   A first draft lowercased the blocker's first letter to make the sentence flow; dropped, because
   it would mangle any reason starting with a proper noun for no real gain.

5. export-for-coding.md gains a plain-language glossary of every column, explicitly including why
   `outcome_text` is named that and what it really contains. Also states that "Needs Review" does
   not mean the extraction is wrong — it means an automatic check was uneasy — which is the most
   likely misreading of the whole file.

--- Tests ---
Two tests pinned the old copy: one asserted the word "stopped", one matched a blocker with
/low-resolution/i (which no longer matched once the copy dropped the hyphen). Both rewritten —
the blocker test now asserts against the FIDELITY_BLOCKERS constant rather than a copy-shaped
regex, so future wording changes do not re-break it. 219 tests passing.


--- Addendum (same session): full-CSV header rename ---
Owner asked to "change the outcome_text column in the total extract csv and only keep it in the
export for coding csv". Checked first: `outcome_text` appears in exactly ONE file already
(services/codingExport.ts). The full extract CSV built in App.tsx has always called that column
`Content`. So the separation asked for already held — but the underlying point stood, because
`Content` is vague and several neighbouring headers were schema jargon.

The full CSV has no downstream consumer (it is the app's own dump, read by a person) and
`shared/exportRoundtrip.ts` operates on row OBJECTS rather than parsed headers, so its header row
is free to rename. Renamed:
    Domain                  -> Logic Model Column
    Content                 -> Item Text
    Source Note             -> Uncertainty Note
    Source Header           -> Sub-heading In Source
    Mapped By               -> Placed By
    Mapping Confidence      -> Placement Confidence
    Mapping Note            -> Placement Note
    Extraction Blockers     -> Review Reasons      (they no longer block anything — session 12)
    Mapping Corrections JSON-> Placement Changes (JSON)
A first pass called the blockers column "Warnings", which collides with the separate
conversion-warnings concept in ProcessingFile; "Review Reasons" pairs with the QA Status column
sitting beside it.

The two CSVs are now deliberately named on DIFFERENT rules, and a comment in App.tsx plus a table
in export-for-coding.md say so, because the obvious future "cleanup" is to unify them and that
would break the coder intake.

Owner then approved dropping them. `Needs Review` and `Uncertainty Note` are gone from the FULL
CSV (22 columns -> 20). Verified safe before deleting rather than assumed: both derive from
`itemNeedsReview`, which reads `verbatim` / `sourceNote` — fields the prompt stopped asking for in
2026-09-20.2 — so both were `''` in every row by construction, and `shared/exportRoundtrip.ts`
never reads either back during reconstitution, so nothing lossless-round-trip depends on them.
`GranularExportRow` deliberately still carries both, so reinstating item-level flagging means
restoring the prompt instruction and two lines in App.tsx, nothing else.

The coding CSV's `needs_review` was left in place and is NOT dropped. Removing a column from the
middle of that file shifts four others left, and its spec's own convention is append-only
("added X column (appended, so existing column positions are unchanged)") precisely to avoid that.
The spec also says the coder "ignores unknown cols", which implies it reads by header name rather
than position and would therefore probably tolerate a removal — but that is an inference about a
system this repo cannot test, so it stays until someone confirms against the real consumer.

LATENT RISK worth naming: the full CSV's header list and its row-value list are two parallel
arrays in App.tsx with nothing asserting they stay the same length. A mismatch silently shifts
every column right of the error. Checked by hand this time (20 and 20, correctly paired). Worth a
test if the header list is ever moved somewhere importable.

--- Notes ---
The internal extraction log (EXTRACTION_LOG_HEADERS) was deliberately left technical. Its own
header comment says "Not partner-facing" — it exists for batch analysis, and `prompt_variant` /
`non_verbatim_items` are the right names for that reader. Plain language is for the surfaces an
operator sees, not for every string in the codebase.
```

---

## Session 14 — futureproofing: turn the session's own mistakes into executable checks

```
Date:                     2026-09-20
Operator:                 owner request; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.2 (unchanged — code + tests only)
Gemini calls:             0

--- The ask ---
Owner: "take whatever steps we can to futureproof against these types of issues."

The class of issue, taken from what actually went wrong in sessions 11-13 — including the parts
this session caused:
  a. Two parallel arrays (CSV headers, CSV row values) with nothing tying them together. Editing
     one and not the other silently shifts every column to its right.
  b. A contract header that LOOKS like a mistake (`outcome_text` on an Inputs row) and invites a
     well-meaning rename that would break the downstream consumer.
  c. Tests that pin COPY rather than behaviour — two broke in session 13 purely because wording
     changed (/low-resolution/i stopped matching when a hyphen went away).
  d. Schema fields quietly going dead and shipping as permanently blank CSV columns.
  e. Jargon drifting back into operator-facing strings once the plain-language pass is old news.
Comments already existed for (a) and (b) and prevented nothing. The fix has to be executable.

--- What was built ---
1. shared/exportColumns.ts — FULL_EXPORT_COLUMNS pairs each header with the row field it reads, as
   ONE list. App.tsx now does `FULL_EXPORT_HEADERS` and `exportRows.map(fullExportRowValues)`
   instead of maintaining a second array. (a) is no longer a bug you can write.
2. INTENTIONALLY_UNEXPORTED — row fields deliberately left out, each with a reason. A test asserts
   every field is either exported or listed here, so (d) becomes a build failure with a prompt to
   decide rather than a blank column nobody notices.
3. The test's probe row is typed `Record<keyof GranularExportRow, string>` rather than cast, so
   adding a field to the row type is a COMPILE error until someone decides where it goes. A first
   draft used `as GranularExportRow`; tsc rejected it, and the type-safe version turned out to be
   the stronger guard — worth remembering that the cast was the weaker idea.
4. A jargon lint over the full CSV's headers and over every FIDELITY_BLOCKERS string: banned
   schema/NLP words, no snake_case, no "the model", a minimum length so a blocker actually says
   something. Guards (e). It has one deliberate exception — "logic model" is the domain term its
   readers use daily, so the check strips that phrase before looking for "model". The first
   version failed on "Logic Model Column", which is exactly the false positive that gets a lint
   deleted; made precise instead of weakened.
5. The coding CSV header test renamed to "...matches the coder intake contract", with a comment
   explaining that `outcome_text` reads wrongly ON PURPOSE and a failure message that says "the
   question is not what is the new header row, but did the consumer change? Do not update the
   expected string to make it pass." Guards (b).

--- Each guard was verified to actually fire ---
A test that cannot fail is worse than no test, so each was broken on purpose:
  drop an exported column without excusing it  -> test fails
  rename a header back to "Mapping Confidence" -> test fails, naming the banned word
  add a field to GranularExportRow             -> compile error naming the field
(The first check initially looked like it had NOT fired — it had; `assert.deepEqual` renders its
message as a multi-line block and the grep pattern only matched single-line ones.)

236 tests, all passing. No prompt change.

--- What is still not guarded ---
- Item-level flagging can go dead again the same way (d) happened: the prompt stops asking for a
  field and nothing connects that to the exporters. The INTENTIONALLY_UNEXPORTED list documents
  the two casualties but nothing detects a NEW one automatically.
- The census's own noisy 2-pass verdict (session 11, Finding 3) is unchanged — `--passes=3` is
  still a thing a person has to remember to type.


--- Addendum (same session): the census no longer over-claims ---
Session 11 Finding 3 recorded that a 2-pass census verdict is noisy and that `--passes=3` is
needed before trusting it — and then left that correction living in a person's memory and this
log, which is precisely the failure mode the rest of this session was closing.

scripts/stability-census.ts now refuses to print STABLE below `--passes=3`. Two passes report "no
differences seen in 2 runs — NOT proof of stability", the marker is `?` rather than `=`, and the
summary lists those documents with a prompt to re-run. Default stays 2, because 2 passes are the
cheap way to FIND instability and the problem was never that they exist — it was the tool
reporting them as more than they are. Every verdict now carries its run count.

THE CHANGE DEMONSTRATED ITSELF, UNPLANNED. Verifying the new wording on Performance Garage — a
document unstable in EVERY prior census, 0 of 3 pairs — it produced two matching runs. Under the
old wording that would have printed "STABLE — byte-identical" and been wrong. Given a third pass
it then produced three matching runs and earned the word STABLE under the new rule too.

So `MIN_PASSES_FOR_STABLE = 3` is a floor for the word being allowed, not a standard of proof, and
the summary line was changed from "proven stable N" to "held across N runs N" on the strength of
that observation. No pass count proves stability; more runs only narrow the window a flip can hide
in. The honest fix was to make every claim carry its sample size rather than to pick a threshold
and call it settled.                                                              | cause: other

--- Notes ---
Every guard here encodes a mistake that was actually made in the last three sessions, two of them
by this session. That is the right selection criterion: not "what could go wrong in principle",
but "what did go wrong, and would go wrong again".
```

---

## Session 15 — text-only stops being told to look at images (PROMPT_VERSION 2026-09-20.3)

```
Date:                     2026-09-20
Operator:                 owner request; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.2 -> 2026-09-20.3
Gemini calls:             7 (two 3-pass censuses + 1 inspection)

--- The defect ---
Session 5 Finding 5c recorded that only `inputTracksSection` and `colourAndEmphasisSection` take
`isVision`; every other section keys off `hasTextTrack` alone, which is TRUE for a text-only
document. So a document with no images at all was being told:
  "You may receive multiple images for one document: full pages, slides, and/or zoomed
   single-column crops..."
  "Set `sourcePage` to the document page number from the image label"
  "Ignoring Track A for exact wording or ignoring Track B for colour/layout"
  "Track A often preserves this prose more reliably than a dense grid image"
Not inefficiency — instructions that cannot be followed, in a prompt whose own rulebook says
rules compete for attention.

--- The change ---
PHASE A step 0, SOURCE LOCATION, the KNOWN FAILURE MODES Track B line and the CONTEXT & OVERVIEW
"dense grid image" clause are now gated on `isVision`. Text-only gets replacements that describe
what it actually has:
  step 0  -> "Reading order is your only layout signal. You receive text, not pages. Column
              position, row bands and colour are simply absent — do not infer them."
  SOURCE  -> "omit `sourcePage` and `sourceColumn`. There are no page images to locate an item on,
              and a page number inferred from text order is a guess."

--- Verified surgical ---
All four VISION variants: 0 characters changed — byte-identical before and after. Text-only:
-497 chars (with text track), -292 (without). All five image-language probes now absent.

--- Measured ---
  FirstHand   text-only   45/45/45   STABLE across 3 runs
  Perf Garage text-only   44/44/46   UNSTABLE — unchanged
  sourcePage now correctly omitted on text-only items (was being guessed).
Performance Garage was NOT expected to improve and did not. Session 10 established its
instability is document-specific — its band labels sit inside the leftmost shape with no
positional information to attach them elsewhere — not a property of the text-only variant, which
FirstHand demonstrates by being stable in the same variant.        | cause: prompt

--- Notes ---
This is the first prompt change made purely for correctness rather than to chase a quality metric,
and the cleanest to verify: "did the variants that should not change, change?" answered by a
character count. Worth reusing as the shape of a safe prompt edit.
```

---

## Session 16 — unmapped accepts unlabeled content (PROMPT_VERSION 2026-09-20.4)

```
Date:                     2026-09-20
Operator:                 owner request; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.3 -> 2026-09-20.4
Gemini calls:             5

--- Why ---
The rule read "`unmapped` only for clearly non-standard LABELED sections". So content that fits no
column but HAS a heading had a home, and content that fits no column and has NO heading — loose
prose, a sidebar, an unlabeled box — had none. It was neither a domain nor unmapped. That is the
likeliest site of silent omission, which matters because completeness is the one dimension never
measured here (invention is 0 of 204; completeness is unknown).

--- The change ---
Unlabeled substantive content now goes to `unmapped` with a group name describing where it sits
("Unlabeled — sidebar right of the grid"). Explicit counterweight: page furniture is excluded by
name — titles, organization names, logos, page/slide numbers, headers, footers, decorative
captions, a colour key already in `colorLegend`. The trigger is perceptible per working-agreement
point 3: a model can see whether text has a heading and whether it sits under a column.
+820 chars on every variant. Budget came from .2 (-1,300) and .3 (-500).

--- Result: no harm observed, benefit UNPROVEN ---
Three prose-heavy documents (Harlem Lacrosse, YMCA Youth Civic, Trinity):
  - NO page furniture appeared. The exclusion held. That was the risk and it is controlled.
  - Every unmapped group that DID appear is still a labeled section (WHO WE ARE, OUR METRICS,
    Problem Statement, SITUATION / NEED...). The new unlabeled path did not visibly fire.
  - Trinity unchanged at 53/53; tests 236 passing.
So this is insurance whose payout has not been observed. Either these documents have no unlabeled
orphan content, or the rule is not landing — and those cannot be told apart without reading the
sources. Kept rather than reverted because the gap in the old rule was real and the measured cost
is zero, but it should NOT be counted as a win until a completeness pass says so. | cause: prompt

--- Finding: the NESTING fold breaks on paragraph-length parents ---
Harlem Lacrosse's OUR APPROACH came back as 19 items, each carrying ~200 characters of repeated
parent text:
  "WE COACH STUDENTS. We provide safe spaces where middle and high school children can find
   belonging, take risks, make mistakes, and achieve progress by practicing and playing
   lacrosse. — Authentic relationships with students and families"
...and three more items repeating that same paragraph, then five repeating the next one.

This is NESTING rule 8 working exactly as written — "prefix the parent onto each of its children"
— and the result is bad. The rule was designed against parents that are LABELS ("Student
Publications", "Academic Skills"), which are short. When the parent is a sentence or a paragraph,
folding duplicates it once per child and bloats every row.

NOT fixed here: one themed change per batch, and 2026-09-20.4 is already spent on unmapped. Also
worth noting the blast radius is smaller than it looks — `unmapped` reaches the full CSV but NOT
the coding CSV — though the same fold would do this inside a real domain too.
Candidate fix for next batch: fold only SHORT parents; a parent longer than a label becomes its
own group name instead, so the text appears once rather than N times.      | cause: prompt

--- Next ---
1. Fix the paragraph-parent fold (above).
2. Human completeness pass — now doubly motivated: it is the only thing that can say whether the
   unmapped widening does anything.
3. Full census at --passes=3 once the above settle.
```

---

## Session 17 — the nesting fold now distinguishes a label from a paragraph (2026-09-20.5)

```
Date:                     2026-09-20
Operator:                 agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.4 -> 2026-09-20.5
Gemini calls:             2

--- The defect (found session 16) ---
NESTING rule 8 said: a bulleted label that has sub-bullets is not a group — prefix it onto each of
its children. That was written against parents that are LABELS ("Student Publications", "Academic
Skills"), which are short. Harlem Lacrosse has parents that are PROSE, and the rule did exactly
what it said: OUR APPROACH came back as 19 items, each carrying the same ~200-character sentence.

--- The change ---
Rule 8 now splits on what the parent IS, which is a perceptible distinction (working-agreement
point 3) in a way a character count would not be:
  - a SHORT LABEL (a few words, reads as a heading) -> prefix onto each child, as before
  - a SENTENCE or PARAGRAPH (has a verb, reads as prose) -> emit ONCE as its own item, immediately
    before its children, and leave those children unprefixed
Rule 9 gained the matching carve-out: it forbids a bare parent ALONGSIDE prefixed children (the
same text twice), which a prose parent with unprefixed children is not.
`shared/nestingConsistency.ts` needed no change — its check looks for a child that STARTS WITH the
parent's text, and unprefixed children do not.

--- Measured on Harlem Lacrosse ---
That section's content, before and after:
  2026-09-20.4:  20 items,  5,588 chars, longest 872   <- the same paragraph 4-5 times each
  2026-09-20.5:   4 items,    829 chars, longest 749   <- each paragraph once
An 85% reduction in characters for the same content, and the model went further than the rule
required: rather than leaving the section in `unmapped`, it promoted each prose parent to a GROUP
NAME and routed the whole block into `activities`:
  "WE COACH STUDENTS."x5 | "WE MOTIVATE ACADEMIC SUCCESS."x6 | "WE EMPOWER YOUTH AUTONOMY."x7 |
  "WE BUILD EQUITABLE SYSTEMS."x5
Checked explicitly for the opposite failure — trading duplication for omission — and all four
descriptive paragraphs are present, once each, inside their own group. Total items 46 -> 53.
                                                                                | cause: prompt

--- Caveat ---
Harlem Lacrosse is one of the UNSTABLE documents (38/49/46/53 across runs), so the item-count
change is not cleanly attributable. The structural change is: 20 duplicated items became 4
unduplicated ones, which is not something run-to-run variation produces.

--- Next ---
1. Human completeness pass (unchanged, still the missing number).
2. Full census at --passes=3 now that .5 has settled.
3. Owner offered fresh logic models — most valuable as a RANDOM sample, since the existing set is
   chosen-not-sampled and cannot produce a rate.
```

---

## Session 18 — what to do when there is no grid (2026-09-20.6) + the flag says its consequence

```
Date:                     2026-09-20
Operator:                 owner question; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.5 -> 2026-09-20.6
Gemini calls:             5

--- The owner's observation ---
Looking at the Harlem Lacrosse result: "the app is taking content it finds and then placing it
into the logic model domain the app thinks it SHOULD belong to. The Harlem Lacrosse document is
not actually a logic model. It is a theory of change." Torn between rejecting such documents and
flagging them.

--- Decision: flag, not reject ---
Four reasons. (1) The structural safety net already held — Harlem contributed ZERO rows to the
coding CSV, because that export is outcomes-only and Harlem produced no outcomes. (2) Rejecting
destroys real content from a real program document. (3) DOCUMENT TYPE CHECK already decided this
deliberately, off two brochures that silently returned confident extractions: "Do not abstain just
because the document isn't a clean logic model grid". (4) Partners send what they have.

--- Change 1 (code): the flag states its consequence ---
"Possibly Not a Logic Model" hedges and omits what follows from it. Now:
  "Not a logic model — the app sorted these items into columns; the document did not label them"
The rule behind it needs no new field: when `documentTypeAssessment` is anything but `logic_model`,
every domain assignment in that document is the app's categorization, not the document's labelling.

A hypothesis tested and DISPROVED on the way: that per-item `sourceHeader` could distinguish "read
from a column header" from "assigned by the model". It cannot — Core Reporter's activities items
carry sourceHeader "Program Delivery" and Harlem's carry "WE COACH STUDENTS.", and nothing
separates a domain read from a header from one inferred. The distinction is genuinely
document-level, which is why it is expressed there.                              | cause: other

--- Change 2 (prompt): WHEN THERE IS NO GRID ---
The owner's follow-up — "this suggests the prompt should be adequately prepared to make good
decisions about how to categorize items" — is right, and the gap was sharper than it sounds. The
placement doctrine was ENTIRELY positional: GOAL says "column headers and row bands beat
semantics, never reclassify an item because it sounds like an outcome"; rule 5 says a bullet
belongs to the column whose header sits above it. For a Theory of Change there are no headers, so
there is no position — and the only remaining instruction was "extract any content that genuinely
maps, best effort". The prompt offered no method AND forbade the only one available.

Added a scoped fallback: when and ONLY when a source has no column headers, decide by what an item
IS — a resource the program has (inputs), something it does (activities), a countable product
(outputs), a change in people served (outcomes, to `generalOutcomes` unless a horizon is stated),
the aggregate change (impact) — and everything that answers none of those to `unmapped`. The GOAL
now cross-references it so the two rules cannot compete.

--- Result: safety property VERIFIED, benefit UNPROVEN ---
The main risk was this section pulling items out of real labeled columns. It does not: Core
Reporter came back byte-identical in structure — inputs 15, activities 8, outputs 7, short 6,
medium 5, long 4, same group names. The fallback correctly did not fire where a grid exists.

On Harlem itself, no demonstrable effect, because the document is bistable on exactly this question:
  .6 run 1:  unmapped=54
  .6 run 2:  activities=23  unmapped=27      (which is what .5 did)
The model genuinely cannot decide whether "WE COACH STUDENTS. We provide safe spaces..." is an
activity or narrative. That ambiguity is real rather than a defect, and it is precisely what the
new flag now warns a reader about.                                               | cause: prompt

--- Worth naming: two consecutive prompt changes with unproven benefit ---
.4 (unmapped accepts unlabeled content) and .6 (no-grid fallback) are both reasonable, both
verified not to break anything, and neither demonstrated to help. That is the instrument reaching
its limit, not laziness: the documents these changes target are the unstable ones, so a 2-3 run
comparison cannot resolve a modest effect. Completeness measurement is the thing that would.
Do not keep making prompt changes of this shape without it.

--- Next ---
1. Human completeness pass. Now blocking two unproven changes, not just an open question.
2. Random sample from the owner for an invention rate on unseen documents.
3. Full census at --passes=3.
```

---

## Session 19 — first random sample; `verbatim` is undefined but still gates the rollup

```
Date:                     2026-09-20
Operator:                 owner supplied a random batch; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.6 (unchanged — audit only)
Gemini calls:             4

--- The sample ---
Four documents supplied at random. This is the first batch drawn that way: every completeness
figure before it, including 119/119, came from the FIXTURE set, which was selected — mostly for
being interesting or for having previously failed. A rate measured on selected documents is not a
corpus rate. Full record in `docs/verification/2026-09-20-random-sample-batch-1.md`.

  PlayArts Play Loud        33 source items -> 33 extracted, 0 invented, 0 missed
  ArtWell We the Poets      18 grid + 3 scalar -> all present, 0 invented
  Lantern Illumination      33 grid + 3 scalar -> all present, 0 invented
  Your Voice Heard          not a logic model -> 0 grid items, 4 paragraphs kept in `unmapped`

  INVENTION 0 of 88 items.  COMPLETENESS 84 of 84 gridded items, 6 of 6 scalar fields.

Small sample that found nothing, and the denominator for "real logic model, fully read" is three.
A spot check, not a rate. The fourth document being a promotional one-pager is itself a finding
about what the corpus contains.

Three things the sample exercised that are worth keeping:
  - ArtWell is a School District template with its instruction text still in it. The extraction
    dropped the italic template prompts, the upload banner and the footer while KEEPING the one
    line the organisation wrote into the template box. Discarding boilerplate without discarding
    the answer written into boilerplate is the harder half of that.
  - Lantern encodes three program strands as fill colour across five columns with no printed key.
    All 33 items carry the right colour; `colorLegend` is correctly empty. Captured but not
    interpretable downstream — a limit of the source, not the extraction.
  - Your Voice Heard's page image renders one word as `prac t ced`; the extraction says
    `practiced`. That reads as a never-repair violation until you check the bundle, whose text
    track has the word intact. Track A supplying what Track B could not rasterise is what the
    dual track is for.                                                            | cause: none

--- Instrument error, caught before it was recorded ---
My flattener printed only group-bearing fields, so ArtWell's impact statement — stored in the
SCALAR `impactStatement`, not in the `impact` group — read as a miss. Fixed the flattener to print
scalars first.

Second time a weak instrument nearly produced a false finding (session 5's grouping claim was the
first), and the tell was identical both times: the finding was about something ABSENT, and absence
is exactly what a partial view manufactures. A claim that something is missing needs the
instrument checked before the claim is written down.                     | cause: audit-instrument

--- Finding: `verbatim` is undefined but still gates the rollup ---
2026-09-20.2 (session 9) removed every instruction defining `verbatim`, after measuring that
item-level flagging fired about once in 640 items. Two consumers were left wired up:

  1. `server/geminiLogicModel.ts:26` still declares `verbatim: { type: Type.BOOLEAN }` in the
     response schema — Gemini is still ASKED for it, with nothing telling it what it means.
  2. `shared/extractionFidelity.ts:193` still counts `verbatim === false` into `nonVerbatim`.
     Line 290 turns that into `ratio = nonVerbatim / total`; line ~360 pushes `highNonVerbatim`
     at `N >= 6 && ratio >= 0.4` and `nonVerbatimShare` at `>= 0.15`. That ratio is an input to
     `extractionConfidence`, and since session 12 `low` means "nothing worth showing".

So an undefined field the model now fills in on its own recognisance is still wired into the gate
that decides whether a document is displayed.

Why it has not bitten: measured across every arm on disk, `verbatim` comes back `true` on 100% of
items (88 of 88 in this sample, `false` nowhere). Ratio is always 0, both blockers are dead in
practice. It has not bitten because the model happens to answer `true` to a question nobody asks
it — not because anything prevents it answering `false`.

This is the SAME defect as withdrawn version 2026-09-19.3, reached from the other side. That
version was withdrawn unrun for defaulting `verbatim` to `false`, on the grounds recorded at
`constants.ts:267`: "`verbatim: false` is not just a note to a human, it is the input to the
fidelity rollup." The reasoning was right and the consumer is still there. I removed the
definition and left the consumer.

Also wrong and needing correction either way: `exportColumns.ts` `INTENTIONALLY_UNEXPORTED` says
`needsReview` was "blank in every row" because "the prompt stopped requesting" these fields. The
outcome is right; the mechanism is not. The schema still requests them and the model still
answers.                                                                 | cause: orphaned-consumer

--- Not fixed in this session ---
Three plausible shapes (drop the schema field; keep it and re-define it in the prompt; keep it and
stop the rollup reading it), one themed change per run, and the choice is the owner's.

--- Next ---
1. Decide the `verbatim` question above.
2. More random batches — n=3 real logic models is a spot check, not a rate.
3. Full census at --passes=3.
```

---

## Session 20 — random sample batch 2; four findings, none of them extraction quality

```
Date:                     2026-09-20
Operator:                 owner supplied a second random batch; agent session (claude/loving-hawking-r436g3)
Prompt version:           2026-09-20.6 (unchanged — audit only)
Gemini calls:             5

--- The sample ---
  Philadelphia Ballet   16 -> 16, 0 invented, 0 missed
  Achieve Now           52 -> 52, 0 invented, 0 missed
  Rock School           63 -> 63, 0 invented, 0 missed  (audited against Track A; see below)
  1812 Productions      36 -> 36, 0 invented, 0 missed
  Mamadele Foundation   80 -> 80, 0 invented, 0 missed

  INVENTION 0 of 247.  With batch 1: 0 INVENTIONS IN 335 ITEMS ACROSS 9 DOCUMENTS.

Full record in `docs/verification/2026-09-20-random-sample-batch-2.md`.

--- The instrument got fixed before it cost a fourth false finding ---
Sessions 5, 19 and 20 each nearly recorded something ABSENT that was present: a single-line grep
vs multi-line output; a flattener walking only group-bearing fields; an exact-substring search vs
a text track with hard line breaks mid-phrase. Same failure every time, and the tell is always
the same — absence is what a weak instrument manufactures.

`coverage.mjs` now normalises whitespace and quotes on BOTH sides and checks items AND scalars
against Track A. It cut 247 items down to 9 strings needing eyes; all 9 were correct behaviour.
A miss there is not an invention, it is an instruction to look at the image.  | cause: audit-instrument

--- Rock School: the dual track earning its keep at the limit ---
ALL FIVE of its page images are unreadable mojibake — the document's font failed to map, so
Track B contributed literally nothing. 63 items came from Track A alone. Two of them are phrases
the source splits across a page boundary with ~1,400 characters of unrelated column text between
the halves ("An improved growth" + "mindset, increase in tenacity, confidence, and curiosity";
"Social emotional learning" + "through community and citizenship") and both were correctly
reassembled. Achieve Now supplied the same lesson in miniature: one box is pure mojibake in the
image and the real string came from Track A.

The system degraded to text-only behaviour without being told to, and said so with a warning.
That is the architecture working.                                                 | cause: none

--- Achieve Now: never-repair on a case where repairing would look like an improvement ---
The source genuinely reads "Hjgh rate of volunteer retention". The extraction preserved the typo.
It also declined to emit an orphan fragment ("Financial / - / Students have a") that sits in the
PDF text layer but appears nowhere on the visible page.                           | cause: none

--- Mamadele: the hardest grouping case so far, handled exactly right ---
A 6x6 matrix whose ROWS are core values and whose COLUMNS are logic-model domains. All six row
bands became group names inside all six domains; 80 items, no losses; "Intermediate-Term
Outcomes" read as mediumTermOutcomes; diacritics kept; and no program name invented from the
filename even though the filename carries one.                                    | cause: none

--- FINDING 1: DOCX text tracks carry base64 image payloads ---
1812's Track A is 38,994 chars, of which 33,837 — 87% — are `data:image/...;base64` blobs and
Google-hosted image URLs. That is ~8,400 tokens of noise on every extraction call for that
document. Root cause: `mammoth.convertToHtml` inlines embedded images as data URIs and Turndown
renders them into the Markdown (`services/fileService.ts:879`); nothing strips them.

Base64 cannot be read as text by any model, and the same images already go as Track B rasters, so
this is pure waste with no information loss from removing it. It is also the first concrete,
measurable answer to the owner's question about making the prompt more economical — and it is not
in the prompt at all.                                                            | cause: setup

--- FINDING 2: scalar fields are synthesised, not transcribed, and nothing records it ---
1812's `targetPopulation` stitches a span of PROBLEM STATEMENT to a span of CONTEXT / RATIONALE
with connective words present in neither. ArtWell's and Philadelphia Ballet's were derived from
their impact statements. Four of nine documents.

Items carry `mappedBy` and `mappingConfidence`. Scalars carry nothing. A downstream reader
treating `targetPopulation` as quoted text would be wrong, with no way to know. Note this is not
a rule violation: "never add items" governs items, and these are scalars.        | cause: prompt

--- FINDING 3: WRONG AS FIRST WRITTEN — see session 21 for the correction ---
As published this said Rock School's warning was Gemini-authored, because it matched neither
FIDELITY_BLOCKERS.lowRes nor lowLegibilityPartial. It is an exact match for a THIRD constant I
never checked, FIDELITY_BLOCKERS.lowLegibilityDense — app-authored and vetted. I concluded
"the model wrote it" from two comparisons against a nine-entry object.

The mechanism is still real and unguarded (constants.ts:699 does ask Gemini for free-text
blockers; normalizeBlockers only trims/dedupes/caps at 4), but this batch is NOT evidence of it
firing. What survives is sharper for being an app string: our OWN wording names the wrong cause.
Rock School's pages are not low-resolution, their font failed to embed, and they are unreadable
at any DPI.                                                                       | cause: other

--- FINDING 4: nothing detects "images present but contributed nothing" ---
Rock School had 5 images, all useless, and was still handled as a vision extraction. There is a
`textOnlyFallback` concept for documents with NO images, but no signal for images that rendered
to garbage.                                                                       | cause: setup

--- Too small to act on alone ---
Achieve Now's Outputs hold two items with identical text ("Avg Student Gains"), identical group
("General") and identical every other field. In the source they sit in two different UNNAMED
boxes — 1:1-model metrics and small-group metrics. No sub-heading exists for the GROUPING GATE to
use, so the distinction survives only as row order.

--- Next ---
1. Pick among findings 1-4 and the open `verbatim` question from session 19. Finding 1 is the
   cheapest and most clearly correct.
2. More batches. 9 documents, 0 inventions — the invention question is looking answered; the
   completeness question is better served by harder documents than by more easy ones.
3. Full census at --passes=3.
```

---

## Session 21 — four findings resolved, `verbatim` retired, first full 3-pass census

```
Date:                     2026-09-20
Operator:                 owner deferred the decisions ("I defer to you on these items")
Prompt version:           2026-09-20.6 UNCHANGED throughout — none of this needed a prompt change
Gemini calls:             ~50 (1 base64 control, 4 Rock School controls, 36 census, 9 sample census)

--- What landed ---
1. Track A hygiene. `mammoth` inlines embedded images as data: URIs and Turndown rendered them
   into the text sent to Gemini. 1812: 38,994 chars -> 5,152, with readable content provably
   untouched (617 words before, 617 after, none lost, none gained) and the extraction unchanged
   at 36 items. Fixed at the DOCX converter AND in `assembleDocumentBundle`, the choke point every
   converter passes through, so the invariant holds for formats nobody has fixed yet.
   Cost of the bug: ~8,400 wasted tokens per call on any DOCX with a logo.       | cause: setup

2. `verbatim`/`sourceNote` out of the Gemini response schema, and the ratio they fed out of the
   fidelity gate. With nothing able to set them, every branch reading the ratio was dead code
   shaped like a guard — which is precisely what a previous audit of that same file removed once
   before. Four threshold tests replaced by the inverse guarantee: a flawless extraction with
   every item flagged must NOT be discarded.                                     | cause: setup

3. `server/geminiSchemaPrompt.test.ts` — the detector for this whole bug class. Every property of
   `baseItemSchema` must be defined in the BUILT PROMPT SNAPSHOT or listed as undefined-by-design.
   The snapshot is the oracle deliberately: `constants.ts` mentions `verbatim` seven times in its
   comment history while the prompt sent to Gemini defines it nowhere, so a source grep would have
   PASSED on the very bug this catches. Verified by re-adding the field and watching it fail.

4. Low-legibility wording. The per-page warning is accurate and scoped ("Page 5 of this document
   is a flattened image at low resolution"); the rollup blocker dropped the page number and
   restated it as a whole-document CAUSE. Now says which pages and what to do, and leaves the
   cause to the warning that measured it.                                        | cause: other

--- I GOT FINDING 3 WRONG AND PUBLISHED IT ---
Session 20 reported Rock School's warning as Gemini-authored because it matched neither
FIDELITY_BLOCKERS.lowRes nor lowLegibilityPartial. It is an exact match for lowLegibilityDense —
a THIRD constant I never checked. I concluded "the model wrote it" from two comparisons against a
nine-entry object, and shipped that conclusion to a doc, this log and a commit message.

Two checks would have caught it before publication, and both were cheap: compare against ALL the
constants, and grep the prompt for the string (it is not there, so Gemini could not have echoed
it). I did neither because the two-comparison result already agreed with the finding I expected
to write. Corrected in place rather than quietly edited away.                    | cause: audit-instrument

--- Findings closed WITHOUT building anything ---
FINDING 2 (scalars are composed, not transcribed) — real, measured at 4 of 9 documents, and
deliberately not fixed. These fields reach NO CSV: not the full export, not the coding export,
not the extraction log. The coding pipeline cannot be affected. Session 18 warned against more
prompt changes of unproven benefit, and this would be one. Recorded at the type definition, where
anyone adding them to an export will have to decide what a consumer is told.

FINDING 4 (nothing detects "images present but contributed nothing") — investigated, then
declined on evidence. The obvious signal, "a page has an image but no Track A text", fires on
9 of 14 documents; restricted to PDFs, where the probe is even meaningful, 2 of 12. BOTH are
false positives: Oxford Circle p2 is the complete grid, perfectly legible, read correctly by
vision at 44 items; Rock School p5 is a near-blank trailing page. The signal finds
VISION-DEPENDENT pages, not unreadable ones, and in that population healthy and broken look
identical. The real variable needs image-legibility assessment, i.e. OCR-scale work. Shipping the
proxy would have repeated the text-line-counting heuristic this codebase already removed for
being 3 for 3 false positives.

Worth naming: two of five findings were closed by measurement rather than code, and one of the
five was simply wrong. A finding is a hypothesis.

--- FIRST FULL CENSUS AT --passes=3 ---
The first run where the tool is permitted to print STABLE at all.

  HELD ACROSS 3 RUNS (8)          UNSTABLE (7)
  oxford-circle-carnell-frc  44   performance-garage    45/47/47   items
  healthy-newsworks-core     45   cub-reporter        144/133/133  grouping
  firsthand-pptx             45   harlem-lacrosse      54/54/54    grouping
  ymca-youth-civic           18   seamaac-urban-arts   33/33/33    grouping
  upenn-bioeyes               6   art-thru-youth       17/13/17    grouping
  ymca-teen-workforce        29   trinity-boys-girls   53/54/54    grouping
  sample-mamadele            80   sample-rock-school   63/62/62    grouping
  sample-achieve-now         52
  (2 untested: philadelphia-ballet-lets-dance, a-new-dawn — no source, never uploaded)

HALF THE CORPUS IS UNSTABLE UNDER AN UNCHANGED PROMPT. That is the number to keep in view: a
regression diff means nothing on seven of these fifteen documents without a same-prompt control.

Grouping is the dominant axis — 6 of 7 unstable documents differ in grouping, and three of those
(harlem, seamaac, and rock school's grid) have IDENTICAL item counts. But recall moves too
(cub-reporter 11 items, art-thru-youth 4), which is the session-10 retraction holding up.

Mamadele is the encouraging result: the hardest grouping case in the set — a 6x6 matrix whose row
bands must reappear as groups inside all six domains — came back BYTE-IDENTICAL three times. The
nesting work is robust there, not lucky.

Oxford Circle held at 3 passes after flipping STABLE/UNSTABLE at 2 in session 11, which is the
whole argument for MIN_PASSES_FOR_STABLE existing.

--- Manifest ---
Three batch-2 sample documents promoted to fixtures for failure modes nothing else covers:
rock-school (every page image unreadable — the Track A regression guard), mamadele (6x6 row
bands), achieve-now (mojibake cell recovered via Track A; the `Hjgh` never-repair guard). All
three were fully audited BEFORE promotion. Note for later: rates must be measured on fresh
documents, never on this set, which is now chosen-not-sampled by construction.

--- Next ---
1. Instability is the open problem, not invention. 0 in 335 items across 9 documents says the
   invention question is close to answered; 7 of 15 unstable says reproducibility is not.
2. Harder documents, not more clean grids — more mojibake, more non-logic-models, more matrices.
3. philadelphia-ballet-lets-dance and a-new-dawn still have no source file.
```

---

## Session 22 — batch 3, the first XLSX, and a reproducible short-term misroute

```
Date:                     2026-09-20
Operator:                 owner supplied a third random batch (incl. the two missing fixtures)
Prompt version:           2026-09-20.6 (unchanged — the one prompt fix found here is PROPOSED, not landed)
Gemini calls:             5 + 2 controls

--- The sample ---
  Philadelphia Ballet Let's Dance   prose report, not a logic model   49 items, 0 invented
  A New Dawn                        60 bullets -> 60                   0 invented, MISROUTED
  Educators of Colors 1865          17 -> 17                           0 invented, 0 missed
  Philadelphia Zoo (XLSX)           8 sheets -> 77 (60 real + 17 junk) 0 invented
  Greener Partners                  48 -> 48                           0 invented, 0 missed

  0 INVENTIONS IN 251 ITEMS. Cumulative: 0 IN 586 ITEMS ACROSS 14 DOCUMENTS.

Full record in `docs/verification/2026-09-20-random-sample-batch-3.md`.

--- The probe was narrower than the data. Again. Fourth time. ---
`a-new-dawn` first read 50/61, with outputs like "500 lbs. of produce grown and shared" apparently
absent. They were there, as "**500 lbs. of produce** grown and shared" — Markdown bold. The
extraction strips emphasis markers; my probe did not.

Four now: whitespace (s19), line breaks (s20), scalar fields (s19), inline markup (s22). Identical
every time — the extraction is right, the probe is narrower than the data, and a narrow probe
manufactures ABSENCE. `scripts/audit-coverage.mjs` now normalises escapes and emphasis on both
sides, with each clause carrying the session that forced it, so the next person adding one sees
the pattern rather than the symptom.                                     | cause: audit-instrument

--- FINDING: a STATED short-term horizon goes to generalOutcomes (3 of 3 runs) ---
A New Dawn labels its sections explicitly:

  4. SHORT-TERM OUTCOMES (3-12 months)  -> generalOutcomes     9 items   WRONG
  5. INTERMEDIATE OUTCOMES (1-2 years)  -> mediumTermOutcomes  7 items   correct
  6. LONG-TERM IMPACT (3-5 years)       -> longTermOutcomes   11 items   correct

`shortTermOutcomes` comes back EMPTY while both siblings populate. Three runs, identical split, so
this is deterministic — not the instability the census measures.

CAUSE. Rule 7 (constants.ts:401) carries a prohibition that names ONE field: "Never default
undifferentiated outcomes into `shortTermOutcomes` just because it's the first outcomes-shaped
field in the schema". Its escape clause is written purely in COLUMN terms: "Only use
shortTerm/mediumTerm/longTerm when the source itself actually distinguishes those three (separate
columns, or explicit per-item labels)". A New Dawn is prose — no columns, no per-item labels — so
the escape cannot fire and the prohibition does. Medium and long have no equivalent prohibition
attached, which is exactly why they route correctly. The asymmetry INSIDE ONE DOCUMENT is the
evidence; nothing about the document is ambiguous.

CONSEQUENCE, and not cosmetic. The coding CSV writes these as `General Outcomes`, which
services/codingExport.ts:21 defines as "No time horizon in the source — a coder assigns
short/medium/long-term during coding." The source says (3-12 months). A coder is being asked to
supply a horizon the document already stated.

This one EARNS a prompt change, unlike session 18's pair: reproducible failure, a mechanism that
explains the asymmetry, and a measurable downstream cost. Proposed to the owner, not landed — a
prompt edit is the one thing the working agreement reserves for explicit approval.  | cause: prompt

--- FINDING: the first XLSX is eight logic models in one file ---
The Zoo workbook holds EIGHT complete logic models, one per program, sharing a mission and column
headers but differing in inputs and activities. All merged into one extraction; `program` returns
"School and Community programs" while the file is named for one of the eight.

documentBundleSlicing.ts splits multi-logic-model uploads but matches `## Page N` / `## Slide N`
only, so `## Sheet:` bypasses it silently. Slicing also assumes page ranges and images, and XLSX
has neither. Did NOT build a sheet splitter on n=1; instead the bundle now states the fact the app
already knows — how many sheets there are and that they were read as one document. Same posture as
the low-legibility rewording: say what is true, do not guess.                      | cause: setup

Separately: 17 of 77 items are BARE NUMBERS (33, 43, 44, 77...) sitting in the Activities column
and in otherwise-empty rows — navigation anchors, almost certainly. Not inventions: they are real
cells, and "transcribe what you read" makes them items. Three reach the coding CSV. Left alone
deliberately — a bare number CAN be a legitimate output under a "# of participants" header, and
one spreadsheet is not enough to design a rule that will not do harm elsewhere.

The text-only variant from 2026-09-20.3 got its first real-document test here and behaved: honest
blocker, "could not be read as images, only as text, so the columns and formatting may be wrong".

--- Worth naming ---
Two of this batch's five documents are not logic models (a program assessment report and an
organisational overview), and both were flagged correctly with accurate notes. Across three random
batches that is 4 of 14 documents that are not logic models. The document-type flag is earning its
keep more often than the invention guard is.

--- Next ---
1. Owner decision on the rule-7 wording (proposed with exact text).
2. More spreadsheets, before designing either a sheet splitter or a bare-cell rule.
3. Instability remains the open problem: 0 in 586 invented vs 7 of 15 unstable.
```

---

## Session 23 — the short-term misroute is NOT reachable by prompt wording (2 attempts, withdrawn)

```
Date:                     2026-09-20
Operator:                 owner approved the proposed rule-7 wording change
Prompt version:           2026-09-20.6 UNCHANGED — .7 was built twice, measured twice, withdrawn twice
Gemini calls:             14 (7 per attempt)

--- What was approved, and what happened ---
Session 22 found A New Dawn routing its explicitly-labelled "4. SHORT-TERM OUTCOMES (3-12 months)"
section into `generalOutcomes` (9 items) while "5. INTERMEDIATE OUTCOMES" and "6. LONG-TERM IMPACT"
routed correctly. Deterministic: 3 of 3 runs. The owner approved the proposed fix.

ATTEMPT 1 — widen rule 7's escape clause to name section headings alongside columns.
  "...distinguishes those three (separate columns, or explicit per-item labels)"
  -> "...distinguishes those three — by separate columns, by separate SECTION HEADINGS, or by
      explicit per-item labels. A heading like 'SHORT-TERM OUTCOMES (3-12 months)' in a document
      with no grid distinguishes them exactly as a column header does."
  +184 chars to all 9 extract variants. RESULT: complete no-op. a-new-dawn short=0 / general=9 on
  all three runs, byte-for-byte the baseline. Controls unchanged.

  Why the diagnosis was wrong: the WHEN THERE IS NO GRID section (added 2026-09-20.6) ALREADY
  says "Put these in `generalOutcomes` unless the source itself states a time horizon". The escape
  I "widened" was not the binding constraint, because a working escape already existed elsewhere.
  I should have read that section before proposing, not after measuring.

ATTEMPT 2 — qualify the prohibition itself, which names the one failing field.
  Added: "**This forbids GUESSING a horizon, not USING one the source states.** When the document's
  own heading names the horizon ... that heading IS the distinction, and each section goes to its
  matching field, `shortTermOutcomes` included. Routing a section the document labelled short-term
  into `generalOutcomes` is the same error in reverse..."
  +541 chars to all 9 extract variants. RESULT: complete no-op. Identical numbers again, 3 runs.

BOTH WITHDRAWN. Six runs, zero movement, and 541 chars per call is real money against the economy
work landed in session 21. An unproven prompt change does not land here — that is the session-18
rule and it applies to changes I proposed and the owner approved, not just ones I talk myself into.

--- What the evidence actually shows ---
The asymmetry is not structural. Section 4 and section 6 have the SAME shape — a bold section
heading naming a horizon, then two bold sub-headings, then bullets:

  4. SHORT-TERM OUTCOMES (3-12 months)   sub-heads Youth Outcomes / School&Community
       -> generalOutcomes, group "General", sub-heads recorded in sourceHeader but NOT used as groups
  5. INTERMEDIATE OUTCOMES (1-2 years)   no sub-heads
       -> mediumTermOutcomes                                                   CORRECT
  6. LONG-TERM IMPACT (3-5 years)        sub-heads For Students / For Schools & Communities
       -> longTermOutcomes, sub-heads USED as group names                      CORRECT

Section 6 proves the machinery works on this exact shape. The only difference between 4 and 6 is
the horizon word. And `shortTermOutcomes` appears nowhere else in the prompt that could override
rule 7 — no restatement in knownFailureModes, and the JSON skeleton actually shows
`shortTermOutcomes` POPULATED while `generalOutcomes` is shown empty, which biases the other way.

So the model is avoiding one specific field, and two rewrites of the only rule that mentions it
changed nothing. This is the session-9 result again: measured ~1 flag in 640 there, zero movement
in six runs here. Some behaviours are not reachable by wording, and the honest move is to say so
rather than write a third variant.                                               | cause: prompt

--- The finding stands, unfixed ---
Reproducible, deterministic, and it costs something real: the coding CSV writes these rows as
`General Outcomes`, which services/codingExport.ts:21 defines as "No time horizon in the source —
a coder assigns short/medium/long-term during coding." A New Dawn's source says (3-12 months), so
a coder is asked to supply a horizon the document already gave. Nine items, one document, 1 of 14
sampled so far.

Not attempting a code-level re-route: the app would have to re-derive section structure from
Track A, which is re-implementing extraction in the client against the same ambiguity. If this
recurs across more documents it is worth revisiting with that evidence; on n=1 it is not.

--- Next ---
1. Watch for a second instance. One document does not justify either a third prompt variant or a
   client-side re-router; two or three would justify the latter.
2. Instability is still the larger problem: 0 inventions in 586 items vs 7 of 15 documents unstable.
```

## Session 24 — the XLSX split fails at the DETECTION GATE, not at the slicer

```
Date:                     2026-09-20
Operator:                 cloud session — no local corpus, no bundles
Prompt version:           2026-09-20.6 UNCHANGED — no prompt touched
Gemini calls:             0 (static source read; nothing ran against the API)

--- Why this is a code-only session ---
Briefed to work `local-capture-session.md` section 7 (XLSX, then PNG, then PPTX). Section 7
prioritises which DOCUMENTS to capture next, and this session has none: the corpus is on the
owner's machine, and `fixtures/regression-set/bundles/` is gitignored, so all 17 bundles named in
`manifest.json` are absent from a fresh clone. No capture, no audit, no census. Baseline otherwise
confirmed: 244 pass / 1 skipped / 0 fail. What follows is the one section-7 item readable from
source alone.

--- FINDING: `## Sheet:` is unreachable, so widening the regex would be a no-op ---
Session 22 already recorded that `documentBundleSlicing.ts` matches `## Page N` / `## Slide N`
only, and added that "slicing also assumes page ranges and images, and XLSX has neither". The
runbook's section 7 compressed that to the regex alone. That compression is the hazard: the regex
is not the binding constraint, and a session that widens it will watch all 244 tests stay green
and conclude the bug is closed.

The slicer is never reached for a spreadsheet. Traced end to end:

  services/fileService.ts  assembleDocumentBundle('xlsx', [], warnings, false, textTrack,
                           undefined, undefined) — images [] and previewImages undefined, so
                           `previews` resolves to undefined (both branches fail, ~line 791).
  App.tsx runDetection     pageCount = bundle.previewImages?.length ?? 0   ->  0
                           gate `pageCount >= 2 && bundle.previewImages`   ->  false
                           groups stays [{ startPage: 1, endPage: 1 }]
  App.tsx                  `if (groups.length <= 1)` returns BEFORE any sliceDocumentBundle call.
                           PAGE_MARKER is never consulted for an XLSX at all.

Two locks on this door; the regex is the inner one. The split path is raster-driven end to end and
a spreadsheet has no rasters.                                                     | cause: setup

--- Not built, deliberately ---
The runbook gates a sheet splitter on capturing two more spreadsheets, and n is still 1. Nothing
was changed here. Recording the mechanism only, so the gate is decided on evidence rather than on
a one-line diagnosis that understates the work.

When the gate does open it is a new detection path keyed on `## Sheet:` blocks in Track A — the
marker is `## Sheet: <name>`, a NAME and not a number (shared/xlsxGrid.ts:179), which `PageRange`'s
numeric start/end cannot express. That is a new range type plus a non-raster detection trigger,
not a regex widening.

The operator-facing warning for the merge already ships (fileService.ts ~line 1484, commit
88e6993), so the app states the fact while the splitter stays ungated.

--- Next ---
1. Section 7 still needs a session on the owner's machine: two more spreadsheets, then PNG, then
   PPTX. None of it is reachable from a cloud session.
2. If the splitter is ever scoped, scope it as detection + a sheet-keyed range, and re-read this
   entry before touching PAGE_MARKER.
```

---

## Session 25 — branches consolidated; PPTX vision conversion WORKS server-side

```
Date:                     2026-09-20
Operator:                 owner ("clean everything up and unify it"); agent session
                          (claude/project-thread-390llw)
Prompt version:           2026-09-20.6 UNCHANGED — no prompt, no capture, 0 Gemini calls

--- Consolidation ---
Four non-main branches existed. Three are one line: claude/loving-hawking-r436g3 (81 commits, the
whole capture toolchain) and two single-commit children of it, claude/project-thread-370qt4 (the
section 2 cost switch) and claude/project-thread-fo4qzl (session 24). Merged both into
claude/project-thread-390llw; disjoint file sets, no conflicts. npm test 250 pass / 1 skipped /
0 fail, npm run typecheck clean, npm run build clean.

cursor/dual-track-document-bundle is already superseded: its base commit 14fe781 is an ancestor of
main, and its one extra commit (8f9aa02, zoom/pane sizing) is present on main by content — main's
SourceDocumentPane.tsx carries MIN_ZOOM/MAX_ZOOM and the width-% scrollport, and App.tsx carries
the 1fr/1.15fr grid. Nothing to merge. Left in place, not deleted.

--- FINDING: "100% PPTX vision-conversion failure" (session 1, finding 3) IS STALE ---
That finding blamed the LibreOffice->PDF path and codebase audit #16 blamed the browser-WASM
fallback, which could not work without COOP/COEP headers. The browser fallback was DELETED in
ab09403 ("Fix remaining 23 audit findings"), so convertPptxToImages now goes server-only through
/api/convert/pptx-to-pdf. That path was never re-measured after the removal.

Measured here, end to end, without Gemini: a synthetic four-column logic-model PPTX through
server/libreOfficeConverter.ts -> convertPptxBufferToPdf.

  LibreOffice WASM worker init:   3,776 ms (one-off, lazy singleton)
  PPTX -> PDF convert:            1,049 ms
  Output:                         %PDF-1.7, 12,637 bytes, 1 page, 720x540pt
  Text runs preserved:            12, all four columns, in slide order

So Track B for PPTX is reachable today on the Express path. The two PPTX fixtures
(firsthand-pptx, performance-garage-youthmoves) hold 0 images because they were captured BEFORE
the fallback removal; their manifest `covers` strings still assert the path fails. Not corrected
here, because one synthetic deck does not license a claim about those two real documents — recapture
them and the manifest text follows from the result.                              | cause: setup

--- What this does NOT establish ---
- One clean, machine-generated deck. Real decks carry embedded fonts, images, SmartArt and masters;
  LibreOffice fidelity on those is unmeasured.
- Vercel is a separate question and the code says so: api/convert/pptx-to-pdf.ts's own docstring
  warns "cold start + ~250MB WASM may exceed typical serverless limits; prefer local Express".
  node_modules/@matbee/libreoffice-converter/wasm measures 237 MB here. Unverified on Vercel.
- A deck is now N PDF pages, so two PDF-path rules start applying to PPTX that never applied while
  it ran text-only: MAX_VISION_PAGES = 15 truncates a longer deck, and runDetection's
  `pageCount >= 2` gate means every multi-slide deck now pays a detect-logic-models pre-pass and can
  be SPLIT into parts. A single logic model spread across several slides is the case to watch.

--- Next ---
1. Recapture firsthand-pptx and performance-garage-youthmoves on the current code. If images now
   appear, performance-garage stops being a second text-only data point and becomes the track-band
   vision fixture the manifest has wanted since session 5.
2. Then census them. A PPTX that has never run vision has no stability history at all.
3. Check /api/health's libreOfficeWasm field on a Vercel preview before promising PPTX on hosted.
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
| 7 | 2026-09-20 | A/B (3 docs) | extract (nesting churn fixed on vision; text-only still bistable) | prompt | N |
| 8 | 2026-09-20 | 3 docs | extract (0/204 inventions; census: 1 of 3 docs fully stable) | prompt + setup | N |
| 9 | 2026-09-20 | 3 docs | extract (flagging removed; prompt shrinks ~1.3k; Core Reporter 5/5 stable) | prompt | N |
| 10 | 2026-09-20 | 7 docs | extract (vision-only works; text-only diagnosis retracted) | prompt + setup | N |
| 11 | 2026-09-20 | 12 docs | extract (+lowleg fails at the gate, not extraction; recall moves) | setup + prompt | N |
| 12 | 2026-09-20 | n/a (code) | extract (low-legibility warns instead of discarding) | setup | N |
| 13 | 2026-09-20 | n/a (copy) | operator-facing flags rewritten in plain language | other | N |
| 14 | 2026-09-20 | n/a (tests) | export column drift, jargon and contract headers now guarded | other | N |
| 15 | 2026-09-20 | 2 docs | text-only no longer instructed to read images | prompt | N |
| 16 | 2026-09-20 | 3 docs | unmapped widened (unproven); nesting fold breaks on long parents | prompt | N |
| 17 | 2026-09-20 | 1 doc | nesting fold split by parent type; 85% fewer chars, same content | prompt | N |
| 18 | 2026-09-20 | 2 docs | no-grid fallback added (safe, unproven); flag states its consequence | prompt + other | N |
| 19 | 2026-09-20 | 4 docs (random) | 0/88 invented, 84/84 complete; `verbatim` undefined yet still gates the rollup | setup + other | N |
| 20 | 2026-09-20 | 5 docs (random) | 0/247 invented; base64 bloats one DOCX track 87%; scalars synthesised unrecorded | setup + prompt | N |
| 21 | 2026-09-20 | 15 docs (census x3) | base64 stripped; `verbatim` retired + schema/prompt guard; 7 of 15 unstable | setup + other | N |
| 22 | 2026-09-20 | 5 docs (random) | 0/251 invented; stated short-term horizon -> generalOutcomes (3/3); first XLSX = 8 models merged | prompt + setup | N |
| 23 | 2026-09-20 | 1 doc x 14 runs | short-term misroute NOT reachable by wording; 2 variants built, measured, withdrawn | prompt | N |
| 24 | 2026-09-20 | n/a (code) | extract (XLSX split never fires: detection gate, not the slicer regex) | setup | N |
| 25 | 2026-09-20 | n/a (code) | branches unified; PPTX vision conversion works server-side (finding from session 1 is stale) | setup | N |

---

## Session 26 — seven REAL decks; the PDF renderer was broken in the worker, so PPTX vision had never once run

```
Date:                     2026-09-22
Operator:                 owner (uploaded seven real client decks); agent session
                          (claude/project-thread-fdk96r)
Files:                    7 PPTX logic models from the corpus, 2-3 slides each. Client documents:
                          NOT committed, NOT added to the regression set.
Prompt version:           2026-09-20.6 UNCHANGED
Host mode:                npm run dev :3000, Chromium 141, headless
Gemini calls:             7 text-only extracts (first pass, before the bug was found), 7 detects +
                          7 extracts (after the fix), 1 detect + 1 extract (stability repeat)

--- FINDING 1: the pdf.js polyfills never reached the worker, so vision NEVER ran on PPTX ---
All seven decks converted to PDF correctly (LibreOffice, 1.0-10.8 s, page count == slide count
every time). Then every one of them produced ZERO page images and fell back to text with only
"Couldn't read this document as images, so it was analyzed as plain text."

polyfills.ts patched `Map.prototype.getOrInsertComputed` on the main thread only. pdf.js parses,
sanitises fonts and renders inside a module Web Worker — a separate realm with its own
Map.prototype and its own Math — so the worker ran unpatched. Two distinct failures:

  getOrInsertComputed  `Dict.merge` throws -> every render and getTextContent throws
                       UnknownErrorException -> no images at all, silent text fallback.
  Math.sumPrecise      embedded TrueType glyf/loca rebuild throws -> pdf.js substitutes a standard
                       font by RAW GLYPH INDEX -> the page renders, and its text is mojibake:
                       "Human" -> "Hu#a$", "1,100 students" -> "?,?.. students", "MEDIUM" ->
                       "ME!IUM". Correctly placed boxes full of garbage, reported as success.

The second is the more dangerous of the two and was found only by rendering a page and LOOKING at
it. Nothing downstream can detect it.

NOT A LIBREOFFICE PROBLEM. Isolated with two hand-built PDFs identical except that one declares
/Resources on the Pages node as well as the Page. Only that one fails. LibreOffice emits that shape
on every file, which is why 7/7 decks hit it, but any producer that does the same triggers it — so
part of the 78-PDF corpus is likely affected too, and has been silently degrading to text-only.
Session 25's "one synthetic deck" measurement passed because a simple deck misses both paths.

Fixed: services/pdfWorkerSrc.ts runs the polyfill source inside the worker before importing
pdf.js's own worker (blob module worker, the shape pdf.js itself uses in _createCDNWrapper).
Verified in dev AND in a production build. polyfills.test.ts runs both copies of the polyfill in
fresh vm realms and asserts they agree.                                          | cause: setup

--- FINDING 2: a deck holding TWO grids loses one, silently, marked ok/high ---
67_126 DesignPhiladelphia is 3 slides: slide 1 a grid, slide 2 the impact/mission cover, slide 3 a
SECOND, differently-worded grid of the same logic model. runDetection returned ONE group spanning
pages 1-3 (it does not split). The extraction then took slide 1 only: all 39 items carry
sourcePage 1, and none of slide 3's distinctive wording ("Poor Richards", "AEC (Architecture",
"Number of surveys completed", "history of volunteerism") appears anywhere in the result.

extractionStatus "ok", extractionConfidence "high", extractionBlockers null, possiblyMissedRegions
null, unmapped []. A reviewer has no way to learn a whole second grid existed.

Dropping a superseded draft may be the RIGHT call. Doing it without saying so is not. The same
document text-only produced 73 items by merging both grids, so the two tracks disagree by a factor
of two on the same file.                                                         | cause: prompt

--- Per-deck results (after the fix) ---
  deck                          slides  pdf pages  split  truncated  items  status
  22_48  UCSC FirstHand              2      2       no       no        45   ok/high
  26_89  ImmSchools                  2      2       no       no        46   ok/high
  38_144 Performance Garage          2      2       no       no        47   ok/high
  52_51  Joyful Readers              2      2       no       no        38   ok/high
  67_126 DesignPhiladelphia          3      3       no       no        39   ok/high  <- finding 2
  85_103 Print Center AISP           2      2       no       no        26   ok/high
  103_106 Strong Point               3      3       no       no        31   ok/high

MAX_VISION_PAGES = 15 was never approached; the longest deck is 3 slides. Detection fired on all
seven (all are >= 2 pages) and split none of them, so the feared "one logic model cut into several"
did not occur on any real deck. The opposite did, once.

Strong Point's slide 2 is a colour key, not a grid; its legend was correctly captured into
colorLegend rather than mined for items.

--- Item-by-item check, read against the slides ---
52_51 Joyful Readers: 38 source bullets, 38 extracted items, exact. Every Resources sub-group
(Human/Material/Financial/Knowledge) correct; all four un-headed outcome columns assigned to the
right column. Zero inventions, zero omissions.

85_103 Print Center AISP: 26 source shapes/paragraphs, 26 items, exact. Source typos preserved
verbatim ("professional levelart"), which is the wanted behaviour. "Knowledge" is the LAST shape in
slide 2's z-order — after every long-term outcome — and was still placed in Resources, which is a
spatial judgement the text track alone does not support.

Grouping granularity is inconsistent WITHIN a document: in Print Center's Activities, one shape's
two paragraphs became two items while the next shape's three paragraphs became one joined item.
Content-complete either way, but it is the same grouping-variance class that blocks launch.

--- Run-to-run stability (2 passes, full pipeline, 38_144 Performance Garage) ---
Chosen because this document is the corpus's known unstable one. Result: 47 items both passes,
same domains, same groups, 0 moved, 0 field changes. The only differences are de-hyphenation noise
in 2 items ("Long- term Pre- professional" vs "Long-term Pre-professional"; "choreographers/
artists" vs "choreographers/artists").

NOT byte-identical, so by the census's rule this is "no structural differences seen" on 2 passes,
which is not proof of stability. But it is a different and far milder failure than the regrouping
this document shows as a PDF.

--- Notes ---
The two PPTX fixtures still hold 0 images and their `covers` strings still assert the path fails.
Recapturing them is now genuinely cheap — scripts/capture-bundles.mjs works unmodified against the
fixed renderer — but it was not done here, and neither fixture text was edited.

Nothing in this session was pushed. The renderer fix is committed locally on
claude/project-thread-fdk96r and awaits the owner's go-ahead.
```

---

## Session 27 — the hosted deployment never received the uploads it was asked to convert

```
Date:                     2026-09-22
Operator:                 owner (ran nine decks against the hosted preview, supplied the extraction
                          log and the browser console); agent session
                          (claude/project-thread-6iwsap)
Files:                    9 PPTX logic models from the owner's corpus, run in HIS browser against a
                          preview deployment. Client documents: not committed, not quoted here.
Prompt version:           2026-09-20.6 UNCHANGED
Host mode:                hosted (Vercel preview built from main + the category-promotion PR,
                          so it carried session 26's renderer fix), Firefox
Gemini calls:             0 by this session. The nine the owner spent are the subject.

--- FINDING 1: the upload arrived with no body, so conversion 400'd before LibreOffice ---
Every one of the nine rows read `text-only` / `partial` / `medium`, "Couldn't read this document as
images" — the same signature as session 26's renderer bug, on a build that already had the fix.

The browser console named it in one line, repeated nine times:

    PPTX Image Conversion Error: Error: Request must include raw PPTX bytes or { data: base64 }.

That is this repo's own 400, from `handlePptxToPdfRequest`. The request reached the function and
carried nothing. Cause: the client sent the deck under its true content type
(`application/vnd.openxmlformats-officedocument.presentationml.presentation`), and a serverless
host parses the request body by content type — JSON, form-urlencoded, text, octet-stream — and
hands the function `undefined` for everything else. The honest content type was the bug.
`docs/specs/codebase-audit-2026-09-19.md` #18 had already noted that the two entry points parse the
body differently; what it could not say is that one of them therefore never worked.

Fixed three ways, because one of them alone leaves the next person guessing: the client sends
`application/octet-stream`; the function reads the request stream itself when the host parsed
nothing; and the 400 now names the content type and body type it actually received.

--- FINDING 2: the WASM was never in the function bundle either ---
Found before the console arrived, and it would have been the next failure. `getLibreOfficeWasmPath`
builds its path at runtime from `require.resolve`, and a serverless bundler decides what to ship by
TRACING IMPORTS. Ran that same tracer (@vercel/nft) over the converter: 4 files, 2.2MB, and none of
the 237MB of WASM. Nothing in vercel.json named them.

Measured while fixing it: converter init alone peaks at 945MB RSS (3.8s), and converting a
one-paragraph document peaks at 1074MB — against the 1024MB that function was configured with. So
the memory ceiling would have bitten immediately after the bundling did. Now `includeFiles` plus
3009MB. Traced bundle + WASM is 238.7MB against a 250MB cap: it fits, with little room, which is
worth knowing before anyone adds a dependency to that route.

--- FINDING 3: the reason for a fallback was thrown away at the catch ---
Nine rows of evidence could not say why, because the only trace of the underlying error was a
`console.warn` in a browser. The reason now travels into the warning and so into the extraction
log's `warnings` column, and vision being UNAVAILABLE (as opposed to a document failing to render)
is no longer a silent downgrade: it fails the file with a sentence the user can act on, and spends
no Gemini call. Verified in a browser against a 503: 0 extract calls, message shown.

--- PDFs: reported broken, then withdrawn ---
Mid-session the owner reported that PDFs had failed the same way, which would have meant a second
cause: PDFs never touch LibreOffice or the convert route, they are rendered by pdf.js in the
browser. Two things said otherwise before he rechecked — the console he supplied contained only
PowerPoint failures, and a mode-A PDF (the session 26 trigger: /Resources on the Pages node)
rendered correctly in a production build driven headlessly here. He then confirmed PDFs work
hosted. So the hosted breakage is the PowerPoint route alone, and findings 1 and 2 account for all
of it.

Kept because it cost real time: the signature "Couldn't read this document as images" is now
produced by at least three unrelated faults (the worker realm, the empty upload body, and any
render failure), which is precisely why finding 3 puts the reason in the log. Worth noting too that
every measurement in sessions 25-26 was Chromium while the owner works in Firefox; nothing has
turned on that yet, but nothing has ruled it out either.
```
