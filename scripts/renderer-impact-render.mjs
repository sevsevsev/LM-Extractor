/**
 * Render one PDF page twice in a real browser — as the renderer draws it today, and as it drew it
 * before the worker-realm fix — and write both PNGs out to be LOOKED AT.
 *
 * WHY THIS EXISTS. `renderer-impact-scan.ts` can tell you a page fell back to substituted fonts.
 * It cannot tell you whether that mattered, and the difference is everything: a substitution with a
 * sane encoding paints the right letters in the wrong typeface, and one without paints !ES#)!CES.
 * The scan reported all six of Severin's PDFs as damaged; these pictures showed four of them were
 * fine, one was mojibake throughout, and one had lost a single box. No signal short of pixels
 * settles it, so when the scan says `font-substituted`, come here.
 *
 *   node scripts/renderer-impact-render.mjs <file.pdf> [page] [outDir]
 *
 * Needs Playwright and a Chromium, which a cloud session already has (set `LM_CHROMIUM` to the
 * browser binary). It serves a scratch directory over localhost so pdf.js can fetch its worker;
 * nothing leaves the machine, and the PDF is copied to a temp dir rather than published anywhere.
 */
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const [srcArg, pageArg = '1', outArg] = process.argv.slice(2);
if (!srcArg) {
  console.error('usage: node scripts/renderer-impact-render.mjs <file.pdf> [page] [outDir]');
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = outArg ? path.resolve(outArg) : mkdtempSync(path.join(tmpdir(), 'renderer-impact-'));
mkdirSync(outDir, { recursive: true });

const work = mkdtempSync(path.join(tmpdir(), 'renderer-impact-web-'));
copyFileSync(srcArg, path.join(work, 'doc.pdf'));
try {
  symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'));
} catch {
  /* already there */
}

/**
 * The main thread is polyfilled in BOTH runs, because it always was: `polyfills.ts` shipped from
 * the start and only the worker went unpatched. Patching one realm and not the other is the whole
 * bug, so the comparison has to keep that asymmetry rather than turning both off.
 */
const PAGE = `<!doctype html><html><body style="margin:0"><canvas id="c"></canvas><script type="module">
const POLYFILL = ${JSON.stringify(`
for (const C of [Map, WeakMap]) if (!C.prototype.getOrInsertComputed) Object.defineProperty(C.prototype, 'getOrInsertComputed', { configurable: true, writable: true, value: function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); } });
if (!Math.sumPrecise) Math.sumPrecise = vals => { let s = 0; for (const v of vals) s += Number(v); return s; };
`)};
(0, eval)(POLYFILL);
const pdfjs = await import('/node_modules/pdfjs-dist/build/pdf.mjs');
const realWorker = new URL('/node_modules/pdfjs-dist/build/pdf.worker.mjs', location.href).href;
const params = new URLSearchParams(location.search);
pdfjs.GlobalWorkerOptions.workerSrc = params.get('patched') === '1'
  ? URL.createObjectURL(new Blob([POLYFILL + '\\nawait import(' + JSON.stringify(realWorker) + ');\\n'], { type: 'text/javascript' }))
  : realWorker;
try {
  const page = await (await pdfjs.getDocument({ url: '/doc.pdf' }).promise).getPage(Number(params.get('page') || 1));
  const viewport = page.getViewport({ scale: 1.6 });
  const canvas = document.getElementById('c');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  document.title = 'done';
} catch (error) {
  document.title = 'ERROR ' + error.message;
}
</script></body></html>`;
writeFileSync(path.join(work, 'index.html'), PAGE);

const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.pdf': 'application/pdf' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const full = rel.startsWith('node_modules/') ? path.join(root, rel) : path.join(work, rel);
  try {
    const body = await readFile(full);
    res.writeHead(200, { 'content-type': types[path.extname(full)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const playwright = await import('playwright').catch(() =>
  import(path.join(process.env.LM_PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright', 'index.js'))
);
const chromium = playwright.chromium ?? playwright.default?.chromium;
const browser = await chromium.launch({ executablePath: process.env.LM_CHROMIUM || undefined });
const name = path.basename(srcArg).replace(/\.[^.]+$/, '');
for (const [label, patched] of [['after-fix', '1'], ['before-fix', '0']]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.goto(`${base}/index.html?patched=${patched}&page=${pageArg}`);
  await page.waitForFunction(() => document.title === 'done' || document.title.startsWith('ERROR'), { timeout: 90_000 });
  const title = await page.title();
  const out = path.join(outDir, `${name}-p${pageArg}-${label}.png`);
  await page.locator('#c').screenshot({ path: out });
  console.log(`${label.padEnd(10)} ${title === 'done' ? out : title}`);
  await page.close();
}
await browser.close();
server.close();
console.log(`\nLook at both. Same words in a different typeface is a substitution and harmless;\ngibberish in the right places is the damage this is hunting.`);
