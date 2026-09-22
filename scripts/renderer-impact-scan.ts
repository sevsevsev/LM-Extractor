/**
 * Which documents did the worker-realm renderer bug actually damage?
 *
 * WHY THIS EXISTS. Until 2026-09-22 `polyfills.ts` patched pdf.js's two unguarded TC39 calls on the
 * main thread only, while pdf.js parses, sanitises fonts and renders inside a Web Worker — its own
 * realm, with its own `Map.prototype` and `Math`. Two independent faults followed, and the second
 * one is invisible after the fact:
 *
 *   FAULT 1  `Map.prototype.getOrInsertComputed`, reached by `Dict.merge` on any PDF declaring
 *            `/Resources` at more than one level of the page tree. Every render and every text read
 *            on that page threw, the app fell back to text-only, and said so in a warning.
 *   FAULT 2  `Math.sumPrecise`, reached while rebuilding an embedded TrueType font's `glyf`/`loca`
 *            tables. The page still renders; pdf.js substitutes a standard font addressed by raw
 *            glyph index, so RESOURCES rasterises as !ES#)!CES. The run reports `ok`, high
 *            confidence, full page provenance. NOTHING in a stored extraction distinguishes it from
 *            a good one, which is why the corpus cannot be triaged by reading old results.
 *
 * So triage has to start from the source documents, and this does it without a single API call: it
 * renders each page twice in-process — once with both realms patched (today), once with the worker
 * realm's calls throwing (before the fix) — and compares what came out. A third pass disables only
 * the font method, because fault 1 makes a page throw before fault 2 can show itself, and a
 * document blocked today would still have had scrambled glyphs the moment someone unblocked it.
 *
 * It emits page counts, verdicts and hashes — never document text — so its output is safe to paste
 * into a chat or a log. The documents themselves never leave the machine it runs on.
 *
 *   npx tsx scripts/renderer-impact-scan.ts <file-or-directory>… [--json out.json]
 *
 * PDFs are read directly; DOCX/PPTX/XLSX go through the same LibreOffice converter the app uses, so
 * the PDF scanned is the PDF the app would have rendered.
 *
 * `fixtures/renderer-impact/` holds four files whose verdicts are known — run the scan over that
 * directory after changing anything here, and see its README for what each one isolates.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Methods current Chromium has shipped and Node 22 has not. NOT part of the bug under test — the
 * browser has these, so leaving them missing here would manufacture failures the app never had.
 * They are the same class of unguarded pdf.js call, though: worth re-checking whenever pdfjs-dist
 * is upgraded, because a browser one version behind is a realm that lacks them.
 */
const g = globalThis as Record<string, any>;
if (typeof (Promise as any).try !== 'function') {
  (Promise as any).try = (fn: (...a: any[]) => any, ...args: any[]) => new Promise(res => res(fn(...args)));
}
for (const [name, impl] of [
  ['toHex', function (this: Uint8Array) { return Buffer.from(this).toString('hex'); }],
  ['toBase64', function (this: Uint8Array) { return Buffer.from(this).toString('base64'); }],
] as const) {
  if (typeof (Uint8Array.prototype as any)[name] !== 'function') {
    Object.defineProperty(Uint8Array.prototype, name, { configurable: true, writable: true, value: impl });
  }
}
if (typeof (Uint8Array as any).fromHex !== 'function') {
  (Uint8Array as any).fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'));
}

/** Which of the two methods the worker realm is currently allowed to use. */
type Realm = { resourceMerge: boolean; fontRebuild: boolean };
let workerRealm: Realm = { resourceMerge: true, fontRebuild: true };

/**
 * pdf.js's worker code runs in the same process here (Node uses its fake worker), so the realms are
 * told apart by the calling frame: `pdf.worker.mjs` is worker-side — the realm that ran unpatched —
 * and `pdf.mjs` is the main thread, which `polyfills.ts` had patched all along. Index 3 is the
 * caller of the polyfilled method: 0 is the `Error` header, 1 is this function, 2 is the method.
 */
function callerIsWorkerRealm(): boolean {
  return (new Error().stack || '').split('\n')[3]?.includes('pdf.worker.') ?? false;
}

