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

## Running tally

| # | Date | Format | Stage hurt | Cause | Stop-using? |
|---|------|--------|------------|-------|-------------|
| 1 | 2026-07-30 | PDF | extract | prompt + doc-quality | N |
