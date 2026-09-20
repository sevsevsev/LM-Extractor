# Scope decision: extraction-only (2026-09)

Status: Active (2026-09-15)

## Decision

The app's purpose is narrowed to **reliably extracting structured logic-model content from
uploaded documents for downstream processing** (primarily qualitative coding of outcome
statements). Document-quality critique and the CMO causal-chain lens — `overallQuality`
(Strong/Adequate/Weak document rating), per-domain and per-item `critique`/`rating`, `causalRole`,
`causalChainAssessment` — are **deprecated and removed** from this app. A separate, future app will
own quality/causal-chain analysis, built on top of this app's extraction output rather than inside
it.

## Why

- The app had drifted into doing two different jobs in one screen: verifying extraction accuracy
  (does the data match the source) and assessing document quality (is the program's logic model
  well-designed). These are genuinely different audiences and different kinds of judgment, and
  conflating them was a real source of UI confusion — see the UX deep-dive that prompted this
  decision (the editor needed a disclaimer footnote to stop users from confusing "Overall quality"
  with extraction fidelity, which is itself a sign the boundary was drawn wrong).
- Removing critique is a clean cut, not just a scope trim. The critique pass never corrected
  extraction — its own prompt explicitly forbade re-bucketing items ("EVALUATE AS PLACED — DO NOT
  RE-BUCKET"). It only ever added quality commentary on top of an already-complete extraction. So
  cutting it:
  - Halves the Gemini cost and latency per document (previously two calls per file: `extract` on
    the fast tier, then `critique` on the more expensive Pro tier specifically because qualitative
    judgment needed the stronger model).
  - Removed a large, genuinely redundant UI surface: the "stacked form" editor existed almost
    entirely to show per-domain/per-item critique sidebars next to a second copy of item editing —
    once critique was gone it had nothing left to offer that the board view didn't already do.
  - Dropped 9 of 27 columns from the granular CSV export (`Domain Critique`, `Domain Rating`,
    `Item Critique`, `Item Rating`, `Overall Rating`, `Overall Rationale`, `Causal Role`,
    `Causal Chain Coherence`, `Causal Chain Evidence`).

## What stayed

Everything about extraction accuracy and trustworthiness is unaffected: the dual-track
(text + vision) extraction pipeline, deterministic `extractionStatus`/`extractionConfidence`/
`extractionBlockers` fidelity rollup (`shared/extractionFidelity.ts`), the completeness/recall
signal, the raster-vs-vector legibility check, source-aware domain mapping, provenance
(`verbatim`/`sourceNote`/colour), the branded PDF export, and both CSV exports (trimmed of
critique columns, otherwise unchanged).

## Historical record

The removed feature's design docs are kept for reference (a future quality/causal-chain app would
reasonably start from this work) rather than deleted, marked deprecated at the top:
- `docs/specs/lm-quality-rubric.md`
- `docs/specs/causal-chain-critique-v1.md`
- `docs/specs/tech-overall-quality-and-coding-export.md`
