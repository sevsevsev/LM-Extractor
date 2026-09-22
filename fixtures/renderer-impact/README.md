# Renderer-impact fixtures

Four tiny PDFs with known answers, for `scripts/renderer-impact-scan.ts`. None contains client
content: two are hand-built, and the other two come from a four-line Word document written for this
purpose.

    npx tsx scripts/renderer-impact-scan.ts fixtures/renderer-impact

| File | What it is | Expected verdict |
|---|---|---|
| `two-level-resources.pdf` | hand-built; declares `/Resources` on the Page **and** on the Pages node | `BLOCKED` |
| `one-level-resources.pdf` | byte-for-byte the same but for the parent `/Resources` line | `UNAFFECTED` |
| `libreoffice-output.pdf` | a DOCX through this repo's LibreOffice converter: two-level resources *and* an embedded TrueType subset | `BLOCKED`, 1 page also font-damaged |
| `libreoffice-output-single-level.pdf` | the same bytes with the parent `/Resources` overwritten with spaces, so only the font fault remains | `FONT-SUBSTITUTED` |

The first pair isolates fault 1 (`Map.prototype.getOrInsertComputed`, resource-dictionary merge).
The last row isolates fault 2 (`Math.sumPrecise`, embedded TrueType rebuild), which is the one that
leaves no trace in a stored extraction — a page that renders and reports `ok` at high confidence
while pdf.js quietly swaps its fonts. Any change to the scan should keep all four verdicts.

`font-substituted` is not a damage verdict. On four of six real PDFs the substitute painted the
right letters and the page stayed readable; on one it was mojibake throughout. Only pixels tell
them apart, which is what `scripts/renderer-impact-render.mjs` is for.

The single-level variant is patched in place with spaces rather than re-serialised, so every byte
offset in the xref table stays valid; that is why the file is the same size as the one above it.
