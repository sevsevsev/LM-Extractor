/**
 * Replay our post-processing over saved Gemini answers, offline.
 *
 * THE PROBLEM THIS SOLVES. `normalizeExtractedLogicModel` composes six passes — impact-statement
 * harvest, inline-label promotion, colon trimming, source-aware mapping, fidelity reconciliation
 * and the page-coverage check. Each has unit tests over hand-built objects; their COMPOSITION over
 * a whole real answer had none. Both post-processing defects this project has shipped were
 * composition defects: the harvester filling a field Gemini correctly left empty, and the mapper
 * moving items out of columns the extraction got right. Neither was visible in a unit test, and
 * neither was distinguishable from model variance in a census run, because the census re-runs the
 * whole pipeline and Gemini's own run-to-run wobble sits on top of whatever you changed.
 *
 * Normalization is a PURE FUNCTION of the raw model plus three bundle-derived options. So saving
 * the raw answer once makes every later experiment free and exactly attributable: a diff here is
 * your change and nothing else.
 *
 *   npm run replay                     # diff today's normalization against the blessed output
 *   npm run replay -- --score          # …and score each one against its benchmark answer
 *   npm run replay -- --bless          # accept current output (say why in the commit message)
 *   npm run replay -- --collect=DIR    # rebuild the raw fixtures from an LM_DUMP_RAW directory
 *
 * `--diff` tells you WHAT your change moved; `--score` tells you whether it moved toward the right
 * answer or away from it. Together they are the whole loop: change code, run one command, keep the
 * change only if the diff is what you meant and the score did not fall.
 *
 * COLLECTING. Start the API with `LM_DUMP_RAW=<dir>` and run `npm run benchmark:accuracy`; the
 * server writes one `<seed>.raw.json` per document at the seam. `--collect` matches those dumps
 * back to benchmark documents by re-deriving each bundle's seed. Only the synthetic benchmark
 * documents may be collected this way — a raw answer carries the document's own wording, and a
 * client document's wording must never enter the repository.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeExtractedLogicModel, type NormalizeExtractOptions } from '../shared/extractNormalize.ts';
import { diffExtractions, formatExtractionDiff } from '../shared/extractionDiff.ts';
import { deriveGeminiSeed } from '../server/geminiSeed.ts';
import { goldenFromDocument, parseBenchmarkDocument } from '../shared/benchmarkDocuments.ts';
import { formatScoreRow, scoreExtraction, totalScores, type ExtractionScore } from '../shared/extractionScore.ts';
import type { LogicModel } from '../types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = path.join(root, 'fixtures', 'normalize', 'raw');
const expectedDir = path.join(root, 'fixtures', 'normalize', 'expected');
const benchmarkBundles = path.join(root, 'fixtures', 'benchmark', 'bundles');
const benchmarkDocuments = path.join(root, 'fixtures', 'benchmark', 'documents');

export interface RawFixture {
  id: string;
  promptVersion: string;
  options: NormalizeExtractOptions;
  raw: LogicModel;
}

export function loadRawFixtures(dir = rawDir): RawFixture[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as RawFixture);
}

/** Normalization mutates its input, so every replay starts from an untouched copy. */
export function replayFixture(fixture: RawFixture): LogicModel {
  return normalizeExtractedLogicModel(structuredClone(fixture.raw), fixture.options);
}

function collect(dumpDir: string): void {
  mkdirSync(rawDir, { recursive: true });
  const ids = readdirSync(benchmarkDocuments)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
  let written = 0;
  for (const id of ids) {
    const bundlePath = path.join(benchmarkBundles, `${id}.json`);
    if (!existsSync(bundlePath)) {
      console.log(`  ${id}: no bundle captured, skipped`);
      continue;
    }
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8')) as { textTrack?: string; images?: string[] };
    const seed = deriveGeminiSeed([bundle.textTrack ?? '', ...(bundle.images ?? [])]);
    const dumpPath = path.join(dumpDir, `${seed}.raw.json`);
    if (!existsSync(dumpPath)) {
      console.log(`  ${id}: no dump for seed ${seed}, skipped`);
      continue;
    }
    const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as Omit<RawFixture, 'id'>;
    writeFileSync(
      path.join(rawDir, `${id}.json`),
      JSON.stringify({ id, promptVersion: dump.promptVersion, options: dump.options, raw: dump.raw }, null, 2) + '\n'
    );
    written++;
    console.log(`  ${id}: collected (seed ${seed})`);
  }
  console.log(`\n${written} raw fixture(s) in fixtures/normalize/raw/`);
}

