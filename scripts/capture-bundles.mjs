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
 * Running the app's normal pipeline means each document costs one Gemini extract call whether or
 * not anyone wanted the extraction. So this takes it: `captureRegressionExtraction` retains the
 * result on `window.__lmRegressionExtractions` under the same key as its bundle, and both come
 * back in this one pass. Capturing N bundles WITH their extractions is N calls, not 2N — which is
 * the difference between 103 and 206 calls over the corpus. Do not add a second extract pass here
 * without saying so in the call count you state before the run.
 * See docs/specs/local-capture-session.md §2.
 *
 *   npm run dev            # in another shell; GEMINI_API_KEY must be set
 *   node scripts/capture-bundles.mjs <bundle-id>=/abs/path/to/source.pdf [...]
 *
 * `<bundle-id>` must match the manifest's `bundle` filename without `.json`.
 *
 * Bundles land in fixtures/regression-set/bundles/ (gitignored), extractions beside them in
 * fixtures/regression-set/extractions/ — feed one straight to `node scripts/audit-coverage.mjs
 * <bundle-id> fixtures/regression-set/extractions/<bundle-id>.json`.
 */
// Playwright is not a project dependency — it is provided by the environment (and the Chromium
// path below is the preinstalled browser). Resolved dynamically so `npm test`/`tsc` never need it.
//
// A cloud session has Playwright installed GLOBALLY, where a bare specifier cannot reach it, so a
// failed import retries against the global root. Two wrinkles, both hit by hand before this fix:
// setting LM_PLAYWRIGHT to the package DIRECTORY raises ERR_UNSUPPORTED_DIR_IMPORT (the catch now
// recovers it), and the package entry is CJS whose named `chromium` cjs-module-lexer cannot see, so
// the import succeeds while `chromium` is undefined — hence reading `.default` instead of
// destructuring, and failing loudly below rather than at `chromium.launch()`.
const pw = await import(process.env.LM_PLAYWRIGHT ?? 'playwright').catch(async () => {
  const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(pathToFileURL(path.join(root, 'playwright', 'index.js')).href);
});
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error('Playwright resolved but exposes no chromium export');
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `LM_BUNDLE_SET` picks which fixture set the capture lands in: the tier-1 regression set by
// default, or `benchmark` for the synthetic accuracy benchmark, which captures the same way from
// generated decks rather than from client documents.
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  process.env.LM_BUNDLE_SET === 'benchmark' ? 'benchmark' : 'regression-set'
);
const OUT = path.join(ROOT, 'bundles');
const OUT_EXTRACTIONS = path.join(ROOT, 'extractions');
mkdirSync(OUT, { recursive: true });
mkdirSync(OUT_EXTRACTIONS, { recursive: true });

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

// Wait on bundle AND extraction, not bundles alone. The bundle lands as soon as conversion
// finishes; the extract call it feeds takes minutes. Breaking on bundle count would close the
// browser while every extraction was still in flight — and since the calls were already paid for,
// that is the expensive way to be wrong.
const deadline = Date.now() + 15 * 60 * 1000;
let keys = [];
while (Date.now() < deadline) {
  const captured = await page.evaluate(() => ({
    bundles: Object.keys(window.__lmRegressionBundles ?? {}),
    extractions: Object.keys(window.__lmRegressionExtractions ?? {}),
  }));
  keys = captured.bundles.filter(k => captured.extractions.includes(k));
  const statuses = await page.evaluate(() =>
    [...document.querySelectorAll('[data-status], .status, [class*="status"]')].slice(0, 6).map(e => e.textContent?.trim().slice(0, 60))
  );
  console.log(`  bundles=${captured.bundles.length}/${jobs.length} extractions=${captured.extractions.length}/${jobs.length} ${JSON.stringify(keys)} | ui: ${JSON.stringify(statuses.filter(Boolean).slice(0,3))}`);
  if (keys.length >= jobs.length) break;
  await new Promise(r => setTimeout(r, 5000));
}

// Fall back to whatever bundles exist: a document that errored before extracting still yields a
// usable bundle, and losing it would mean paying its conversion again.
if (!keys.length) {
  keys = await page.evaluate(() => Object.keys(window.__lmRegressionBundles ?? {}));
  if (keys.length) console.log(`  no paired extractions; writing ${keys.length} bundle(s) alone`);
}

if (!keys.length) { console.error('NO BUNDLES CAPTURED'); await browser.close(); process.exit(1); }

for (const key of keys) {
  const bundle = await page.evaluate(k => window.__lmRegressionBundles[k], key);
  // match captured key back to the requested bundle name by basename similarity
  const norm = s => s.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  const job = jobs.find(j => norm(path.basename(j.file)).includes(norm(key).slice(0, 25)))
           || jobs.find(j => norm(key).includes(norm(path.basename(j.file)).slice(0, 25)));
  const outName = job ? job.name : key.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  writeFileSync(path.join(OUT, `${outName}.json`), JSON.stringify(bundle));
  const imgs = bundle.images?.length ?? 0;
  const tt = bundle.textTrack ? bundle.textTrack.length : 0;
  console.log(`  wrote ${outName}.json  images=${imgs} textTrack=${tt}chars sourceFormat=${bundle.sourceFormat} (key="${key}")`);

  const extraction = await page.evaluate(k => window.__lmRegressionExtractions?.[k] ?? null, key);
  if (extraction) {
    writeFileSync(path.join(OUT_EXTRACTIONS, `${outName}.json`), JSON.stringify(extraction, null, 2));
    console.log(`  wrote extractions/${outName}.json  promptVersion=${extraction.promptVersion ?? 'unknown'} variant=${extraction.promptVariant ?? 'default'}`);
  } else {
    console.log(`  no extraction retained for "${key}" — audit needs one, so re-extract or recapture`);
  }
}
await browser.close();
console.log('done');
