/**
 * Accuracy benchmark: extract each synthetic benchmark document and score it against the answer
 * the document was generated from.
 *
 * WHAT THIS ADDS THAT THE REGRESSION SET DOES NOT. `regression:check` compares today's output with
 * a blessed snapshot, and `census` compares two runs with each other. Both answer "did anything
 * change"; neither can answer "is it right", because a snapshot is only whatever the pipeline
 * emitted the day someone accepted it. Here the expected answer comes from the document's own
 * source spec, so a number moving means accuracy moved.
 *
 * WHAT IT CANNOT TELL YOU. The documents are invented, so they are as hard as they were written to
 * be and no harder. A perfect score is evidence that a change did not break the failure modes in
 * the set — the ones this project has actually shipped bugs against — and is not evidence about a
 * partner's real document. The measurement of real documents is the audit record in
 * docs/verification/, read by a person against page images.
 *
 *   npm run dev                              # API and app must be running, GEMINI_API_KEY set
 *   npm run benchmark:accuracy -- --capture  # regenerate decks and capture bundles (Playwright)
 *   npm run benchmark:accuracy               # extract and score the captured bundles
 *   npm run benchmark:accuracy -- --passes=3 # also report whether the SCORE moves between runs
 *   npm run benchmark:accuracy -- --only=inline
 *   npm run benchmark:accuracy -- --replay   # re-score the last run's saved extractions, 0 calls
 *
 * `--replay` is the cheap half of the loop: the saved extraction is the model's answer, and
 * scoring it again costs nothing. Use it whenever the change under test is in the scorer or in
 * `shared/` post-processing rather than in the prompt.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  documentTextTrack,
  goldenFromDocument,
  parseBenchmarkDocument,
  type BenchmarkDocument,
} from '../shared/benchmarkDocuments.ts';
import {
  formatScoreRow,
  scoreExtraction,
  totalScores,
  type ExtractionScore,
} from '../shared/extractionScore.ts';
import type { LogicModel } from '../types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setDir = path.join(root, 'fixtures', 'benchmark');
const documentsDir = path.join(setDir, 'documents');
const decksDir = path.join(setDir, 'decks');
const bundlesDir = path.join(setDir, 'bundles');
const extractionsDir = path.join(setDir, 'extractions');
const runsDir = path.join(setDir, 'runs');

const args = process.argv.slice(2);
const capture = args.includes('--capture');
const replay = args.includes('--replay');
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const passesArg = args.find(a => a.startsWith('--passes='));
const passes = passesArg ? Math.max(1, Number(passesArg.slice('--passes='.length))) : 1;
const apiBase = process.env.LM_API_BASE || 'http://localhost:3011';

function loadDocuments(): BenchmarkDocument[] {
  const docs = readdirSync(documentsDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => parseBenchmarkDocument(JSON.parse(readFileSync(path.join(documentsDir, f), 'utf8')), f));
  return only ? docs.filter(d => d.id.includes(only)) : docs;
}

interface Bundle {
  textTrack?: string;
  images?: string[];
  [key: string]: unknown;
}

async function extract(bundle: Bundle): Promise<{ model: LogicModel; promptVersion: string; promptVariant: string }> {
  const response = await fetch(`${apiBase}/api/gemini/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    model?: LogicModel;
    promptVersion?: string;
    promptVariant?: string;
    error?: string;
  };
  if (!response.ok || !payload.model) throw new Error(payload.error || `extract failed (${response.status})`);
  return {
    model: payload.model,
    promptVersion: payload.promptVersion ?? 'unknown',
    promptVariant: payload.promptVariant ?? 'unknown',
  };
}

function captureBundles(docs: BenchmarkDocument[]): void {
  console.log('Generating decks…');
  execFileSync('node', [path.join(root, 'scripts', 'make-benchmark-decks.mjs')], { stdio: 'inherit' });
  console.log('\nCapturing bundles through the real app (one extract call each, unused here)…');
  execFileSync(
    'node',
    [
      path.join(root, 'scripts', 'capture-bundles.mjs'),
      ...docs.map(d => `${d.id}=${path.join(decksDir, `${d.id}.pptx`)}`),
    ],
    { stdio: 'inherit', env: { ...process.env, LM_BUNDLE_SET: 'benchmark' } }
  );
}

/**
 * A benchmark that silently grades a text-only extraction as if it were the vision path would
 * report a number about a path almost no user takes. So the variant is printed on every row, and
 * a bundle that arrived with no page images is called out rather than quietly scored.
 */
function describeBundle(bundle: Bundle): string {
  const images = Array.isArray(bundle.images) ? bundle.images.length : 0;
  const chars = typeof bundle.textTrack === 'string' ? bundle.textTrack.length : 0;
  return `${images} image(s), ${chars} chars`;
}

