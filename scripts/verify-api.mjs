/**
 * Guards the Vercel serverless functions against ESM resolution breakage.
 *
 * Vercel transpiles each api/*.ts file individually instead of bundling, so with
 * "type": "module" every relative import needs an explicit .js extension. tsx,
 * Vite and tsc all tolerate extensionless specifiers, so this failure mode is
 * invisible until a request hits production. Here we emit real JS and load each
 * function under plain Node ESM, which reproduces the runtime faithfully.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp-api-verify');

const ROUTES = [
  { route: '/api/health', file: 'api/health.js', probeMethod: 'GET', expect: 200 },
  { route: '/api/gemini/extract', file: 'api/gemini/extract.js', probeMethod: 'DELETE', expect: 405 },
  { route: '/api/gemini/critique', file: 'api/gemini/critique.js', probeMethod: 'DELETE', expect: 405 },
  { route: '/api/convert/pptx-to-pdf', file: 'api/convert/pptx-to-pdf.js', probeMethod: 'DELETE', expect: 405 },
];

function makeRes() {
  const out = { code: 0, body: null };
  const res = {
    status(c) {
      out.code = c;
      return res;
    },
    json(b) {
      out.body = b;
    },
    setHeader() {},
    end() {},
  };
  return { res, out };
}

function cleanup() {
  rmSync(outDir, { recursive: true, force: true });
}

cleanup();

// Call the compiler through node directly so this works the same on Windows and CI.
const tscBin = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const tsc = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.api-verify.json'], {
  cwd: root,
  encoding: 'utf8',
});

if (tsc.status !== 0) {
  console.error('Failed to compile API functions:');
  console.error(tsc.error?.message || tsc.stdout || tsc.stderr || 'unknown compiler failure');
  cleanup();
  process.exit(1);
}

// A placeholder key lets the modules initialize without contacting Gemini.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'placeholder-for-load-check';

let failed = false;

for (const { route, file, probeMethod, expect } of ROUTES) {
  try {
    const mod = await import(pathToFileURL(path.join(outDir, file)).href);
    if (typeof mod.default !== 'function') throw new Error('missing default export handler');

    const { res, out } = makeRes();
    await mod.default({ method: probeMethod, body: {} }, res);

    if (out.code !== expect) {
      throw new Error(`expected status ${expect}, got ${out.code}`);
    }
    console.log(`ok   ${route}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${route}: ${error.code ? `${error.code} ` : ''}${error.message}`);
  }
}

cleanup();

if (failed) {
  console.error('\nAPI functions would crash on Vercel. Relative imports in server-side code need .js extensions.');
  process.exit(1);
}

console.log('\nAll API functions load correctly under Node ESM.');
