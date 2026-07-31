# Source-aware mapping + correction capture (v1)

Status: Implemented locally (2026-07-31) — await real-doc correction exports to tune thresholds  
Agents: @product (scope), @architect (data shapes), @ux (editor surfaces)

## Problem
Logic models arrive with heterogeneous layouts and labels. Jumping straight into a fixed SDP domain schema forces or invents placements. We need to **capture source structure faithfully**, **map conservatively into standard domains**, and **learn from human corrections** without a full Translate workspace in v1.

## Product stance
1. **Source first** — preserve author sections/labels and items even when they do not map.
2. **Canonical second** — transfer into standard domains only with evidence (synonym match or user assignment). Never invent items; never force into a domain because the text “sounds like” an outcome.
3. **Standard domains stay the export/critique target** — empty when unmapped.
4. **Human corrections are training signal** — log assignments/overrides for iterative prompt and synonym improvements.

## In scope (v1)

### Extraction / model
- Preserve **source sections** (label, items, optional page/order) alongside or prior to canonical fill.
- **Synonym auto-map** from source header → canonical domain (conservative list; ambiguous headers stay unmapped).
- Items that do not auto-map land in an **Unmapped** bucket (not discarded).
- Preserve mapping metadata on each item (or section): `sourceSection`, `sourceHeader`, `mappingConfidence`, `mappedBy` (`auto` | `user` | unset).

### Editor UI
- **Unmapped** region in the existing editor (not a separate full-page Translate mode).
- Per unmapped item (and optionally remappable mapped items):
  - **Domain dropdown** (canonical domains + “Leave unmapped”).
  - **Short text field** (optional note: why / how they interpreted the source).
- No drag-and-drop required in v1.

### Mismatch suggestion
- After extract (+ optional normalize), compute a **mismatch score**.
- If above threshold, show a non-blocking banner: suggest focusing on unmapped assignment (“Significant layout/label mismatch — review unmapped items”).
- User can dismiss; standard editor remains usable.
- **Full split Translate mode** (source pane vs standard pane) is **out of v1** — see Follow-ups.

### Correction capture
- Append-only **correction events** whenever the user:
  - assigns unmapped → domain;
  - remaps domain A → domain B;
  - returns an item to unmapped;
  - dismisses the mismatch banner;
  - (optional) edits the short note.
- Events retained for the session and included in **full granular CSV** (and/or a downloadable corrections sidecar) so we can reflect on coding/corrections offline.
- No cloud analytics / accounts in v1 (local export only).

### Export
- Full granular CSV includes unmapped rows (e.g. Domain = `Unmapped` or `Unmapped: {sourceHeader}`) plus mapping metadata columns and correction-related fields where applicable.
- Coding CSV remains outcomes-only from **canonical** Short/Medium/Long (unmapped excluded unless later remapped).
- Branded PDF uses **canonical** domains only (unmapped omitted from the print layout, still in CSV).

## Out of scope (v1)
- Drag-and-drop between domains / panes.
- Full **Translate mode** split workspace (source rendering vs standard LM).
- Auto-forced entry into Translate mode (suggestion only).
- Machine learning / uploading corrections to a server.
- Expanding synonym lists into a full ontology UI.
- Changing critique to score unmapped buckets as first-class domains (critique stays on canonical model; unmapped may be noted in overall rationale later if needed).
- Destructive fixture-specific rebucketing (YouthMoves hard-coded moves) — to be gated/removed as a related correctness fix when implementing (see Related).

## Mismatch threshold (v1 default — tune from friction log)

Let:
- \(N\) = count of items with non-empty text  
- \(U\) = count of those items still unmapped after synonym auto-map  
- \(S_{src}\) = count of distinct source section labels  
- \(S_{mapped}\) = count of source sections that auto-mapped to a canonical domain  

**Suggest mismatch banner when any of:**

| # | Condition | Rationale |
|---|-----------|-----------|
| 1 | \(N \ge 8\) and \(U / N \ge 0.30\) | ≥30% of content still unassigned |
| 2 | \(U \ge 5\) and \(S_{src} - S_{mapped} \ge 2\) | Several unlabeled/unfamiliar sections with real volume |
| 3 | Extract reports layout family ∈ {`horizontal_rows`, `diagram`, `prose_sections`, `unknown`} **and** \(U / N \ge 0.15\) (if \(N \ge 6\)) | Non-grid layouts fail synonym-only mapping more often |

