# Gold fixture — Oxford Circle CCDA (Carnell FRC)

Adversarial calibration case for extraction fidelity. This document exposes several
failure modes at once and drove the changes in
`docs/specs/extraction-provenance-and-color.md`.

## Why this document is hard

- **Page 2 has no text layer** — it is a single flattened raster (~1211 px wide). Extraction
  is pure OCR at ~8 px type unless the page is cropped/scaled up first.
- **Misleading sub-headings** — the only labels in the source are the four Resources buckets
  ("Frontline Staff", "Partners", "Material & Financial Resources", "Knowledge Resources").
  There are **no horizontal tracks**, so every other column should group as `General`.
- **Colour coding with no legend** — boxes are colour-coded (orange, purple, red) but the
  document shows **no key**, so the meaning (likely population, but author-defined) must be
  captured as raw colour metadata, never inferred. Some boxes have a **contrasting border**
  marking a second category.
- **Source-side truncation** — the TF-CBT activity box is visibly clipped ("…for students of all").

## Observed failure (pre-fix export)

Fabricated "St. Christopher's Hospital" and "classroom-based Behavioral Therapy Specialists";
reversed an outcome ("reduction in trauma-related behaviors" → "prosocial behaviors");
OCR errors ("grade bands" → "green bands", "donation" → "practicum"); dropped "Language Line";
and copied the Resources bucket names across Activities/Outputs/Outcomes columns.

## Files

| File | Purpose |
|------|---------|
| `expected-domains.json` | Placement + fabrication + grouping assertions |
| `extract-snapshot.json` | Full `LogicModel` from a successful re-run — committed 2026-09-19 |

## Refresh

1. Run extract on the source PDF (`Oxford Circle CCDA Logic Model submission.pdf`) with the
   current prompt and rendering pipeline. Source PDF is owner-held and not committed.
2. Save the result to `extract-snapshot.json`.
3. Run `npm test` — `extractPlacement.test.ts` validates the snapshot against
   `expected-domains.json`.

## Snapshot history

- **2026-09-19** — first committed snapshot. This test had been a silent no-op since the file
  was added (`docs/specs/codebase-audit-2026-09-19.md` #5) — the very first live run against the
  current pipeline caught a real fabrication: Gemini transcribed the Partners box's therapist
  affiliation as "Joseph J. Peters Institute" (adding an "s"), but the source literally reads
  "Joseph J. Peter Institute" (confirmed by direct visual inspection of the source page at 300dpi —
  the org's real-world name does have the "s", so this is exactly the kind of world-knowledge
  "correction" this fixture exists to catch, not an OCR error). That run's item was flagged
  `verbatim: true` despite the mismatch. A second run transcribed it correctly and is the snapshot
  committed here. This is a real, live signal that the model's verbatim-transcription discipline is
  not fully reliable on this line — worth watching if it recurs, not (yet) evidence of a code bug.
