# Multi-column logic model extraction — pattern benchmark

Status: **Recommendation** (@pattern-analyst)  
Date: 2026-07-28  
Context: Performance Garage YouthMoves PDF failure (column mis-assignment, lost track rows, Impact Statement ↔ Mission conflation). See `multi-column-extract-fidelity.md`.

**Stack constraints:** Gemini 2.5 Flash vision, ≤15 pages/image cap, existing pdfjs→image pipeline, **no new npm deps**, prompt-only MVP preferred.

---

## Failure mode (what we're fixing)

Vision models default to **semantic reading order** (left→right, top→bottom) instead of **grid fidelity**. On PPT→PDF multi-column LMs:

| Symptom | Cause |
|---------|--------|
| Outputs land in Short-Term / Long-Term | Items read across column boundaries |
| FLC / Summer / Concert tracks collapse to "General" | Row alignment ignored; only column headers used |
| Impact Statement prose → `mission`; column items → wrong domain | Overview header conflated with rightmost "Impact" column |

---

## Pattern 1 — Header-anchored column assignment *(recommended MVP core)*

**How it works:** Before extracting any cell content, the model **identifies visible column headers** (Resources, Activities, Outputs, Short-Term, Medium-Term, Long-Term, Impact) and treats each header as a **vertical lane**. Every bullet is assigned to the lane whose header sits **directly above** it (same x-band). Semantic similarity is secondary to spatial position.

**Pros (our stack):**
- Zero infra change — prompt + schema JSON only
- Matches how human reviewers read grid LMs
- Fixes YouthMoves column drift (Outputs→Outcomes) in one pass
- Works with existing multi-page image batch (≤15 pages)

**Cons:**
- Weak on merged cells, diagonal connectors, or headers that wrap/stack
- Depends on header text being legible in vision (no OCR fallback)
- Model may still "helpfully" re-bucket by meaning unless explicitly forbidden

---

## Pattern 2 — Horizontal track bands (row-aligned groups)

**How it works:** After column lanes are established, the model scans for **horizontal band labels** (e.g., "YouthMoves at FLC", "Summer Intensive", "Concert") that span or anchor rows. Items in the same visual row share a **Group `name`** across domains (Outputs, Short/Medium/Long outcomes). Extraction order: (1) map columns, (2) map row bands, (3) assign each cell to `(column domain, row group)`.

**Pros:**
- Directly restores FLC / Summer / Concert fidelity
- Reuses existing `LogicModelGroup.name` — no schema change
- Composes naturally with Pattern 1 in a single prompt

**Cons:**
- Band labels may be subtle (bold row, shaded strip, left gutter) — needs explicit prompt cues
- Uneven row heights (one track has more bullets) can confuse alignment
- Activities/Inputs may use different grouping logic (functional vs track) — prompt must allow domain-specific group rules

---

## Pattern 3 — Two-pass column slice (extract layout, then fill JSON)

**How it works:** Pass A: vision model returns a lightweight **layout map** (headers, row labels, cell text keyed by `[column][row]`). Pass B: deterministic or LLM step maps that grid into `LogicModel` JSON. Used by some document-AI products (layout-first, structure-second).

**Pros:**
- Highest fidelity on dense grids; easier to test intermediate artifact
- Separates "where is this?" from "what domain is this?"

**Cons:**
- **2× Gemini calls** per doc — latency, cost, failure modes
- Needs new intermediate schema + merge logic (architect scope)
- Overkill until Pattern 1+2 fail on gold corpus

**Verdict:** Defer unless YouthMoves AC still fails after prompt hardening.

---

## MVP pick

**Pattern 1 + Pattern 2 in a single vision extract pass** — header-anchored columns plus horizontal track bands.

| Criterion | Why this wins |
|-----------|---------------|
| Implementation | Prompt-only edit in `constants.ts`; no pipeline change |
| Calibration | YouthMoves is the gold doc; column + track errors are spatial, not semantic |
| Risk | Partial success is acceptable; gold fixture catches regressions |
| Human-in-the-loop | Editor already exists for edge cases |

Do **not** add UI, OCR, or second pass for v1.

---

## Prompt strategies (concrete)

### A. Header-anchored columns

Add a **COLUMN FIDELITY** block to the extract prompt:

1. **Locate headers first** — list visible column titles left→right before extracting body text.
2. **Assign by position** — an item belongs to the domain of the column header vertically above it; never promote/demote by outcome language (e.g., "students will…" in Outputs stays Outputs).
3. **Forbidden cross-column merge** — do not combine adjacent columns even if prose continues visually.
4. **Rightmost "Impact" column** — if present as a grid column, map items to `longTermOutcomes` or `impact` per source label; do **not** treat column header "Impact" as the page-level Impact Statement field.

### B. Horizontal track bands

1. **Detect row labels** — bold/shaded row headers, program track names, or repeated left-gutter labels.
2. **Group name = track label** — for Outputs and outcome domains, set `Group.name` to the track (e.g., `"YouthMoves at FLC"`), not `"General"`, when the source uses aligned rows.
3. **Same row → same group** — cells horizontally aligned across Outputs / Short / Medium / Long share one group name even if one column is sparse.
4. **Activities exception** — tracks may appear as activity group headers; still preserve track name when rows align with the outcomes grid.

### C. Impact Statement vs Mission vs Impact column

Product rule (2026-07-28):

| Source label | Target | Rule |
|--------------|--------|------|
| **"Impact Statement"** (or explicit equivalent) | `impactStatement.content` | **CRITICAL** — capture verbatim only when explicitly labeled; never infer from column content |
| **"Mission" / "Purpose" / "Overview"** | `mission.content` | Optional; distinct from Impact Statement; may be empty |
| **Both present** | Both fields separately | Never copy Impact Statement into `mission` or grid domains |
| **Rightmost grid column "Impact"** | `impact` (grouped items) | Long-Term column → `longTermOutcomes`; not Impact Statement prose |

Prompt language: *"Impact Statement is overview prose at the top of the document. The Impact **column** is part of the outcomes grid. They are different fields — never conflate."*

---

## Defer (explicit non-MVP)

| Approach | Defer because |
|----------|---------------|
| **Second-pass layout extract** | Cost/latency; try prompt-first on YouthMoves |
| **Dedicated OCR** (Tesseract, cloud OCR) | New dep; vision already reads PG PDF; adds merge complexity |
| **Custom layout model** (LayoutLM, table transformers) | Heavy infra, training/hosting; violates zero-dep guardrail |
| **Auto-repair in critique pass** | Critique must evaluate as-placed, not re-bucket |
| **UI "multi-column detected" banner** | Optional Phase 6; prompt fix first |
| **Schema: `impactStatement` vs `mission`** | **In scope** — see `tech-multi-column-extract.md` |

---

## Handoff

- **@architect:** Prompt diff spec + YouthMoves gold fixture (`tech-multi-column-extract.md`)
- **@integrator:** Implement prompt block in `getAiExtractionPrompt(true)` only
- **Success signal:** YouthMoves AC in `multi-column-extract-fidelity.md` § Acceptance criteria
