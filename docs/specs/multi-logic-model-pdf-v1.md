# Multi-logic-model documents v1: auto-split one upload into N logic models

Status: **Scoped / not yet built** (owner 2026-09-18)

## Problem

At least one partner submitted a single 7-page PDF containing **7 distinct logic models** — one
per program, one per page — not one logic model spread across 7 pages. The extraction pipeline
today hard-assumes **one file = one logic model** everywhere: one `DocumentBundle` goes into one
Gemini extraction call, which fills exactly one `LogicModel` schema object, which becomes exactly
one `ProcessingFile.result`, one board, one row-set in both CSV exports, one IndexedDB record.

Confirmed by reading the pipeline (`services/fileService.ts`, `App.tsx`, `server/geminiLogicModel.ts`):
`MAX_VISION_PAGES = 15`, so a 7-page PDF is fully within range and **all 7 pages are already sent
to Gemini in one call today** — there's no page-count gate that would catch this. Gemini is then
asked to fill one LogicModel from content that actually describes 7 different programs. The
realistic failure modes are silent: it picks one program and drops the rest, or it interleaves
items from different programs' grids into one blended (wrong) result. Either way, up to 6 of 7
logic models are lost with no error, no flag, nothing in the export — worse than any fidelity
issue this app currently detects, because today's fidelity signals all assume the single
extracted model is *the* model, just possibly imperfect.

## Design

### 1. Detection — a cheap pre-pass, gated to multi-page documents

