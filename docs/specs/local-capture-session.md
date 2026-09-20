# Runbook — local capture session

For a Claude Code session running **on the owner's machine**, with the logic-model source files in
a local directory. Written because the cloud sessions cannot reach that directory, and because
`fixtures/regression-set/bundles/` is gitignored, so bundles can never be handed between machines.

**That gitignore is the reason this session exists and the reason it must do the whole loop.**
A local session that only captures bundles has produced nothing transferable. What it hands back
is *findings*: audit records, manifest entries, code and test changes. The bundles stay on the
machine that made them.

---

## 1. Setup

```bash
git clone <repo> && cd LM-Extractor
git checkout claude/loving-hawking-r436g3     # or branch from it
npm install
printf 'GEMINI_API_KEY=%s\n' "$YOUR_KEY" > .env.local   # .env* is gitignored
npm test                                       # expect 244 pass / 1 skipped, 0 fail
```

Playwright is **not** a project dependency — `scripts/capture-bundles.mjs` resolves it at runtime:

```bash
npm i -D playwright && npx playwright install chromium
```

If it resolves oddly, the script honours two escape hatches:
`LM_PLAYWRIGHT=/path/to/playwright/index.mjs` and `LM_CHROMIUM=/path/to/chrome`.

**Port gotcha.** `capture-bundles.mjs` hardcodes `http://localhost:3000`. If Vite finds 3000 taken
it silently starts on 3001 and every capture times out with `NO BUNDLES CAPTURED`. Check the
`npm run dev` banner before blaming the script.

---

## 2. Do this first: make the bulk run cost half

`App.tsx` calls `captureRegressionBundle` (~line 515) and then `extractLogicModel` (~line 530) in
the same upload flow, so **capturing a bundle already spends one Gemini extract call per
document**. The extraction result then goes into React state and is unreachable from Playwright, so
the current loop re-extracts over HTTP and pays a *second* call per document. Over ~103 documents
that is 206 calls where 103 would do.

Add a dev-only global beside the existing one — same shape, same `import.meta.env.DEV` guard, same
"compiled out of production" property — retaining the extracted model per file. Then
`capture-bundles.mjs` can read bundle *and* extraction in one pass.

Land it as its own themed commit with a test, before any bulk capture. It pays for itself on the
first run.

---

## 3. Constraints that are not negotiable

These come from the working agreement in `constants.ts`'s header and `AGENTS.md`:

- **`echo ${#GEMINI_API_KEY}` before anything that calls the API. Stop if it prints 0.**
- **State the expected Gemini call count before any run touching more than ~20 documents** — and
  count capture calls, which is the mistake the cloud sessions made (a "5-call" batch was 10).
- **Never reword `constants.ts` without explicit approval from the owner.** Any wording change
  means bumping `PROMPT_VERSION`, running `npm run prompt:snapshot`, and showing the snapshot diff.
- **One themed change per run.** Propose several findings separately; do not bundle them.
- **Do not self-grade a prompt diff.** Measure it against a same-prompt control.
- Report what you find. Do not fix things silently.

---

## 4. Capturing

```bash
npm run dev            # separate shell
node scripts/capture-bundles.mjs <bundle-id>=/abs/path/one.pdf <bundle-id>=/abs/path/two.docx
```

`<bundle-id>` must match the manifest's `bundle` filename without `.json`.

**Batch 5–10 files at a time**, not 103. The script uploads every file in one `setInputFiles` call
and gives the whole batch a 15-minute deadline; large PPTX and multi-page PDF conversion is slow
and browser-side, so a big batch times out and you lose the whole run.

---

## 5. Auditing — and the instrument is the usual suspect

```bash
node scripts/audit-coverage.mjs <bundle-id> <path-to-extraction.json>
```

It checks every item and the scalar fields against Track A, whitespace/markup-normalised, and
reduces a few hundred items to a handful needing human eyes. A miss is **not** an invention — Track
A can legitimately lack what only the page image carries. A miss means *look at the page image*.

**Four times now a false "missing" finding came from the probe being narrower than the data**
(whitespace, hard line breaks mid-phrase, scalar fields, Markdown emphasis). The direction is
always the same: absence is what a weak instrument manufactures. Before reporting that something is
missing, check the probe. If you add a normalisation clause, add it to `audit-coverage.mjs` with
the reason, rather than special-casing a document.

Read the page images directly for anything the probe flags. `docs/verification/` has three worked
examples of the whole method.

---

## 6. Stability — read this before trusting any diff

`npm run census -- --passes=3`

**Seven of fifteen documents in the current set change under an unchanged prompt.** A regression
diff on those means nothing without a same-prompt control. The tool refuses to print STABLE below
3 passes on purpose. Census anything you add to `manifest.json`.

Cost: one call per document per pass.

---

## 7. What to prioritise

The corpus is ~103+ files: roughly 78 PDF, 11 DOCX, 7 PPTX, 5 PNG, 2 XLSX. The PDFs are mostly the
clean-grid case, which is already well covered — 0 inventions in 586 items across 14 documents.
The evidence is thinnest exactly where the failure modes have been found:

- **XLSX** — one spreadsheet turned out to hold *eight* complete logic models in eight sheets, all
  merged into one extraction, because `shared/documentBundleSlicing.ts` matches `## Page N` /
  `## Slide N` and never `## Sheet:`. Two more spreadsheets would say whether that is worth a
  sheet splitter. It also produced 17 bare-number junk items out of 77.
- **PNG** — vision-only, no text track at all, so nothing backstops a misread.
- **PPTX** — the slide path, and the source of the most unstable document in the set.

Open question worth watching for: A New Dawn routes an explicitly labelled
`SHORT-TERM OUTCOMES (3–12 months)` section into `generalOutcomes` while its INTERMEDIATE and
LONG-TERM siblings route correctly — reproducible 3/3, and two prompt rewrites failed to move it
(friction log session 23). **A second instance would justify a client-side re-router; one does
not.** If you see it again, say so.

---

## 8. Recording

- Per-batch audit record in `docs/verification/`, following the existing files.
- A session entry in `docs/specs/friction-log.md`, with cause tags and a row in the running tally
  at the bottom. That log is the project's memory; findings that only ever appeared in a chat
  window are lost.
- New fixtures go in `fixtures/regression-set/manifest.json` with a `covers` note saying what
  failure mode the document is *for*.
- Commit findings, manifest entries, code and tests. Never commit bundles.
