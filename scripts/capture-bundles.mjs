/**
 * Capture regression-set DocumentBundles by driving the real dev app in headless Chromium.
 *
 * Why this exists: `fixtures/regression-set/bundles/` is gitignored (multi-MB base64 rasters), so
 * a fresh clone cannot run `npm run regression:check` at all — every document reports "bundle not
 * captured" and the runner exits 2 before making a single API call. That made the whole Tier-1
 * loop depend on whichever laptop happened to hold the bundles. This script removes that
 * dependency: given the source documents, it rebuilds the bundles anywhere.
 *
 * Conversion (pdfjs + canvas + html2canvas + LibreOffice WASM) is browser-only, so driving the app
 * is the only path from a source document to a bundle. `captureRegressionBundle` in App.tsx
 * already retains every bundle it builds on `window.__lmRegressionBundles` in DEV builds; this
 * reads that object directly rather than using the download helper, which needs a file chooser.
 *
 * Note this runs the app's normal pipeline, so each document also costs its usual Gemini extract
 * call — capturing N bundles is N calls.
 *
 *   npm run dev            # in another shell; GEMINI_API_KEY must be set
 *   node scripts/capture-bundles.mjs <bundle-id>=/abs/path/to/source.pdf [...]
 *
 * `<bundle-id>` must match the manifest's `bundle` filename without `.json`.
 */
// Playwright is not a project dependency — it is provided by the environment (and the Chromium
// path below is the preinstalled browser). Resolved dynamically so `npm test`/`tsc` never need it.
const { chromium } = await import(process.env.LM_PLAYWRIGHT ?? 'playwright');
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'regression-set', 'bundles');
mkdirSync(OUT, { recursive: true });

// argv: <bundleName>=<absPath> ...
const jobs = process.argv.slice(2).map(a => {
  const i = a.indexOf('=');
  return { name: a.slice(0, i), file: a.slice(i + 1) };
});

const browser = await chromium.launch({
  executablePath: process.env.LM_CHROMIUM || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', m => { const t = m.text(); if (/error|warn|fail/i.test(t)) console.log('  [browser]', t.slice(0, 200)); });
page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0, 300)));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
console.log('app loaded');

await page.setInputFiles('input[type="file"]', jobs.map(j => j.file));
console.log(`uploaded ${jobs.length} file(s); waiting for bundles…`);

const deadline = Date.now() + 15 * 60 * 1000;
let keys = [];
while (Date.now() < deadline) {
  keys = await page.evaluate(() => Object.keys(window.__lmRegressionBundles ?? {}));
  const statuses = await page.evaluate(() =>
    [...document.querySelectorAll('[data-status], .status, [class*="status"]')].slice(0, 6).map(e => e.textContent?.trim().slice(0, 60))
  );
  console.log(`  bundles=${keys.length}/${jobs.length} ${JSON.stringify(keys)} | ui: ${JSON.stringify(statuses.filter(Boolean).slice(0,3))}`);
  if (keys.length >= jobs.length) break;
  await new Promise(r => setTimeout(r, 5000));
}

if (!keys.length) { console.error('NO BUNDLES CAPTURED'); await browser.close(); process.exit(1); }

for (const key of keys) {
  const bundle = await page.evaluate(k => window.__lmRegressionBundles[k], key);
  // match captured key back to the requested bundle name by basename similarity
  const norm = s => s.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const job = jobs.find(j => norm(path.basename(j.file)).includes(norm(key).slice(0, 25)))
           || jobs.find(j => norm(key).includes(norm(path.basename(j.file)).slice(0, 25)));
  const outName = job ? job.name : key.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const p = path.join(OUT, `${outName}.json`);
  writeFileSync(p, JSON.stringify(bundle));
  const imgs = bundle.images?.length ?? 0;
  const tt = bundle.textTrack ? bundle.textTrack.length : 0;
  console.log(`  wrote ${outName}.json  images=${imgs} textTrack=${tt}chars sourceFormat=${bundle.sourceFormat} (key="${key}")`);
}
await browser.close();
console.log('done');
