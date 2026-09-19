# Codebase inconsistency audit — 2026-09-19

Source: independent audit run against the codebase (branch `claude/loving-hawking-r436g3`), commissioned
specifically to find inconsistencies a session anchored on its own prior work would be likely to miss.
Full original findings preserved below verbatim. Status column added post-hoc as items are resolved.

**Verification note:** the 3 Tier-1 items marked Fixed below were each independently re-verified by
tracing the actual code (not just trusting the audit) before any change was made, then covered with new
regression tests and (where the fix touched live behavior, not just pure logic) a live Gemini run. See the
commit for each finding for the specific verification performed.

## Status

| # | Finding | Status |
|---|---|---|
| 1 | `parseDocumentBundle` silently drops `imageRefs` | **Fixed** — `server/apiCore.ts` |
| 2 | `extractionStatus` not schema-required | **Fixed** — `server/geminiLogicModel.ts` |
| 3 | N<6 non-verbatim ratio ignored (dead guard) | **Fixed** — `shared/extractionFidelity.ts` |
| 5 | Gold-fixture snapshot tests always no-op | **Fixed** — `shared/extractPlacement.test.ts` + `fixtures/oxford-circle-carnell-frc/` |
| 6 | NUL bytes make `exportRoundtrip.ts` binary to git/grep | **Fixed** — `shared/exportRoundtrip.ts` |
| 9 | Spaced-vs-hyphenated `low-resolution` matcher drift | **Fixed** — `services/fileService.ts` |
| 4, 7, 8, 10–29 | See findings below | Not yet triaged |

## Second batch (2026-09-19): #5, #6, #9

- **#9** (`services/fileService.ts:755` vs `types.ts:230-237`) — `assembleDocumentBundle`'s dedupe
  check against a page-specific low-legibility warning was re-implemented inline with a
  hyphen-only, case-sensitive `.includes('low-resolution')`, instead of calling the already-fixed,
  already-tested `bundleImpliesLowLegibility` (which matches both "low resolution" and
  "low-resolution" via `/low[- ]resolution/i` — itself a fix from an earlier session finding).
  Replaced the inline check with a call to `bundleImpliesLowLegibility`, which both fixes the
  spaced-form miss on PDFs and removes the duplicate-implementation half of this finding at once.
  Not independently unit-tested at the `fileService.ts` call site: that module does a Vite-only
  `?url` import (`pdfjs-dist/build/pdf.worker.min.mjs?url`) that the project's plain `tsx --test`
  runner can't resolve outside a bundler, so no test file imports `fileService.ts` directly today
  (confirmed by trying — `SyntaxError: ... does not provide an export named 'default'`). The fix
  now delegates to `bundleImpliesLowLegibility`, which already has direct regression coverage for
  both the spaced and hyphenated forms (`types.test.ts`).

- **#6** (`shared/exportRoundtrip.ts:96,144`) — replaced the two raw `\x00` bytes embedded in
  `itemKey`'s template literal and its matching `.split()` call with `\0` escape sequences (same
  runtime value, since `\0` in a JS/TS string literal *is* U+0000). `file shared/exportRoundtrip.ts`
  now reports "ASCII/Unicode text" instead of "data" — reviewable in `git diff`, findable by grep.

