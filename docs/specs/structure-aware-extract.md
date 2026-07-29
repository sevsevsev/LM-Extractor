# Structure-aware extract & critique

Status: **Product decisions locked** (owner 2026-07-28) — implementation pending  
Owners: `@product` (IN/OUT), `@architect` (schema/presence), `@critique-prompt` + `@lm-quality` (critique/rollup), `@integrator` (extract/export)  
Related: `current-prd.md`, `lm-quality-rubric.md`, `multi-column-extract-fidelity.md`

## Problem

Logic models use **heterogeneous templates**. One document may have a Mission block; another may not. One may use Short + Long outcomes only; another may add Medium-Term and a separate Impact column. The tool must **reflect what the source contains**, not force every upload into a single canonical skeleton.

When we assume a full template, extraction and critique produce false failures: invented domains, mis-binned items, and **Weak** overall ratings that reflect template mismatch rather than document quality.

## Product principle

**Presence-first (Archivist mode):** Extract and assess only domains **explicitly present** in the source. Absent domains stay empty. Do not invent, merge, or redistribute content to fill schema slots.

A future **Normalizer** mode (map every LM to a fixed SDP template) is **out of scope** until explicitly scoped.

---

## Closed decisions (2026-07-28)

| # | Question | Decision |
|---|----------|----------|
| 1 | How should exports represent absent domains? | **Omit** — no rows for empty domains; no required `"Not present"` placeholder rows in full CSV. |
| 2 | How should critique treat absent outcome horizons (e.g. no Medium-Term column)? | **Ignore** — do not critique, rate, or mention that domain in overall rationale. |
| 3 | Is Mission mandatory for overall quality? | **No** — missing Mission must **not** lower overall quality. Mission is optional when absent from source. |

### Related rules (already aligned)

- **Impact Statement:** Critical when **explicitly labeled** in source (`impactStatement`). Distinct from Mission and from grid Impact column.
- **Mission:** Optional; may be empty. Never copy Impact Statement into Mission.
- **Grid Impact column:** Optional; empty when source has no Impact column (Long-Term may hold ultimate status language).

---

## In scope (structure-aware v1)

### Extract pass

1. **Detect presence** from explicit headers/labels (column titles, page-1 blocks), not from semantic guessing.
2. **Populate only present domains**; leave absent domains empty (`""` for string fields; `[]` for grouped fields).
3. **Do not invent** Medium-Term, Mission, or Impact column content when the source lacks those sections.
4. **Do not force** Short-only or Short+Long models into a three-horizon outcome chain.
5. Post-extract normalization (YouthMoves heuristics) must **not** create domains absent from plausible source structure — promotion/rebucketing only when fingerprint is high-confidence.

### Critique pass

1. **Critique only domains with content** (or labeled blocks that are present but empty in error — e.g. labeled Impact Statement header with no text may still warrant a Weak item-level note).
2. **Skip critique** for domains that are empty because the source had no such section (no domain rating, no item ratings, no rationale bullets about “missing mission”).
3. **Overall quality rollup** must exclude absent domains from:
   - “missing critical domain” logic
   - short→medium→long progression checks when medium (or other horizon) was not in source
4. **Missing Mission** is never grounds for Weak overall.

### Export & UI

1. **Full CSV:** Omit domain rows when domain has no content — `buildGranularExportRows` in `shared/domainPresence.ts`.
2. **Coding export:** Include only outcome horizons that have text (Short / Medium / Long as present).
3. **Editor / PDF:** Hide optional empty sections with “Add … (optional)” affordance — `LogicModelEditor.tsx`.

---

## Out of scope (until PRD update)

- Auto-splitting Short + Long into invented Medium-Term
- Penalizing overall quality for optional absent fields (Mission, Medium-Term, grid Impact)
- Mandatory `"Not present"` sentinel rows in full CSV
- Two-pass layout extract as default for all files
- Normalizer mode (force complete SDP template)

---

## Acceptance criteria

### Extract

- [ ] Upload with **no Mission** section → `mission.content` is `""`; no Mission row in full CSV export.
- [ ] Upload with **Short + Long only** (no Medium column) → `mediumTermOutcomes.content` is `[]`; no Medium-Term rows in CSV; no Medium items invented from Short/Long.
- [ ] Upload with **labeled Impact Statement** → `impactStatement` populated; not duplicated in Mission or outcome lists.
- [ ] Upload with **no Impact column** → `impact.content` is `[]`; Long-Term items not forced into `impact`.

### Critique

- [ ] Model with empty Mission but valid present domains → overall rationale **does not** cite missing mission.
- [ ] Model with no Medium-Term in source (empty `mediumTermOutcomes`) → no Medium-Term domain critique; overall rollup **does not** require medium-term progression.
- [ ] Model with only Short + Long outcomes → critique evaluates Short and Long only; progression rule applies to **present** horizons only.

### Overall quality

- [ ] Absent optional domains alone cannot produce **Weak** overall.
- [ ] Weak overall requires evidence from **present** domains (mis-binning, empty outcomes chain that *was* in source, etc.).

---

## Implementation notes (for @architect / @integrator — not product scope)

Suggested sequencing:

1. **Prompts** (`constants.ts`): presence-first extract + presence-aware critique rollup (lowest risk).
2. **Critique schema**: consider optional `present?: boolean` per domain later if prompt-only is unreliable.
3. **Export** (`App.tsx`): audit grouped domains for stray empty-group rows.
4. **Normalization** (`extractNormalize.ts`): scope heuristics to high-confidence fingerprints; avoid inventing structure.

YouthMoves fixture remains valid for **dense multi-column** cases; add a second fixture for **Short+Long-only** when a real sample is available.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-07-28 | Initial: owner decisions on omit-empty export, ignore absent domains in critique, Mission not mandatory for overall quality |
