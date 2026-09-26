/**
 * Generate the benchmark's .pptx decks from the committed document specs.
 *
 * The decks are build output, not source: `fixtures/benchmark/documents/*.json` is the source, and
 * everything the benchmark compares against is derived from it (see shared/benchmarkDocuments.ts).
 * Regenerating is cheap, so the decks are gitignored rather than committed.
 *
 *   node scripts/make-benchmark-decks.mjs [outputDir]     # default fixtures/benchmark/decks
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { A, P, R, buildDeck, shape } from './make-synthetic-deck.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documentsDir = path.join(root, 'fixtures', 'benchmark', 'documents');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'fixtures', 'benchmark', 'decks'));

/** XML text nodes, so an ampersand or an angle bracket in an item cannot break the package. */
const esc = s =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SLIDE_WIDTH = 9144000;
const MARGIN = 250000;

function renderSlide(slide) {
  const columns = slide.columns;
  const width = Math.floor((SLIDE_WIDTH - 2 * MARGIN) / Math.max(columns.length, 1));
  // Each column is one text box, heading first then its items — the layout a real grid has, so
  // LibreOffice lays the text out in genuine left-to-right bands rather than one reading column.
  const boxes = columns
    .map((column, i) =>
      shape(
        i + 2,
        `col${i}`,
        MARGIN + i * width,
        1150000,
        width - 60000,
        5100000,
        // An empty heading prints no heading line at all — see BenchmarkColumn.heading.
        [...(column.heading ? [esc(column.heading)] : []), ...column.items.map(esc)]
      )
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${shape(100, 'title', MARGIN, 300000, SLIDE_WIDTH - 2 * MARGIN, 700000, [esc(slide.title)])}
${boxes}
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`;
}

mkdirSync(outDir, { recursive: true });
const files = readdirSync(documentsDir).filter(f => f.endsWith('.json')).sort();
const built = [];
for (const file of files) {
  const doc = JSON.parse(readFileSync(path.join(documentsDir, file), 'utf8'));
  const buffer = await buildDeck(doc.slides.length, n => renderSlide(doc.slides[n - 1]));
  const target = path.join(outDir, `${doc.id}.pptx`);
  writeFileSync(target, buffer);
  built.push(`${doc.id}.pptx  ${doc.slides.length} slide(s)  ${buffer.length} bytes`);
}
console.log(built.join('\n'));
console.log(`\n${built.length} deck(s) in ${path.relative(root, outDir) || outDir}`);
