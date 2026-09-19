# Roadmap — Logic Model Extractor

Living plan. Updated **2026-08-31** (session navigator + L→R column review scoped; Sheets/Jotform/Drive parked).

**Stance:** Local MVP is done. Do not lock new features until real-doc friction is logged. Auth/cloud stay deferred. Owner-scoped items may proceed.

---

## Phase board

| Phase | Status | Focus | Exit criteria |
|-------|--------|--------|----------------|
| Stabilize → Quality (local MVP) | **Done** | Extract → critique → edit → CSV/PDF; server Gemini | MVP AC in `current-prd.md` |
| **0 — Feature freeze (speculative)** | Soft | No *unscoped* capability work | Owner-scoped items may proceed |
| **1 — Real-doc validation** | Parallel | 5–10 real SDP LMs; friction log; extraction accuracy checked against source via `extraction-verification-protocol-v1.md` | Top pains ranked; ≥3 documents fully scored |
| **2 — Colleague onboarding** | Ready | Short runbook | Colleague solo success |
| **4a — Export for coding** | **Done** | Coder-shaped CSV button | `export-for-coding.md` AC |
| **4b — Overall LM quality** | **Done — deprecated 2026-09** | S/A/W + rationale; rubric doc | `lm-quality-rubric.md` AC |
| **Multi-column extract fidelity** | **Implemented** | Prompt + impactStatement + fixture tests | Re-run YouthMoves PDF; commit snapshot — **still unmet** (source PDF not available; see `fixtures/performance-garage-youthmoves/README.md`) |
| **Raster/provenance/colour fidelity** | **Implemented** | Provenance + colour fields; raster crop/upscale + column tiling; prompt anti-fabrication | Re-run Oxford Circle PDF; commit snapshot (`fixtures/oxford-circle-carnell-frc/`) — **met 2026-09-19** |
| **Source-aware mapping v1** | **Implemented (local)** | Source sections metadata + synonym remap; unmapped + dropdown/note; mismatch banner; correction export; stopped destructive Impact/YouthMoves rebucket | Re-run mismatched + Oxford docs; tune thresholds from correction CSV |
| **Source review v1** | **Implemented (local)** | Side-by-side source page rasters + soft item→page/column anchors; no bboxes | AC in `source-review-v1.md`; validate in next 3 real-doc sessions |
| **Extraction confidence + abstention v1** | **Implemented (local)** | Document `ok`/`partial`/`abstained` + categorical confidence rollup; fidelity banner; soft-gate coding export; separate from Overall quality | AC in `extraction-confidence-v1.md`; validate on next 3–5 real docs |
| **Sheets L1 processing log** | **Parked (2026-08-31)** | Sheet-joinable `processing_log.csv`; Jotform/Drive sidecar | Do not build. Specs remain as history. |

---

## Product check-in — 2026-07-24

- **Users:** owner + one colleague (ingest/extract/edit/export).
- **Host:** local first (`npm run dev` / `npm start`). Optional private Vercel remains allowed (owner 2026-08-31).
- **Pipeline:** Full LM for DB; **Export for coding stays IN** + overall S/A/W+rationale. PDF/DOCX/PPTX ingest stays IN. See `pipeline-context.md`.
- **Next step:** Continue Phase 1 validation; do not build Sheets/Jotform/Drive ledger work.
- **Discovery:** bulk ~100–200 + Sheets ledger — **parked 2026-08-31**. See `bulk-ingest-sheets-discovery.md` / `processing-log-l1.md`.

### Clarifying questions (answer during/after Phase 1)

1. **Volume & cadence:** Typical monthly volume — is pain *throughput* (many files) or *quality time* (few files, heavy edit)?
2. **Handoff:** Does the colleague run end-to-end alone, or mainly review/edit exports you produce?
3. **Stop-using threshold:** After 5–10 docs, what would make you abandon the tool (wrong extraction, slow critique, export shape, setup)?

---

## Candidate backlog (evidence-gated)

### Must validate first (Phase 1)

| Topic | Why |
|-------|-----|
| Extraction fidelity on real layouts / tables / sparse LMs | Unknown failure modes |
| Critique usefulness vs SDP judgment | Ratings may be noise |
| Edit → re-critique → export loop time | Core JTBD timing |
| 15 page/slide cap & large-file behavior | Already IN MVP; confirm if blocker |
| Local setup success for colleague | Blocks adoption more than missing features |
| Session UX Q1–Q3 | **Closed 2026-08-31** — typical 5–10 files, large batch allowed; L→R is the review surface; no two-extract compare — `ux-session-surfaces-discovery.md` |

### Ready to scope small (Phase 2 / early Phase 4)

| Candidate | JTBD (1 line) | IN | OUT | Success |
|-----------|---------------|----|-----|---------|
| **Colleague runbook** | Colleague runs extract→export without owner present | 1–2 pages: Node, clone, `.env.local`, `npm start`/`dev`, ports, smoke test, “refresh loses work” | Docker, cloud, video series, every OS edge case | Solo success on 1st–2nd try |
| **Friction log** | Comparable notes so next feature is evidence-based | Template in `docs/specs/friction-log-template.md` | Analytics, telemetry, dashboards | ≥5 logged sessions before any feature PRD |
| **Evidence-gated micro-fix** | Remove one documented blocker | Single surface + clear AC | New pipelines, formats, platform | Friction gone in next 3 sessions |
| **Session navigator (one active file)** | Work one LM at a time when several are uploaded | File list + one editor; header counts; honest ZIP/CSV; Preview **stays** | L→R board, PDF template art, review-lite table, two-file compare | Next multi-file sitting: no stacked editors — `session-navigator-v1.md` — **scoped** |
| **L→R column review v1** | See and correct the extract as standard columns | Board as default view of **selected** file; click item to edit/remap; source pane unchanged | Drag-drop, print-PDF restyle, two-file compare, nicer PDF modal as the product | Placement errors caught on the board, not via Preview — `ltr-column-review-v1.md` — **scoped; after navigator** |

