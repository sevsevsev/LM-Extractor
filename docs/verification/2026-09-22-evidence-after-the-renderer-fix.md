# Which of our numbers survived the renderer bug

**Date:** 2026-09-22 · **Prompt version:** 2026-09-20.6 (unchanged; nothing here re-ran an
extraction) · **Instrument:** `scripts/renderer-impact-scan.ts`, written and validated here

Every accuracy and stability figure this project holds was measured before the worker-realm
renderer fix (PR #8, merged 2026-09-22). This sorts them into what still stands, what describes a
path the tool no longer takes, and what cannot be decided without re-running. It re-extracts
nothing and costs no API calls.

## The one fact that does most of the work

**Only two of the five ingest paths ever touched pdf.js.** The bug lived in pdf.js's Web Worker, so
a document that never reached pdf.js could not have been damaged by it:

| Source | Track B (page images) built by | Exposed to the bug |
|---|---|---|
| PDF | pdf.js render (`convertPdfToImages`, fileService.ts:817) | **yes** |
| PPTX | LibreOffice → PDF → the same pdf.js path (fileService.ts:1337) | **yes** |
| DOCX | mammoth → DOM → html2canvas (`renderDocxVisionPages`, fileService.ts:1097) | no |
| XLSX | no images at all — text track only (fileService.ts:1493) | no |
| PNG / JPEG | the upload, re-encoded (fileService.ts:1559) | no |

That alone settles five of the fifteen censused documents without measuring anything.

One caveat on which this section's sorting rests: `manifest.json` does not record a source format
field, so each document's format is read off its `covers` prose. Seven entries name their format
outright; the rest are inferred from how they are described. Adding an explicit `sourceFormat` to
the manifest would make this sorting mechanical next time instead of a reading exercise.

## The instrument

`scripts/renderer-impact-scan.ts` renders each page three times in one process — both realms
patched (today), the worker realm's two methods throwing (before the fix), and the font method
alone throwing — and compares what the rasteriser would paint. It reports per page:

- **blocked** — the page threw before the fix, so no image existed and the app fell back to
  text-only with a warning. This is the fault that is visible in an old bundle.
- **scrambled** — the page rendered, and the glyphs it painted are not the glyphs it paints now.
  This is the fault that is invisible: `ok`, high confidence, full page provenance, mojibake
  rasters.
- **unaffected** — identical output before and after.

It needs the source documents and nothing else: no API key, no network, no dev server. It prints
page numbers, verdicts and hashes and never document text, so its output is safe to paste anywhere
the documents themselves are not.

Validated on four files with known answers, and it agrees with all four:

| File | Expected | Scan |
|---|---|---|
| Hand-built PDF, `/Resources` on both the Page and the Pages node | fault 1 | `BLOCKED` |
| The same file with the parent `/Resources` removed — the only difference | neither | `UNAFFECTED` |
| A DOCX put through this repo's LibreOffice converter (both levels, embedded TrueType) | both faults | `BLOCKED`, 1 page also font-damaged |
| That converted PDF, patched to drop the parent `/Resources` | fault 2 alone | `SCRAMBLED` |

The third and fourth rows reproduce independently what session 26 found by hand: the two faults are
separate, and LibreOffice output hits the first one on every file.

Detecting fault 2 turns on one detail worth keeping. The signature compares each glyph's `fontChar`
and `isInFont` — what the rasteriser actually paints — not its `unicode`, which comes from the
encoding map rather than the font program and does **not** change under the substitution. A scan
built on `unicode` reports the mojibake documents as clean.

## What still stands

**The invention rate.** 0 inventions in 586 items across 14 documents. Invention is a claim about
text appearing in an extraction that is absent from the source; degrading the image track can only
starve the model of information, not manufacture an agreement with the source that is not there. If
any of those captures ran on scrambled rasters, the figure was earned under worse conditions than
the tool now runs in. It stands as a floor, not as a description of the current path.

**The two visual completeness audits.** SEAMAAC (33/33) and Oxford Circle (44/44) were audited by
writing the bundle's own page images out and reading them item by item against the extraction. That
audit could not have been performed on a blocked document (no images) or on a scrambled one (the
reader would have been matching mojibake against clean text). Their rasters were legible, so
neither fault touched them, and both documents' numbers — and their census verdicts — stand.

**Everything measured on DOCX, XLSX and PNG sources.** By the table above: `ymca-youth-civic`,
`ymca-teen-workforce`, `a-new-dawn`, `art-thru-youth`, `upenn-bioeyes`,
`trinity-boys-girls-rising`, and the Philadelphia Zoo XLSX result.

**Instability is not an artefact of the bug.** This is the one that matters for the launch gate.
Of the seven unstable documents in the session 21 census, `art-thru-youth` and
`trinity-boys-girls-rising` are standalone PNGs that never went near pdf.js, and `seamaac-urban-arts`
is a PDF whose rasters we know were legible. Three documents were therefore genuinely unstable on a
healthy path. "Half the corpus is unstable" needs re-measuring; "documents disagree with themselves
under an unchanged prompt" does not.

## What describes a path the tool no longer takes

**Both PPTX entries.** `performance-garage-youthmoves` and `firsthand-pptx` were captured with zero
page images — that is what their manifest `covers` strings record as a conversion failure, and it
was this bug. Every number measured on them, including Performance Garage's 45/47/47 instability
and firsthand's stable verdict, describes a text-only run. Session 26's post-fix deck pass got 47
items in the same groups twice from Performance Garage, which is a different document than the one
the census measured.

**Every pre-2026-09-22 PPTX figure**, already recorded as withdrawn in session 26.

## What cannot be decided without the scan

Eight of the fifteen censused documents are PDFs. Two of those — Oxford Circle and SEAMAAC — are
cleared above by their visual audits. The remaining six have no evidence either way, because fault 2
leaves no trace in a stored result. Two of the six are worth naming, because a conclusion already
rests on the diagnosis:

- **`sample-rock-school-rockreach`** is in the fixture set as "THE ONLY DOCUMENT WHOSE PAGE IMAGES
  ARE ALL UNREADABLE: its font never embedded, so every raster is mojibake". Every raster mojibake
  while the pages still render *is* fault 2's signature. If the scan says so, the fixture's stated
  role — the Track A regression guard, the one document where Track B contributes nothing — is
  wrong, and so is its 63/62/62 instability verdict.
- **`sample-achieve-now`** is in for "one box whose font failed to embed and renders as pure
  mojibake", the dual-track fusion case. One box rather than the whole document argues against
  fault 2, which damages every glyph drawn from the rebuilt font — but it is the same claim, and
  the scan settles it in seconds.

The other four pending a verdict: `healthy-newsworks-core-reporter`,
`healthy-newsworks-cub-reporter`, `harlem-lacrosse`, `sample-mamadele-axe-puro`. Core Reporter's
42/42 completeness was measured mechanically against the text track, so it is untouched by the
rendering question either way — but that also means it says nothing about what vision saw.

`philadelphia-ballet-lets-dance` and `a-new-dawn` were never censused at all (no source file at the
time), so they have no verdict to revise.

## The next measurement, in the order that makes it defensible

1. **Scan the corpus.** `npx tsx scripts/renderer-impact-scan.ts <corpus-dir> --json scan.json`
   over all 103 documents. No API calls, no key, minutes. It yields a number nobody has: what
   share of the corpus was being read through a broken renderer, split by fault.
2. **Delete the old bundles before anything re-runs.** `npm run census` extracts from
   `fixtures/regression-set/bundles/`, which hold the rasters captured at the time. Re-running the
   census against them re-measures the damaged images and produces a number that looks new and is
   not. Recapture first: `node scripts/capture-bundles.mjs <id>=<path>` — 17 Gemini calls, one per
   document, since capture keeps the extraction it produces.
3. **Census at `--passes=3` on the fresh bundles.** 51 calls. With step 2 that is ~68 calls for a
   reproducibility figure measured on the path the tool actually runs — the launch gate's number.
4. **Re-audit only what the scan flags.** A document the scan calls unaffected keeps its audit; one
   it calls blocked or scrambled needs its completeness read again against rasters that are now
   legible, because the model was working from something else the first time.
5. **Correct the manifest** where step 1 contradicts a `covers` string, rather than leaving a
   fixture asserting a failure mode it does not have.

## One thing the scan turned up that is not about the past

Under Node 22, pdf.js 6.3 calls two further methods with no feature check and no fallback:
`Promise.try` (its worker message handler) and `Uint8Array.prototype.toHex` (document
fingerprinting). Both are present in current Chromium, so neither is part of this bug, and this
harness shims them to keep parity with the browser. But they are the same shape as the two that
caused all of the above: recent additions, called unconditionally, and fatal where absent. A
reviewer on a browser a few versions behind gets the same silent text-only fallback nobody noticed
for weeks. Adding both to `polyfills.ts` is a few lines; deciding whether to is a launch question,
not a finding.
