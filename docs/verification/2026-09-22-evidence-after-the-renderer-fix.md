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
- **font-substituted** — the page rendered, with different fonts than it uses now. This is the
  fault that leaves no trace in a stored result: `ok`, high confidence, full page provenance. It
  means LOOK AT THE PAGE, not "this document is damaged" — see the correction below.
- **unaffected** — identical output before and after.

It needs the source documents and nothing else: no API key, no network, no dev server. It prints
page numbers, verdicts and hashes and never document text, so its output is safe to paste anywhere
the documents themselves are not.

Validated on four files with known answers, and it agrees with all four:

| File | Expected | Scan |
|---|---|---|
| Hand-built PDF, `/Resources` on both the Page and the Pages node | fault 1 | `BLOCKED` |
| The same file with the parent `/Resources` removed — the only difference | neither | `UNAFFECTED` |
| A DOCX put through this repo's LibreOffice converter (both levels, embedded TrueType) | both faults | `BLOCKED`, 1 page also font-substituted |
| That converted PDF, patched to drop the parent `/Resources` | fault 2 alone | `FONT-SUBSTITUTED` |

The third and fourth rows reproduce independently what session 26 found by hand: the two faults are
separate, and LibreOffice output hits the first one on every file.

Detecting fault 2 turns on one detail worth keeping. The signature compares each glyph's `fontChar`
and `isInFont` — what the rasteriser reaches for — not its `unicode`, which comes from the encoding
map rather than the font program and does not move at all here.

### The correction, and it is the important part of this document

**A substitution is not damage, and this tool said it was.** Run over Severin's six PDFs it called
all six `SCRAMBLED`, including Oxford Circle — whose page images a reader had already read item by
item to reach 44/44. A verdict contradicting a direct observation is the verdict that is wrong, so
the next step was pixels: `scripts/renderer-impact-render.mjs` renders a page in a real browser
twice, once as it draws today and once as it drew before the fix, and writes both PNGs out.

| Document | Before the fix, on the page | Verdict |
|---|---|---|
| Oxford Circle | every word legible, different typeface | fine |
| Healthy NewsWorks Core Reporter | legible | fine |
| Healthy NewsWorks Cub Reporter | legible | fine |
| Mamadêlê | legible | fine |
| Achieve Now | one Long-Term Outcomes box mojibake; rest legible | partly damaged |
| Rock School | mojibake on every page | damaged |

What the signal really detects is pdf.js dropping the embedded font for a substitute. Where the
embedded font carries a sane encoding the substitute paints the right letters and the page reads
fine; where it does not, RESOURCES rasterises as `!ES#)!CES`. Four of six were the former.

This is the project's own recurring lesson wearing a new hat — session 22's "the probe is narrower
than the data", here as "the probe is *different* from the thing". Two near-misses in one hour on
one tool: this one, and an earlier draft that supplied `standardFontDataUrl`, which the app does
not, and so reported fault 2 on documents that never had it.

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

## What the pictures decided

**Rock School was this bug, not the document.** It sits in the fixture set as "THE ONLY DOCUMENT
WHOSE PAGE IMAGES ARE ALL UNREADABLE: its font never embedded, so every raster is mojibake", and on
that basis it is the set's guard for text-track quality, the one document where Track B is supposed
to contribute nothing. Rendered on today's code it is completely legible — organisation name,
programme name, contact, the lot — and a fresh capture produces five page images where the entry
says there should be none. Its `covers` string, its role in the set and its 63/62/62 instability
verdict all need rewriting.

**Achieve Now lost one box.** The mojibake box in Long-Term Outcomes now reads "Volunteers and
students receive stronger, more targeted support", so this file no longer covers dual-track fusion
on a single cell.

**RETRACTED 2026-09-23 — the second half of that paragraph was wrong.** It said the manifest's
never-repair guard had turned backwards: that "the source does not read `Hjgh`", that the renderer
was substituting the glyph, and that on a healthy renderer the box reads `High`. Magnified 6x, the
first Long-term box reads `Hjgh` on today's renderer AND on the pre-fix render. The typeface moved;
the letters never did. The typo belongs to the source document, the guard as originally written is
right, and an extraction that tidies it to `High` is still a regression.

The mistake is worth naming because it is the same one this document already confesses to one
section above. Achieve Now has two boxes in play — the damaged mojibake one and the `Hjgh` one,
three rows apart — and the claim went in on the assumption that they were the same box, without
cropping and reading it. A verdict published ahead of the pixels, twice on one document.

**The other four PDFs keep their numbers**, including Oxford Circle's 44/44 and both Healthy
NewsWorks models.

**Still unmeasured:** `harlem-lacrosse` (not uploaded), `philadelphia-ballet-lets-dance` (never
tested at all), and `seamaac-urban-arts`, which is cleared by its own visual audit rather than by
this scan.

## The measurement itself, run 2026-09-23

Severin uploaded 14 of the 17. Every one was recaptured from source on today's code — the stored
bundles held the damaged rasters and were deleted first — then run three times. 56 Gemini calls.

**12 of 14 came back byte-identical across three runs.** The two that moved were Oxford Circle and
Art Thru Youth, both with identical item counts on every pass. Four documents that were unstable in
the September 20 census now reproduce exactly: Performance Garage (47), Cub Reporter (124), Trinity
(54) and Rock School (61).

Then both movers were taken apart with a probe that compares per-domain item membership, not just
group names:

- **Oxford Circle: zero items changed column, none appeared, none vanished.** The whole of its
  instability was four group names arriving as `Frontline Staff:` on one run and `Frontline Staff`
  on the next. `trimGroupNameColons` in `shared/extractNormalize.ts` drops a trailing colon from a
  group name — no committed snapshot has one, and `promoteInlineColonLabels` already strips its
  own, so it only catches names the model wrote. With it live the census returns Oxford Circle
  STABLE, byte-identical across three runs.
- **Art Thru Youth: zero items changed column, and three fresh passes showed no differences at
  all.** The document the census had just called unstable then agreed with itself three times. It
  is the 1024×768 low-legibility PNG that has flipped in every direction across sessions, so it is
  an occasional flipper rather than a solved case.

**So: 13 of 14 hold byte-identical, and 14 of 14 produced the same items in the same columns on
every pass.** Against 7 of 15 unstable on September 20.

Two things this does not say. **#8 and #9 both landed between the censuses**, so this is a
statement about today's code, not proof that the renderer fix did it. And **item counts moved** —
Cub Reporter 144 to 124, Rock School 63 to 61 — so these are different extractions from the ones
that were audited, and nobody has checked the new ones for accuracy. Reproducible and wrong is the
one failure this loop cannot see.

## What is left, in the order that makes it defensible

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
4. **Re-audit only what the pictures condemn.** A document the scan calls unaffected keeps its
   audit, and so does one whose substituted pages still read cleanly. Only a genuinely damaged
   document — Rock School wholly, Achieve Now in one box — needs its completeness read again,
   because only there was the model working from something other than the document.
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
