# Roadmap — Logic Model Extractor

Living plan. Updated **2026-07-24** after team agent review (@product, @pattern-analyst, @architect, @critic).

**Stance:** Local MVP is done. Do not lock new features until real-doc friction is logged. Auth/cloud stay deferred.

---

## Phase board

| Phase | Status | Focus | Exit criteria |
|-------|--------|--------|----------------|
| Stabilize → Quality (local MVP) | **Done** | Extract → critique → edit → CSV/PDF; server Gemini; brand; errors/retry | Acceptance criteria in `current-prd.md` met |
| **0 — Feature freeze** | **Active** | No new capability work | Owner agrees validation-first; OUT list unchanged |
| **1 — Real-doc validation** | **Next** | 5–10 real SDP logic models; fill friction log | Top 1–2 pains ranked; “no feature needed” is a valid outcome |
| **2 — Colleague onboarding** | Ready | Short runbook + one guided solo run | Colleague completes one real doc alone; ≤2 clarifying questions |
| **3 — Product decide** | Blocked on 1–2 | Answer open PRD question with evidence | (a) park features 30–60 days, or (b) scope **one** enhancement with IN/OUT/AC |
| **4 — Single scoped enhancement** | Parked | Only if Phase 3 chose (b) | AC met; re-validate on ≥3 more real docs |
| Auth / cloud / Vercel team host | **Deferred** | See `phase-2-cloud.md` | Explicit PRD amendment only |

---

## Product check-in — 2026-07-24

- **Users:** owner + one colleague (ingest/extract/edit/export).
- **Host:** local first (`npm run dev` / `npm start`). Private Vercel optional/experimental only.
- **Pipeline:** Extractor export must match Qualitative Coding Tool input. LM Feedback = separate utility. Priority = Extract + Code (possible later unify). See `pipeline-context.md`.
- **Next step:** (1) lock coding handoff schema, (2) Phase 1 real-doc validation + Phase 2 runbook — not Entry/Feedback/DB/platform.

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

### Ready to scope small (Phase 2 / early Phase 4)

| Candidate | JTBD (1 line) | IN | OUT | Success |
|-----------|---------------|----|-----|---------|
| **Colleague runbook** | Colleague runs extract→export without owner present | 1–2 pages: Node, clone, `.env.local`, `npm start`/`dev`, ports, smoke test, “refresh loses work” | Docker, cloud, video series, every OS edge case | Solo success on 1st–2nd try |
| **Friction log** | Comparable notes so next feature is evidence-based | Template in `docs/specs/friction-log-template.md` | Analytics, telemetry, dashboards | ≥5 logged sessions before any feature PRD |
| **Evidence-gated micro-fix** | Remove one documented blocker | Single surface + clear AC | New pipelines, formats, platform | Friction gone in next 3 sessions |

### Parked until friction (unpark only with log evidence)

| Candidate | Unpark trigger | Effort (architect) |
|-----------|----------------|--------------------|
| Confirm before file **Remove** | Accidental wipe in sessions | S |
| Queue position / elapsed “still working” | “Is it stuck?” dominates | S–M |
| Timeout / 429 clearer UX (`AbortSignal`) | Long hangs or opaque rate limits | M |
| Surface vision→text fallback in UI | Silent quality drops on real docs | S–M |
| Critique “stale after edits” affordance | People export without re-analyze | S |
| Prompt / schema tuning | Ratings or buckets consistently wrong | S–M |
| **CSV export ↔ Coding Tool contract** | Schema known / import fails | S–M — **priority once schema locked** |
| PDF export shape tweaks | Human handoff mismatch (not coding path) | S–M |
| Session save/load (JSON models) | Lost work on refresh / long sessions | M |
| Side-by-side source preview | “I can’t find what the AI saw” | M–L |
| Batch queue controls (pause / priority) | Regular multi-file backlog pain | M |
| Jump-to-Weak review ritual UI | Scroll/abandon of editor | M |
| Custom brand beyond `config/brand.ts` | Non-SDP / multi-program need | M |

### Explicitly out (until PRD amended)

Auth / accounts · public or team cloud host · shared workspaces · multi-tenant white-label · LM Entry App · LM Feedback Module · codebook/coding UI in this repo · Partnerships DB · unify Extract+Coding (future PRD) · chat “improve my LM” agent · mobile / offline-first · full CI expansion · assume Vercel without deploy PRD.

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
- Handoff: [`handoff-next-chat.md`](./handoff-next-chat.md)
- Agents: `AGENTS.md`, `.cursor/rules/`