### Parked until friction (unpark only with log evidence)

| Candidate | Unpark trigger | Effort (architect) |
|-----------|----------------|--------------------|
| Confirm before file **Remove** | Accidental wipe in sessions | S |
| Queue position / elapsed “still working” | “Is it stuck?” dominates | S–M |
| Timeout / 429 clearer UX (`AbortSignal`) | Long hangs or opaque rate limits | M |
| Surface vision→text fallback in UI | Silent quality drops on real docs | S–M — **addressed 2026-07-30** (fidelity notice banner) |
| Critique “stale after edits” affordance | People export without re-analyze | S |
| Prompt / schema tuning | Ratings or buckets consistently wrong | S–M — **addressed 2026-07-30** (`extraction-provenance-and-color.md`) |
| **CSV export ↔ Coding Tool contract** | Schema known — need `outcome_text` map + outcome-domain filter | S–M — **ready to scope** |
| **Overall LM quality field + prompt** | Owner wants model-level assessment + useful item critiques | M — design with `@lm-quality` / `@critique-prompt` first |
| PDF export shape tweaks | Human handoff mismatch (not coding path) | S–M |
| Session save/load (JSON models) | Lost work on refresh / long sessions | M |
| Side-by-side source preview | “I can’t find what the AI saw” | M–L — **unparked / scoped 2026-07-31** → `source-review-v1.md` |
| Extraction confidence / abstain | Silent fluent invention; fidelity ≠ LM quality | M — **unparked / scoped 2026-08-10** → `extraction-confidence-v1.md` |
| L→R review board (cross-domain adjacency) | Validation can’t see causal/thematic links across stacked domains | M — **unparked / scoped 2026-08-31** → `ltr-column-review-v1.md` (after navigator) |
| Item bounding-box highlight on source | Page jump still insufficient in friction log | M–L — Tier 2 after source-review v1 evidence |
| Batch queue controls (pause / priority) | Regular multi-file backlog pain | M |
| **Sheets L1 processing log** | Need Sheet-joinable run status for 100+ LMs on shared drive | S–M — **parked 2026-08-31** (owner: not needed now) |
| Review-lite results table | Editor-first UX fails at batch scale | M — after or with processing log L1 |
| Jump-to-Weak review ritual UI | Scroll/abandon of editor | M |
| Custom brand beyond `config/brand.ts` | Non-SDP / multi-program need | M |

### Explicitly out (until PRD amended)

Auth / accounts · public or team cloud host · shared workspaces · multi-tenant white-label · LM Entry App · LM Feedback Module · codebook/coding UI in this repo · Partnerships DB · unify Extract+Coding (future PRD) · chat “improve my LM” agent · mobile / offline-first · full CI expansion · **Sheets ledger / Jotform / Drive sidecar / processing log L1 / live Sheets-Drive APIs (L3–L4)** (parked 2026-08-31).

---

## Agent findings (summary)

| Agent | Key guidance |
|-------|----------------|
| **@product** | Validation → runbook → decide → at most one scoped fix. Default may be “no new feature.” |
| **@pattern-analyst** | Highest leverage: shared friction log (+ cause tags: prompt / ui / setup / doc). Runbook enables validation; skip wizards/telemetry. |
| **@architect** | Golden Path OK for all candidates; no new deps required. Soft spots: dual Gemini latency, no client timeout, in-memory editor, silent 15-page truncate, opaque vision fallback. Tech order: docs → prompt tuning → progress/timeout → export → session JSON → source preview. |
| **@critic** | Top UX risks: Remove without confirm; opaque waits / silent fallback; PDF “Preview first” ritual; critique staleness after edits; dense editor. Prefer runbook for setup/expectations; gate UI on observed breaks. |

---

## Suggested validation kit (no product scope)

1. Use [`friction-log-template.md`](./friction-log-template.md) for every real doc.
2. Prefer PDF uploads for fidelity; note DOCX/PPTX outcomes separately.
3. Observe (don’t build): time-to-first-edit, accidental Remove, Re-Analyze-before-export, wrong port (`:3000` vs `:3011`), export CSV vs PDF confusion.
4. After ≥5 sessions, triage log → `@product` scopes **one** item or parks everything.

---

## Pointers

- PRD: [`current-prd.md`](./current-prd.md)
- Friction log: [`friction-log-template.md`](./friction-log-template.md)
- Phase-2 cloud draft (unapproved): [`phase-2-cloud.md`](./phase-2-cloud.md)
- Session UX exploration (no build): [`ux-session-surfaces-discovery.md`](./ux-session-surfaces-discovery.md)
- Handoff: [`handoff-next-chat.md`](./handoff-next-chat.md)
- Agents: `AGENTS.md`, `.cursor/rules/`