**Do not suggest when** \(N < 6\) (too little signal) or user already dismissed for this file in-session.

Document tuning in the friction log after 3–5 real docs; adjust thresholds without schema change if possible.

## Synonym policy (v1 — conservative)

Auto-map **only** high-confidence equivalents (exact / near-exact, case-insensitive). Examples:

| Source header (examples) | Canonical |
|--------------------------|-----------|
| Resources, Inputs, Enablers | `inputs` |
| Activities, Strategies*, Interventions* | `activities` (*only if clearly program-action, not “strategy assumptions”) |
| Outputs, Deliverables, Products, Reach | `outputs` |
| Short-term / Near-term / Immediate outcomes | `shortTermOutcomes` |
| Medium-term / Intermediate outcomes | `mediumTermOutcomes` |
| Long-term / Ultimate outcomes | `longTermOutcomes` |
| Impact (column), Ultimate impact | `impact` |

**Stay unmapped (examples):** Situation, Need, Problem, Assumptions, External factors, Goals, Objectives, Context, Conditions, Theory of change (as a blob), unlabeled clusters.

Impact Statement / Mission / Target Population remain **labeled-only** (existing presence rules); they are not filled from vague overview prose.

## Correction event shape (architect sketch)

```ts
interface MappingCorrectionEvent {
  at: string;                 // ISO timestamp
  fileId: string;
  action:
    | 'assign_domain'
    | 'remap_domain'
    | 'return_unmapped'
    | 'dismiss_mismatch_banner'
    | 'note_edit';
  itemKey: string;            // stable within session (e.g. hash of sourceSection+text index)
  itemText: string;           // verbatim at time of action
  fromDomain: string | null; // null = unmapped
  toDomain: string | null;
  sourceSection?: string;
  sourceHeader?: string;
  note?: string;              // short text field
  autoSuggestedDomain?: string | null;
  mismatchScore?: number;
  layoutFamily?: string;
}
```

Events append to `ProcessingFile` / model-adjacent state; survive until Remove; exportable.

## UX notes (@ux)
- Unmapped section uses the same item chrome as domains (textarea + provenance/colour) plus dropdown + note.
- Mismatch banner: one sentence + primary “Review unmapped” (scroll/focus) + dismiss.
- Keyboard: dropdown and note must be operable without drag.
- Do not add a second competing “mode” chrome in v1 — keep one editor with an unmapped block and optional banner.

## Acceptance criteria
1. After extract, items under unrecognized headers appear under Unmapped (not dropped, not forced into Outcomes).
2. Synonym-matched headers populate the correct canonical domain; ambiguous headers do not.
3. User can assign an unmapped item via domain dropdown; optional note is stored on the event (and visible if we bind note to item metadata).
4. When mismatch threshold fires, a dismissible banner appears; dismissing suppresses re-show for that file in-session.
5. Full granular CSV includes unmapped rows + mapping metadata; coding CSV excludes unmapped-only items.
6. Correction events for assign/remap/return/dismiss are present in export (columns or sidecar) for offline review.
7. Empty canonical domains remain empty in editor/export when nothing mapped there.
8. No new npm dependencies; Gemini key stays server-side.

## Related / prerequisite correctness
When implementing, also address known conflicts with this stance:
- Stop unconditional `consolidateImpactIntoLongTerm()` (destroys valid Impact columns).
- Gate or remove YouthMoves-specific `rebucketObviousOutputs` / hard-coded track names unless layout evidence supports the move.

See pipeline robustness review (2026-07-31 chat) and `extraction-provenance-and-color.md`.

## Follow-ups (not v1)
- Full **Translate mode**: left = source sections rendering; right = standard domains; drag/multi-assign.
- Stronger layout-family classifier (two-pass layout map).
- Overview image + labeled crops for non-grid docs.
- Synonym list edits from aggregated correction exports.
- DOCX/PPTX parity with PDF adaptive rendering.

## Open implementation order (suggested)
1. Data model: source sections + mapping metadata + correction events.  
2. Synonym map + stop destructive normalize.  
3. Editor: Unmapped + dropdown + note + banner.  
4. CSV columns / corrections export.  
5. Fixture coverage: renamed headers, valid Impact, mostly-unmapped diagram-like extract.