for (const Ctor of [Map, WeakMap]) {
  Object.defineProperty(Ctor.prototype, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value: function (this: Map<unknown, unknown>, key: unknown, computeValue: (k: unknown) => unknown) {
      if (!workerRealm.resourceMerge && callerIsWorkerRealm()) {
        throw new TypeError('properties.getOrInsertComputed is not a function');
      }
      if (!this.has(key)) this.set(key, computeValue(key));
      return this.get(key);
    },
  });
}
Object.defineProperty(Math, 'sumPrecise', {
  configurable: true,
  writable: true,
  value: function (values: Iterable<number>) {
    if (!workerRealm.fontRebuild && callerIsWorkerRealm()) {
      throw new TypeError('Math.sumPrecise is not a function');
    }
    let sum = 0;
    let compensation = 0;
    for (const raw of values) {
      const value = Number(raw);
      const next = sum + value;
      compensation += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
      sum = next;
    }
    return sum + compensation;
  },
});

const pdfjs: any = await import('pdfjs-dist/build/pdf.mjs');
pdfjs.setVerbosityLevel?.(0);

const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = `${path.join(PDFJS_ROOT, 'standard_fonts')}/`;
const CMAPS = `${path.join(PDFJS_ROOT, 'cmaps')}/`;

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);

interface PageFingerprint {
  page: number;
  error?: string;
  /** The glyphs the rasteriser would actually paint — the only place fault 2 is visible. */
  glyphHash?: string;
  glyphCount?: number;
  textHash?: string;
}

async function fingerprint(data: Uint8Array, realm: Realm): Promise<PageFingerprint[]> {
  workerRealm = realm;
  const pages: PageFingerprint[] = [];
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    // App parity, and it matters more than it looks. `services/fileService.ts` calls `getDocument`
    // with the data alone, so the app ships NO standard font data: pdf.js leaves a non-embedded
    // Helvetica to the system font and never rebuilds it. Handing this harness
    // `standardFontDataUrl` would send every such document down a rebuild path the app does not
    // have, and fault 2 would then be reported on documents that never had it. Pass
    // `--standard-fonts` to model the app AFTER someone wires the font data up, not as it is.
    ...(process.argv.includes('--standard-fonts')
      ? { standardFontDataUrl: STANDARD_FONTS, cMapUrl: CMAPS, cMapPacked: true }
      : {}),
  });
  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const text = (await page.getTextContent()).items
          .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
          .join('');
        const ops = await page.getOperatorList();
        let glyphs = '';
        for (let k = 0; k < ops.fnArray.length; k++) {
          if (ops.fnArray[k] !== pdfjs.OPS.showText) continue;
          for (const glyph of ops.argsArray[k][0] || []) {
            if (!glyph || typeof glyph !== 'object') continue;
            // `fontChar` is the character the rasteriser actually paints out of the loaded font, and
            // `isInFont` says whether that font really has it. Both change under fault 2's silent
            // substitution while `unicode` — which comes from the encoding map, not the font
            // program — does not, so comparing `unicode` would miss exactly the case this looks for.
            glyphs += `${glyph.fontChar}${glyph.isInFont ? '' : '!'}`;
          }
        }
        pages.push({ page: i, glyphHash: hash(glyphs), glyphCount: glyphs.length, textHash: hash(text) });
      } catch (error) {
        pages.push({ page: i, error: `${(error as Error).name}: ${(error as Error).message}`.slice(0, 100) });
      }
    }
  } catch (error) {
    pages.push({ page: 0, error: `document: ${(error as Error).message}`.slice(0, 100) });
  } finally {
    await task.destroy().catch(() => {});
    workerRealm = { resourceMerge: true, fontRebuild: true };
  }
  return pages;
}

type Verdict = 'blocked' | 'scrambled' | 'unaffected';

interface DocumentResult {
  file: string;
  pages: number;
  verdict: Verdict;
  blockedPages: number[];
  scrambledPages: number[];
  /** Pages fault 1 blocked that fault 2 would have scrambled anyway once unblocked. */
  scrambledBehindBlock: number[];
  note?: string;
}

