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

## Running tally

| # | Date | Format | Stage hurt | Cause | Stop-using? |
|---|------|--------|------------|-------|-------------|
| 1 | 2026-07-30 | PDF | extract | prompt + doc-quality | N |
| 2 | 2026-07-30 | PDF | extract (OCR) | doc-quality + prompt | N |
| 3 | 2026-07-30 | PDF + CSV | extract (small print + colour) | doc-quality + prompt | N |
