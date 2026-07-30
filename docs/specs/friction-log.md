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

## Running tally

| # | Date | Format | Stage hurt | Cause | Stop-using? |
|---|------|--------|------------|-------|-------------|
| 1 | 2026-07-30 | PDF | extract | prompt + doc-quality | N |
| 2 | 2026-07-30 | PDF | extract (OCR) | doc-quality + prompt | N |