Add a new, small Gemini call (new endpoint, e.g. `api/gemini/detect-logic-models.ts`, mirroring
`api/gemini/extract.ts`'s client/server split) that takes the **already-converted** bundle's
preview images and Track A text (no new rendering work — reuses exactly what
`convertPdfToImages`/`convertDocxToImages`/`convertPptxToImages` already produced for the normal
path) and returns page-range groupings:

```ts
{ groups: { startPage: number; endPage: number; label?: string }[] }
```

- **Only runs when `pageCount >= 2`** — a 1-page document cannot contain more than one logic
  model, so the large majority-case (short documents) pays nothing.
- Schema is intentionally tiny (no LogicModel fields) — cheap and fast relative to the main
  extraction call.
- `groups.length <= 1` → fall through to **today's single-extraction path completely unchanged**.
  This is the critical property: the overwhelming majority of uploads (single logic model,
  possibly multi-page) see **zero behavior change** — they just pay one extra fast/cheap Gemini
  call before extraction starts.
- `groups.length > 1` → proceed to splitting (below).
- Applies uniformly to PDF/DOCX/PPTX (`DocumentBundle` already unifies all three behind
  `previewImages`/`textTrack` with `## Page N` / `## Slide N` markers) — but **only the PDF case
  is confirmed from a real partner document**; DOCX/PPTX support is architecturally free but
  functionally unvalidated until we see a real multi-model example in either format. Treat as
  lower-confidence for those two formats going in.

### 2. Splitting — in-memory bundle slicing, no new PDF library

The naive approach would physically cut the uploaded PDF into N standalone files (needs a new
dependency like `pdf-lib` — any new `npm install` needs sign-off per this repo's escalation
rules). **Not needed.** `DocumentBundle`'s arrays are already page-indexed
(`previewImages[i]` ↔ page `i+1`, `imageRefs` carry `{page, column}`, `textTrack` has `## Page N`
section markers) — a detected page range can be sliced directly out of the **one already-converted
bundle** into N sub-bundles, each shaped exactly like a normal single-document bundle. Each
sub-bundle then flows through the **existing, unmodified** extraction → normalize → fidelity →
board → export pipeline as its own `ProcessingFile` — this is the main reason the blast radius of
this feature stays small: extraction, the board UI, and both CSV exports need **no code changes**,
because a split entry is indistinguishable from any other single upload once it exists.

### 3. New pipeline state

Insert a `detecting` status between `converting` and `extracting`, gated to `pageCount >= 2` PDFs
(and DOCX/PPTX once validated). On `groups.length > 1`, the original `ProcessingFile` entry is
replaced by N new entries (new ids), each carrying:

- `sourceDocumentId` — points back to the shared original upload (see storage, below)
- `pageRange: { start: number; end: number }`
- `partLabel` — e.g. `"2 of 7"`, for the session list badge

Each new entry enters `extracting` independently, respecting the existing
`MAX_CONCURRENT_EXTRACTS` gate unchanged (it already just iterates `files`).

### 4. Storage — do not duplicate the file blob N times

`services/sessionStore.ts` currently stores one `File` blob per `ProcessingFile.id`. Naively
giving each of the 7 split entries its own copy of the same multi-MB PDF would multiply IndexedDB
usage 7x per upload — a worse version of the write-storm/storage problem already fixed once this
session for large batches. Instead:

- Add a `sourceDocuments` object store keyed by `sourceDocumentId`, holding the raw `File` **once**.
- Each split `PersistedFileRecord` stores `sourceDocumentId` + `pageRange` instead of its own
  `file` copy (non-split records keep working exactly as today — this only applies to split
  entries).
- **Resume**: dedupe by `sourceDocumentId` (convert the shared file once, not once per split
  record on the same document), then re-slice per record's `pageRange` — same slicing logic as
  initial detection, so no separate resume-path code.
- This is a real IndexedDB schema change (`DB_VERSION` bump, `onupgradeneeded` migration) —
  flagged as the main implementation-risk area alongside the detection call itself.

### 5. Naming / traceability

Display filename per split entry: `${originalStem} — part ${i} of ${n}${ext}` (e.g.
`"1234_5678_org-programs.pdf — part 2 of 7"`), keeping the **original leading
`orgid_progid_` prefix intact** so the existing filename-convention CSV workflow described
earlier in this project still parses per row. `source_filename` in both exports carries this
per-part name as-is — no new export column needed, since the shared prefix already ties split
rows back together by eye/sort, the same way any two related uploads would be matched today.

### 6. UI — flat rows, no new grouping component

`SessionFileList` shows **N separate rows**, each behaving completely normally afterward (edit,
export, download branded PDF, retry, remove — independently of its siblings once split). No new
nested/grouped list UI. Each row gets a small subtitle/badge: `"Part 2 of 7 — split from
org-programs.pdf"` for traceability. This keeps the one-row-per-logic-model mental model the rest
of the app already uses.

### 7. Revert — cheap escape hatch, not a merge/undo UI

Detection can misfire (false split of a genuinely single multi-page model, or a false merge of
two that really are separate). Rather than building a real merge/undo UI, show a one-time notice
right after a split happens: **"This document looks like it contains 7 separate logic models —
[Keep as 7] [Actually just one]."** Choosing "Actually just one" simply re-runs today's normal
single-extraction path on the original (unsliced) bundle instead of the split ones — cheap to
build, no new state to maintain, and directly answers the "how do we avoid this being brittle"
concern by making a bad call reversible in one click instead of a re-upload.

## Out of scope (v1)

- Physically splitting the source PDF into standalone files (no `pdf-lib` / new dependency needed
  — see Design §2).
- Manual page-range override UI (a human draws their own split boundaries) — natural v2 if
  detection accuracy proves imperfect in practice; not needed for a first ship.
- Merge-back-after-split UI beyond the one-time revert notice in Design §7.
- A nested/grouped session-list view — flat rows only (Design §6).
- Treating DOCX/PPTX multi-model detection as validated — architecture supports it, but ship
  behind the same confidence bar as PDF only once a real example is seen, or explicitly caveat it.

## Main tradeoff to sign off on before building

Every multi-page upload (the majority of uploads, single-model or not) now pays one extra
Gemini call before extraction starts, to determine `groups.length <= 1`. It's cheap and fast by
design (tiny schema, reuses already-rendered previews, skipped entirely for 1-page docs), but it
is not free latency/cost added to the common case in exchange for correctly handling the
uncommon 7-in-1 case. Worth an explicit go/no-go before implementation, along with the
`sessionStore.ts` schema migration in Design §4, since that's the one piece touching existing
persisted data.

## Acceptance criteria

1. A single-logic-model upload (any page count) behaves identically to today — same timing
   characteristics aside from the one added lightweight detection call, same single board/export
   result.
2. A confirmed multi-logic-model PDF (the real 7-page example) produces 7 independent, fully
   editable board entries, each exportable and downloadable exactly like any normal upload.
3. Both CSV exports carry all 7 entries' rows with distinguishable `source_filename` values that
   preserve the original `orgid_progid_` prefix.
4. Session resume after a browser refresh restores all 7 split entries correctly without storing
   7 copies of the source file.
5. The one-time revert notice successfully collapses a bad split back into the original
   single-extraction path with no partial/orphaned split entries left behind.

**Version:** v1.0 — 2026-09-18 — scoped, not yet built.
