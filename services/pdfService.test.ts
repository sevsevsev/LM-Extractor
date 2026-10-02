import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const servicePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pdfService.ts');
const source = readFileSync(servicePath, 'utf8');
/** Comments explain what not to do, so match against code only. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * These are source-level assertions because both behaviours need a real browser (html2canvas, a
 * canvas, Blob-backed JSZip) and the test run is plain Node — the same reason
 * components/LogicModelPdfTemplate.test.ts reads its template as text. Both were verified in a
 * headless Chromium against the 17 blessed snapshots; this keeps them from quietly coming back.
 */

test('an empty capture never reaches jsPDF', () => {
  // A document that extracted nothing paginates to zero `.pdf-page` elements, so the container
  // measures 0x0 and `toDataURL` returns the string "data:," — jsPDF throws on that, and the
  // throw used to abort the whole batch export. Both guards must stay.
  assert.match(
    code,
    /canvas\.width === 0 \|\| canvas\.height === 0/,
    'pdfService must skip a zero-sized canvas before building image data.'
  );
  assert.match(
    code,
    /imgData\.startsWith\('data:image\/'\)/,
    'pdfService must confirm the data URL is an image before handing it to jsPDF.'
  );
});

test('the ZIP is not accumulated whole in memory', () => {
  // `generateAsync({ type: 'blob' })` holds three copies of the finished archive at the peak,
  // which at a few hundred MB can exhaust the tab and make the next source blob fail to read.
  assert.doesNotMatch(
    code,
    /generateAsync\(/,
    "pdfService must stream the archive via generateInternalStream, not generateAsync."
  );
  assert.match(
    code,
    /generateInternalStream\(/,
    'pdfService must build the archive from streamed chunks.'
  );
});