function main(): void {
  const args = process.argv.slice(2);
  const collectArg = args.find(a => a.startsWith('--collect='));
  if (collectArg) {
    collect(path.resolve(collectArg.slice('--collect='.length)));
    return;
  }
  const bless = args.includes('--bless');
  const score = args.includes('--score');
  const fixtures = loadRawFixtures();
  if (fixtures.length === 0) {
    console.error('No raw fixtures in fixtures/normalize/raw/. Collect them first — see the header.');
    process.exit(2);
  }
  mkdirSync(expectedDir, { recursive: true });
  let changed = 0;
  let unblessed = 0;
  const scores: ExtractionScore[] = [];
  for (const fixture of fixtures) {
    const actual = replayFixture(fixture);
    if (score) {
      const specPath = path.join(benchmarkDocuments, `${fixture.id}.json`);
      if (existsSync(specPath)) {
        const doc = parseBenchmarkDocument(JSON.parse(readFileSync(specPath, 'utf8')), specPath);
        scores.push(
          scoreExtraction(goldenFromDocument(doc), actual, { sourceText: fixture.options.sourceText })
        );
      }
    }
    const expectedPath = path.join(expectedDir, `${fixture.id}.json`);
    const first = !existsSync(expectedPath);
    if (bless) {
      writeFileSync(expectedPath, JSON.stringify(actual, null, 2) + '\n');
      console.log(`${fixture.id.padEnd(30)} ${first ? 'blessed (first baseline)' : 'blessed'}`);
      continue;
    }
    if (first) {
      // Not written on sight. A first replay is one run of unknown quality, and writing it as the
      // baseline makes whatever came out today the thing every later replay is measured against —
      // the same hole closed in scripts/regression-check.ts.
      unblessed++;
      console.log(`${fixture.id.padEnd(30)} no baseline yet — read it, then --bless`);
      continue;
    }
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as LogicModel;
    const diff = diffExtractions(expected, actual);
    if (!diff.unchanged) {
      changed++;
      console.log(`${fixture.id.padEnd(30)} CHANGED`);
      console.log(formatExtractionDiff(fixture.id, diff));
    } else {
      console.log(`${fixture.id.padEnd(30)} unchanged`);
    }
  }
  if (score && scores.length) {
    console.log('');
    for (let i = 0; i < scores.length; i++) console.log(formatScoreRow(scores[i], scores[i].id));
    const totals = totalScores(scores);
    console.log(
      `\nTOTAL over ${totals.documents} document(s): recall ${(totals.recall * 100).toFixed(1)}%  ` +
        `precision ${(totals.precision * 100).toFixed(1)}%  placement ${(totals.placement * 100).toFixed(1)}%  ` +
        `(${totals.actualCount} extracted / ${totals.expectedCount} expected)`
    );
  }
  if (!bless) {
    console.log(
      changed
        ? `\n${changed} of ${fixtures.length} document(s) changed. Zero Gemini calls, so this is your change and nothing else.`
        : `\nAll ${fixtures.length - unblessed} document(s) unchanged.`
    );
    if (unblessed) {
      console.log(`${unblessed} document(s) have no committed baseline yet — accept them with --bless.`);
    }
    if (changed || unblessed) process.exit(1);
  }
}

// Importable as a module — `shared/normalizePipeline.test.ts` reuses `loadRawFixtures` and
// `replayFixture` so the test and the CLI can never drift apart.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
