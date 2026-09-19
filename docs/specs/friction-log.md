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

## Running tally

| # | Date | Format | Stage hurt | Cause | Stop-using? |
|---|------|--------|------------|-------|-------------|
| 1 | 2026-07-30 | PDF | extract | prompt + doc-quality | N |
| 2 | 2026-07-30 | PDF | extract (OCR) | doc-quality + prompt | N |
| 3 | 2026-07-30 | PDF + CSV | extract (small print + colour) | doc-quality + prompt | N |
| 4 | 2026-09-19 | batch (17) | extract (flagging silent; variant coverage) | prompt + setup | N |