const OFFICE = new Set(['.docx', '.pptx', '.xlsx', '.doc', '.ppt', '.xls', '.odt', '.odp', '.ods']);

async function toPdf(file: string): Promise<Uint8Array> {
  const ext = path.extname(file).toLowerCase();
  const bytes = new Uint8Array(readFileSync(file));
  if (ext === '.pdf') return bytes;
  if (!OFFICE.has(ext)) throw new Error(`unsupported extension ${ext}`);
  const { getLibreOfficeConverter } = await import('../server/libreOfficeConverter.js');
  const converter = await getLibreOfficeConverter();
  const result = await converter.convert(
    bytes,
    // The extension IS the converter's format name for every entry in OFFICE; the cast is because
    // that guarantee lives in the set above rather than in the type.
    { outputFormat: 'pdf', inputFormat: ext.slice(1) as Parameters<typeof converter.convert>[1]['inputFormat'] },
    path.basename(file)
  );
  return new Uint8Array(result.data);
}

async function scan(file: string): Promise<DocumentResult> {
  const data = await toPdf(file);
  const now = await fingerprint(data, { resourceMerge: true, fontRebuild: true });
  const before = await fingerprint(data, { resourceMerge: false, fontRebuild: false });
  const fontOnly = await fingerprint(data, { resourceMerge: true, fontRebuild: false });

  const blockedPages: number[] = [];
  const scrambledPages: number[] = [];
  const scrambledBehindBlock: number[] = [];
  for (let i = 0; i < now.length; i++) {
    const page = now[i].page;
    if (before[i]?.error) {
      blockedPages.push(page);
      if (fontOnly[i] && !fontOnly[i].error && fontOnly[i].glyphHash !== now[i].glyphHash) {
        scrambledBehindBlock.push(page);
      }
    } else if (before[i]?.glyphHash !== now[i].glyphHash) {
      scrambledPages.push(page);
    }
  }
  const verdict: Verdict = blockedPages.length ? 'blocked' : scrambledPages.length ? 'scrambled' : 'unaffected';
  return {
    file,
    pages: now.length,
    verdict,
    blockedPages,
    scrambledPages,
    scrambledBehindBlock,
    note: now.some(p => p.error) ? 'fails to render even with the fix — look at this one by hand' : undefined,
  };
}

function collect(target: string): string[] {
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) return collect(full);
    const ext = path.extname(entry.name).toLowerCase();
    return ext === '.pdf' || OFFICE.has(ext) ? [full] : [];
  });
}

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
const FLAGS = new Set(['--standard-fonts']);
const targets = (jsonAt >= 0 ? [...args.slice(0, jsonAt), ...args.slice(jsonAt + 2)] : args)
  .filter(arg => !FLAGS.has(arg))
  .flatMap(collect);

if (!targets.length) {
  console.error('usage: npx tsx scripts/renderer-impact-scan.ts <file-or-directory>… [--json out.json]');
  process.exit(2);
}

const results: DocumentResult[] = [];
for (const file of targets) {
  try {
    const result = await scan(file);
    results.push(result);
    const detail =
      result.verdict === 'blocked'
        ? `pages ${result.blockedPages.join(',')} produced no image` +
          (result.scrambledBehindBlock.length ? `; ${result.scrambledBehindBlock.length} also font-damaged` : '')
        : result.verdict === 'scrambled'
          ? `pages ${result.scrambledPages.join(',')} rendered with the wrong glyphs`
          : 'identical before and after the fix';
    console.log(`${result.verdict.toUpperCase().padEnd(10)} ${path.basename(file)} (${result.pages}p) — ${detail}`);
    if (result.note) console.log(`           note: ${result.note}`);
  } catch (error) {
    results.push({ file, pages: 0, verdict: 'unaffected', blockedPages: [], scrambledPages: [], scrambledBehindBlock: [], note: `scan failed: ${(error as Error).message}` });
    console.log(`SKIPPED    ${path.basename(file)} — ${(error as Error).message}`);
  }
}

const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] || 0) + 1 }), {});
console.log(`\n${results.length} documents: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`wrote ${jsonOut}`);
}