async function main(): Promise<void> {
  const docs = loadDocuments();
  if (docs.length === 0) {
    console.error('No benchmark documents matched.');
    process.exit(2);
  }
  if (capture) captureBundles(docs);

  const sourceDir = replay ? extractionsDir : bundlesDir;
  const missing = docs.filter(d => !existsSync(path.join(sourceDir, `${d.id}.json`)));
  if (missing.length) {
    console.error(
      `No ${replay ? 'saved extraction' : 'bundle'} for: ${missing.map(d => d.id).join(', ')}\n` +
        'Both are build output and gitignored. Run with --capture (dev server must be up).'
    );
    process.exit(2);
  }
  if (replay && passes > 1) {
    console.error('--replay re-scores one saved answer, so --passes says nothing. Drop one of them.');
    process.exit(2);
  }

  const perPass: ExtractionScore[][] = [];
  let promptVersion = 'unknown';

  for (let pass = 1; pass <= passes; pass++) {
    if (passes > 1) console.log(`\n=== pass ${pass} of ${passes} ===`);
    const scores: ExtractionScore[] = [];
    for (const doc of docs) {
      const bundle = JSON.parse(readFileSync(path.join(bundlesDir, `${doc.id}.json`), 'utf8')) as Bundle;
      let result: { model: LogicModel; promptVersion: string; promptVariant: string };
      if (replay) {
        result = JSON.parse(readFileSync(path.join(extractionsDir, `${doc.id}.json`), 'utf8'));
      } else {
        try {
          result = await extract(bundle);
        } catch (error) {
          console.log(`${doc.label.slice(0, 34).padEnd(34)}  EXTRACT FAILED: ${(error as Error).message}`);
          continue;
        }
      }
      promptVersion = result.promptVersion;
      const score = scoreExtraction(goldenFromDocument(doc), result.model, {
        // The bundle's own text track is what the model was shown; fall back to the spec's text
        // when a bundle carries none, so `unsourced` is never silently null.
        sourceText: bundle.textTrack || documentTextTrack(doc),
      });
      scores.push(score);
      console.log(
        `${formatScoreRow(score, doc.label)}  [${result.promptVariant}, ${describeBundle(bundle)}` +
          `${score.unmappedCount ? `, ${score.unmappedCount} unmapped` : ''}]`
      );
      if (score.documentTypeMismatch) {
        console.log(
          `    document type: expected ${score.documentTypeMismatch.expected}, got ${score.documentTypeMismatch.actual}`
        );
      }
      for (const miss of score.misses.slice(0, 6)) {
        console.log(`    MISS  [${miss.domain}] ${miss.expected.slice(0, 90)}`);
      }
      if (score.misses.length > 6) console.log(`    …and ${score.misses.length - 6} more misses`);
      for (const m of score.misplacements.slice(0, 6)) {
        console.log(`    MOVED ${m.expectedDomain} → ${m.actualDomain}: ${m.expected.slice(0, 74)}`);
      }
      for (const s of score.surplus.slice(0, 6)) {
        console.log(`    EXTRA [${s.domain}]${s.inSource ? '' : ' NOT IN SOURCE'} ${s.text.slice(0, 80)}`);
      }
    }
    perPass.push(scores);
  }

  console.log('');
  for (let pass = 0; pass < perPass.length; pass++) {
    const totals = totalScores(perPass[pass]);
    console.log(
      `${passes > 1 ? `pass ${pass + 1}  ` : ''}TOTAL over ${totals.documents} document(s): ` +
        `recall ${(totals.recall * 100).toFixed(1)}%  precision ${(totals.precision * 100).toFixed(1)}%  ` +
        `placement ${(totals.placement * 100).toFixed(1)}%  ` +
        `unsourced ${totals.unsourced === null ? '—' : `${(totals.unsourced * 100).toFixed(1)}%`}  ` +
        `(${totals.actualCount} extracted / ${totals.expectedCount} expected)`
    );
  }

  if (passes > 1) {
    // Reproducibility of the SCORE, which is the axis the launch gate is defined on. Two passes
    // that agree do not prove stability — they only fail to disprove it — so the wording matches
    // what the census says at the same run count.
    const moved = perPass[0]
      .map((first, i) => ({
        id: first.id,
        moved: perPass.some(
          p =>
            p[i] &&
            (p[i].recall !== first.recall ||
              p[i].placement !== first.placement ||
              p[i].actualCount !== first.actualCount),
        ),
      }))
      .filter(r => r.moved);
    console.log(
      moved.length
        ? `\nSCORE MOVED between passes on: ${moved.map(m => m.id).join(', ')}`
        : `\nNo score moved across ${passes} passes — not proof of stability, but nothing disproved it.`
    );
  }

  mkdirSync(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const recordPath = path.join(runsDir, `${stamp}.json`);
  writeFileSync(
    recordPath,
    JSON.stringify({ at: new Date().toISOString(), promptVersion, passes, scores: perPass }, null, 2)
  );
  console.log(`\nRun record: ${path.relative(root, recordPath)}`);
}

await main();