- **#5** (`shared/extractPlacement.test.ts:87-95,104-112`) — two problems, both addressed:
  1. Both snapshot-gated tests used `console.log(...); return;` when the snapshot file was absent,
     which `node:test` reports as **passed**, not skipped — a missing fixture was invisible in the
     `npm test` summary. Changed both to `t.skip(reason)` (using the test's `TestContext`), which
     `node:test` reports as an explicit `# SKIP <reason>` — visible, distinct from a real pass.
  2. Generated and validated a real `extract-snapshot.json` for the Oxford Circle fixture: ran a
     live extraction against the current pipeline (dev server + Playwright, intercepting the
     `/api/gemini/extract` response) using the source PDF from this session's earlier raster-legibility
     work, then checked the result against `assertFixture`/`expected-domains.json` before committing.
     The first run actually failed the fixture's fabrication guard — Gemini transcribed the Partners
     box's `Joseph J. Peter Institute` (source, confirmed by 300dpi visual inspection of the page) as
     `Joseph J. Peters Institute` (the real-world org's actual name, added by the model, not present
     verbatim in the source) — exactly the class of "silent correction" this adversarial fixture
     exists to catch, and the item was still flagged `verbatim: true`. A second run transcribed it
     correctly and is the snapshot now committed at
     `fixtures/oxford-circle-carnell-frc/extract-snapshot.json` (see that fixture's README for the
     full note). The YouthMoves/Performance Garage fixture's source PDF isn't available in this
     session (owner-held, not uploaded this session), so it stays snapshot-less — its test now
     reports as a visible `# SKIP` rather than a silent pass, and its README says so.

Verification for all three: `npm run typecheck` clean, `npm test` 161 pass / 1 skip (the YouthMoves
snapshot, intentionally — see above) / 0 fail, `npm run build` clean.

---

<!-- Original report begins here, verbatim except for this notice. -->

# LM-Extractor — codebase inconsistency audit

Branch: `claude/loving-hawking-r436g3`. 29 findings, ordered by likelihood of causing a real bug.

**Provenance:** run against the 7-point audit prompt from the "LM extraction" session. **No code changes were made** — working tree clean, `npm test` passes 155/155. Tier 1 findings were verified empirically with probe scripts against the real modules, not just by reading.

**Two items (#10, #11) are judgment calls, NOT confirmed bugs.** Read those before "fixing" an intentional design.

---

## Tier 1 — Confirmed bugs / false assurances

### 1. `server/apiCore.ts:58-63` — `parseDocumentBundle` silently drops `imageRefs`, which `server/geminiLogicModel.ts:151` depends on

The client **does** send `imageRefs` (`App.tsx:458` spreads the bundle, stripping only `previewImages`), but the server rebuilds from only `images`/`textTrack`/`warnings`/`sourceFormat`.

Verified end-to-end: every Track B image is labeled `"TRACK B image 1 of 2."` instead of `"…document page 7, column 2"`.

**Why it matters:** the prompt's entire SOURCE LOCATION block (`constants.ts:296-299` — *"Set `sourcePage` to the document page number from the image label"*) refers to a label that is never sent. `sourcePage`/`sourceColumn` are therefore guesses or absent — and those drive the source-review page jump, the spot-check chips, and `sliceDocumentBundle`'s slicing contract. `docs/specs/tech-source-review-v1.md:31,39` describes this labeling as the mechanism that makes anchors work. **Probably the single highest-value fix in this list.**

### 2. `server/geminiLogicModel.ts:106-120` — `extractionStatus` is called "REQUIRED" in the prompt but is not in the schema's `required` array

`constants.ts:326` heads the section `## EXTRACTION FIDELITY STATUS (REQUIRED — NOT DOCUMENT QUALITY)`, and the abstain path depends on the model emitting `extractionStatus: "abstained"`. When omitted, `shared/extractionFidelity.ts:265` defaults to `'ok'`.

Verified: a model with no `extractionStatus` comes back `ok` / `high` / no banner.

**Why it matters:** this is the exact failure the same file's comment at lines 108-112 documents and fixed for `documentTypeAssessment` (*"structured output only actually enforces what's schema-required"*) — the fix was never applied to the sibling field. A document Gemini tried to abstain on silently presents as a high-confidence success. Worth auditing the whole `required` array against every "REQUIRED" claim in `constants.ts`.

### 3. `shared/extractionFidelity.ts:340-380` — documents with N<6 items ignore the non-verbatim ratio entirely, and the guard that looks like it prevents this is dead code

Measured:

| Case | Result |
|---|---|
| `N=5, Vf=4` (80% flagged unreadable) | `ok` / `high` / no banner / no blockers |
| `N=6, Vf=1` (17%) | `partial` / `medium` / banner |

The override at `:377-379` requires `Vf === 0`, implying small docs with any non-verbatim item shouldn't be `high` — but every path reaching it has **already** been set to `high`, so it never changes anything. The comment above it (*"Small docs: high only when ok and not L (already handled)"*) describes a rule the code doesn't enforce.

**Why it matters:** short extracts (a one-page PPTX, a sparse grid) are exactly where a bad OCR read is most likely and least visible, and they route straight to "Successfully Processed" and past the coding-export gate.

### 4. `docs/specs/spot-check-highlighting-v1.md:32-45` — describes `shared/completenessCheck.ts` as the shipped, load-bearing signal; that module was deleted

The doc (Status: **Implemented**) calls the client heuristic *"the one actually producing the fidelity blocker"* and says Gemini's own signal *"essentially never fired."* `docs/specs/tech-extraction-confidence-v1.md:186` correctly marks it **removed 2026-09-18**. Two docs about one feature contradict each other.

**Why it matters:** a reader believes a deterministic completeness check backs `possiblyIncomplete`. There isn't one — the only remaining source is the signal the same doc says never fires, so that blocker is now near-dead in practice. The doc's "Verified: all 93 tests" is also stale (155 now).

### 5. `shared/extractPlacement.test.ts:83-90` and `:104-111` — the two gold-fixture regression tests always no-op

Both do `if (!fs.existsSync(SNAPSHOT_PATH)) { console.log('skip: …'); return; }`. Neither `extract-snapshot.json` exists (both fixture dirs hold only `README.md` + `expected-domains.json`), so both report as **passing** without asserting anything. The rest of that file exercises `assertFixture` only against 3-line synthetic models built inline.

**Why it matters:** ~200 lines of `shared/extractPlacement.ts` assertion machinery, plus both hand-built adversarial fixtures (Oxford Circle's 14 fabrication guards, YouthMoves' placement rules), have never run against a real extraction. `roadmap.md:18-19` lists both features as **Implemented** with exit criteria *"commit snapshot"* — unmet. Both fixture READMEs tell you `npm test` "validates the snapshot"; it doesn't. Either commit snapshots or make the skip loud.

### 6. `shared/exportRoundtrip.ts:96,144` — raw NUL bytes in the source make the file binary to git and ripgrep

`itemKey` embeds a literal `\x00` as the multiset separator (168 NUL bytes total). The logic is correct — but `git diff` on this file prints `Binary files … differ` with zero reviewable content (confirmed), and ripgrep skips it by default (a search for `reconstituteFromExportRows` found only the test file).

**Why it matters:** changes to this file are invisible in code review and grep-based refactors silently miss it. **Fix:** write the separator as `\0` / `\u0000` escapes — no behavior change.

---

## Tier 2 — Same decision made in more than one place

### 7. The "partial or medium" rule exists three times
`shared/extractionFidelity.ts:397` (`shouldSoftGateCodingExport`), `:403-405` (`shouldShowFidelityBanner`), and inline at `App.tsx:488-490` (`fidelityNeedsReview`, which decides whether to auto-open the source pane). All three are `status === 'partial' || confidence === 'medium'`. Tuning one leaves the banner, the export gate, and the pane-open behavior disagreeing about the same document.

### 8. `itemNeedsReview` is defined once and re-implemented twice
`shared/provenance.ts:4` is the stated single source of truth; `shared/domainPresence.ts:101` and `services/codingExport.ts:50` each inline `item.verbatim === false || Boolean(item.sourceNote?.trim())`. Both CSV exports write a `needs_review` column from their own copy; the board uses the shared one.

### 9. `services/fileService.ts:755` vs `types.ts:233-237` — two matchers for the same condition, and they disagree
`bundleImpliesLowLegibility` uses `/low[- ]resolution/i` (both forms, case-insensitive) after a documented bug fix. `assembleDocumentBundle` still uses `w.includes('low-resolution')` — hyphen only, case-sensitive. The PDF warning it needs to match (`:614`) reads *"a flattened image at low resolution"* (**space**).

**Why it matters:** on any PDF that trips the legibility floor, the dedupe fails and `LOW_LEGIBILITY_WARNING` is appended **on top of** the page-specific warning — the user sees the same problem twice and the extraction-log `warnings` column double-counts. DOCX (hyphenated) behaves correctly, so the two formats diverge. This is the identical spaced-vs-hyphenated bug `types.test.ts:21` guards against, fixed in only one of the two places that do this matching.

### 10. ⚠️ JUDGMENT CALL — not a confirmed bug
`constants.ts:279-281` vs `shared/extractNormalize.ts:95-119` — the prompt forbids inferring an Impact Statement from wording; post-processing does it anyway.

The prompt: *"No heading at all … put unlabeled overview prose in `mission`, never in `impactStatement` … never infer one from wording alone."* `promoteImpactStatementFromGroupedDomains` then promotes an outcome item into `impactStatement` based purely on `looksLikeImpactStatementProse` (population noun + change verb + 80-600 chars), no heading involved. An LLM instruction and a regex independently decide the same field, and the code can silently override the model's correct answer.

The sibling path (`impactStatementHarvest.ts:82-96`) was already disarmed for exactly this reason, with a detailed comment about a real document it corrupted. The `MAX_TOTAL_OUTCOME_ITEMS_FOR_PROMOTION = 3` gate narrows but doesn't remove the hazard. **Treat as a tension to decide on, not an automatic fix.**

### 11. ⚠️ JUDGMENT CALL — not a live bug
`normalizeExtractedLogicModel` runs **twice** on every extraction: `server/geminiLogicModel.ts:196` returns an already-normalized model, and `App.tsx:461` normalizes the response again with its own separately-computed options.

Tested across several shapes — the second pass **is** currently idempotent, so nothing is broken today. But it's fragile: pass 2 re-reads pass 1's *derived* blockers as if they were Gemini-reported (`extractionFidelity.ts:264`, `:293`), and the two call sites compute `sourceText` differently (server trims, client doesn't). Any future non-idempotent normalize step will misbehave only in production, never in unit tests.

### 12. `services/fileService.ts:519`, `:648`, `:1114` — payload budget hardcoded three times
`3_800_000` in three places, while `README.md` documents *"Request body ~4.5MB"*. `server.ts:44` allows 40mb; `vercel.json` sets no body limit. The 3.8MB figure is presumably deliberate headroom under Vercel's 4.5MB, but nothing says so and nothing ties the three copies together.

### 13. `services/fileService.ts:336` vs `:975` — column-band detection copy-pasted with a divergent gate
The PDF copy requires `imageDominant && bbox`; the DOCX copy requires only `bbox`. The PDF copy carries the comment *"Column bands: only meaningful for wide, image-dominant grid pages"* — a claim the DOCX copy contradicts. The `bboxFrac` padding block above each is also duplicated verbatim.

---

## Tier 3 — Dead or orphaned

### 14. Unreferenced exports
| Symbol | Location | Status |
|---|---|---|
| `formatAbstainMessage` | `shared/extractionFidelity.ts:422` | `@deprecated`, **zero** callers including tests |
| `getExtractionFidelity` | `shared/extractionFidelity.ts:78` | Zero callers, not even tests |
| `OUTPUT_TRACK_HINTS` / `inferOutputGroup` | `shared/extractNormalize.ts:46-68,188` | `@deprecated` hardcoded YouthMoves regexes "retained for test helpers", but `inferOutputGroup` has **no** caller anywhere |
| `isOutputLikeText` | `shared/extractNormalize.ts:188` | Called only by its own test |
| `readRawBody` | `server/pptxConvertApi.ts:55` | Zero callers |
| `CODING_EXPORT_DOMAINS` | `services/codingExport.ts:7` | Exported, used only to derive its own local type |
| Whole module (166 lines) | `shared/exportRoundtrip.ts` | `checkExportRoundtrip` / `reconstituteFromExportRows` / `diffReconstitution` called **only** from its own test. Docstring frames it as a correctness check on the real CSV export path; it is never run against one |

Note: the `ExtractionFidelity` interface `getExtractionFidelity` returns is the shape `extraction-confidence-v1.md` §A describes as public.

### 15. `scripts/verify-api.mjs:21-25` — the ESM guard covers 3 of 4 serverless functions
`api/gemini/detect-logic-models.ts` is missing from `ROUTES`. The script's header says it guards *"the Vercel serverless functions"* and that the failure it catches *"is invisible until a request hits production."* Anyone adding a function will assume it's covered.

### 16. `services/pptxLibreOfficeBrowser.ts:2-4` — the PPTX browser fallback is wired in but cannot succeed as configured
Its docstring says *"Requires COOP/COEP headers."* `vite.config.ts:10-12` explicitly omits them (*"we omit those headers here to keep Google Fonts working"*), and `server.ts`'s production static serving sets none either. `services/fileService.ts:1311` still falls through to it, and the resulting error message (`:1367`) tells the user to check the **server** endpoint — tacitly conceding the fallback doesn't work.

---

## Tier 4 — Doc vs. implementation drift

### 17. `docs/specs/export-for-coding.md:15,42` — ships four domains; the doc specifies three and forbids changing it without a version bump
AC #2: *"Only the three outcome domains appear (unless rubric/export docs bump version)"* and *"Domain list … live in this doc; bump a one-line version note when changing filter."* `services/codingExport.ts:7-12` includes `General Outcomes` as a fourth. Three version notes were added through v1.3 for **column** changes, none for the domain change. Compounding it: `services/codingExport.ts:96`'s empty-export message still says *"No short-, medium-, or long-term outcome rows."*

### 18. `README.md` — "Both delegate to `server/apiCore.ts`, so behavior stays identical" is false for `/api/health`
`server.ts:63-70` returns `{ok, configured, mode, libreOfficeWasm}` with `mode: 'production'|'development'`; `api/health.ts:5-9` returns no `libreOfficeWasm` and `mode: VERCEL_ENV || NODE_ENV || 'unknown'`. Only `getApiKey` is shared. The PPTX route also diverges structurally (Express uses `express.raw`; Vercel hands the handler whatever it parsed). The README's endpoint list also omits `/api/gemini/detect-logic-models` and `/api/convert/pptx-to-pdf`.

### 19. `.cursor/rules/project.mdc:38` — "Single-pass Gemini pipeline: extract only" is no longer true
There are **two** Gemini calls per multi-page document: the `detect-logic-models` pre-pass plus extract. This file is `alwaysApply: true`, so every agent session reads it as ground truth. Its "AI" line also names only `server/geminiLogicModel.ts`, not `geminiLogicModelGroups.ts`.

### 20. `docs/specs/handoff-next-chat.md:17-24` — stale in the way most likely to mislead
It's meant to be pasted into a fresh agent chat as context. Still describes the pipeline as *"extract → critique → edit"* and lists *"re-critique without unmounting editor; Weak-first collapsible sections"* under "What works" — critique was removed in the 2026-09 narrowing. Also *"`npm test` — 4 validator tests"* (now 155). Unlike `current-prd.md`, it carries no deprecation banner.

### 21. `docs/specs/roadmap.md:19` — "4b — Overall LM quality | Done" with no deprecation marker
`docs/specs/README.md` annotates the same feature as deprecated; the roadmap (last updated 2026-08-31, before the scope change) does not. Rows 20-21 list exit criteria *"commit snapshot"* that finding #5 shows were never met, while status reads **Implemented**.

### 22. `docs/specs/multi-logic-model-pdf-v1.md:79-81, 95-99` — field names and the resume design don't match the code
Doc specifies `pageRange` and `partLabel` (*"e.g. `"2 of 7"`"*); code uses `sourcePageRange` and `splitPartLabel` (`"Part 2 of 7"`).

More substantively, §4 states **Resume**: *"dedupe by `sourceDocumentId` (convert the shared file once, not once per split record)."* **No such dedupe exists** — `App.tsx:296` is the only `sourceDocumentId` read outside persistence and it serves the "treat as one" revert. `ensurePreviewImages` (`App.tsx:646-681`) re-converts per file with only a per-`fileId` guard, so opening the source pane on each of 7 split parts reconverts the same PDF 7 times.

### 23. `App.tsx:120,530,619` — `MAX_CONCURRENT_EXTRACTS = 2` gates extracts and detections through two independent counters
Up to 4 Gemini calls can be in flight, not 2. `App.tsx:353` says *"bounded by MAX_CONCURRENT_EXTRACTS so the batch doesn't hammer Gemini"* and `multi-logic-model-pdf-v1.md` says split entries respect *"the existing MAX_CONCURRENT_EXTRACTS gate unchanged."* Whether 4 is acceptable is a product call; the name/comment vs. behavior mismatch is the issue.

### 24. `shared/documentBundleSlicing.ts:14-18` — "renumbering everything" doesn't include `warnings`
`:52` passes `bundle.warnings` through unchanged, so a "Part 1 of 7" entry covering original pages 1-2 can display *"Page 6 of this document is a flattened image at low resolution."* The docstring's claim that the slice is *"indistinguishable from a normal single-page-range upload"* doesn't hold for the one field a user actually reads.

---

## Tier 5 — Naming / terminology

**25.** `components/LogicModelBoard.tsx:23-25` labels columns `Short-term` / `Medium-term` / `Long-term`, while `shared/domainSynonyms.ts:101-103` (`CANONICAL_DOMAIN_OPTIONS`, used by the reassign dropdown *in the same UI*) and both CSV exports say `Short-Term Outcomes`. Three spellings of one concept, two rendered side by side.

**26.** `App.tsx:123` `STATUS_LABELS` and `components/SessionFileList.tsx:9` `PROCESSING_LABELS` are parallel maps over the same union that disagree: `editing`/`completed` render as `"Ready to edit"` in one and `"Ready"` in the other.

**27.** `components/SessionFileList.tsx:46` — `file.result.extractionConfidence || 'high'` displays "high confidence" for a model where confidence was never computed. Reconcile always sets it today, so this only bites resumed/legacy records — but the fallback asserts the most reassuring value rather than an honest unknown.

**28.** `services/extractionLogExport.ts:38` — `sourceFormatFromDisplayName` is called with `f.file.name`, not `displayFileName(f)`. Correct as written, but the name invites a future caller to pass the display name, which for a split entry ends in `"— Part 2 of 7"` and would silently fall through to `'pdf'`.

**29.** `docs/specs/README.md` — the index omits 6 of 32 spec files, including three recently-shipped features (`multi-logic-model-pdf-v1.md`, `spot-check-highlighting-v1.md`, `extraction-log-export-v1.md`) and `batch-resilience-v1.md`. No broken links in the other direction.

---

## Suggested order

1. **#1, #2, #3** — real behavioral bugs, do these first.
2. **#5, #6** — restore lost safety and reviewability.
3. **#9** — small, contained, one clear correct answer.
4. **#4, #17, #19, #20** — cheap doc fixes that stop future agents acting on false premises.

Re-run `npm test` after each change — it currently passes 155/155, so any new failure is yours.
