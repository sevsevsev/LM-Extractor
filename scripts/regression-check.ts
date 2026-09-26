/**
 * Tier-1 regression check: replay a fixed, stratified set of documents through the extract API and
 * diff each result against its committed snapshot.
 *
 * Why bundles and not source files: conversion (pdfjs + canvas + html2canvas) is browser-only, so
 * a Node runner cannot go from PDF to DocumentBundle. Replaying a saved bundle is both the
 * feasible path and the better experiment — it holds the conversion step constant, so a diff
 * isolates the prompt instead of also picking up a slightly different JPEG render.
 *
 *   npm run dev                 # the API must be running (default http://localhost:3011)
 *   npm run regression:check    # diff against committed snapshots; non-zero exit on any change
 *   npm run regression:check -- --update   # accept current output as the new baseline
 *   npm run regression:check -- --only=oxford-circle
 *   npm run regression:check -- --require-bundles   # fail if any document has no bundle here
 *
 * Capturing a bundle (once per document, in the browser): see fixtures/regression-set/README.md.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffExtractions, formatExtractionDiff } from '../shared/extractionDiff.ts';
import { regressionOutcome } from '../shared/regressionOutcome.ts';
import type { LogicModel } from '../types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setDir = path.join(root, 'fixtures', 'regression-set');
const bundlesDir = path.join(setDir, 'bundles');
const snapshotsDir = path.join(setDir, 'snapshots');
const manifestPath = path.join(setDir, 'manifest.json');

interface ManifestEntry {
  id: string;
  label: string;
  /** Which prompt variant and failure class this document is in the set to cover. */
  covers: string;
  bundle: string;
}

interface Snapshot {
  id: string;
  promptVersion: string;
  promptVariant: string;
  capturedAt: string;
  model: LogicModel;
}

const args = process.argv.slice(2);
const update = args.includes('--update');
/**
 * Fail the run when any manifest document has no bundle on this machine. Off by default: bundles
 * are gitignored, so a fresh clone has none and the guard would report failure while nothing is
 * wrong. On for a machine that is supposed to hold the whole set.
 */
const requireBundles = args.includes('--require-bundles');
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const apiBase = process.env.LM_API_BASE || 'http://localhost:3011';

function loadManifest(): ManifestEntry[] {
  if (!existsSync(manifestPath)) {
    console.error(`No manifest at ${path.relative(root, manifestPath)}`);
    process.exit(2);
  }
  const entries = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestEntry[];
  return only ? entries.filter(e => e.id === only || e.id.includes(only)) : entries;
}

async function extract(bundle: unknown): Promise<{ model: LogicModel; promptVersion: string; promptVariant: string }> {
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
  if (!response.ok || !payload.model) {
    throw new Error(payload.error || `extract failed (${response.status})`);
  }
  return {
    model: payload.model,
    promptVersion: payload.promptVersion ?? 'unknown',
    promptVariant: payload.promptVariant ?? 'unknown',
  };
}

async function main(): Promise<void> {
  const entries = loadManifest();
  if (entries.length === 0) {
    console.error(only ? `No manifest entry matching "${only}".` : 'Manifest is empty.');
    process.exit(2);
  }
  mkdirSync(snapshotsDir, { recursive: true });

  let changed = 0;
  let unchanged = 0;
  let updated = 0;
  const missingBundles: ManifestEntry[] = [];
  const failures: { entry: ManifestEntry; error: string }[] = [];
  const variantsSeen = new Set<string>();

  console.log(`Regression set: ${entries.length} document(s) via ${apiBase}\n`);

  for (const entry of entries) {
    const bundlePath = path.join(bundlesDir, entry.bundle);
    if (!existsSync(bundlePath)) {
      // Loud, not silent: a fixture set that quietly skips everything is the failure mode this
      // whole harness exists to avoid (see the gold-fixture tests in shared/extractPlacement.test.ts).
      missingBundles.push(entry);
      console.log(`  ! ${entry.label} — bundle not captured (${entry.bundle})`);
      continue;
    }

    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));
    let result: Awaited<ReturnType<typeof extract>>;
    try {
      result = await extract(bundle);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ entry, error: message });
      console.log(`  ✗ ${entry.label} — ${message}`);
      continue;
    }
    variantsSeen.add(result.promptVariant);

    const snapshotPath = path.join(snapshotsDir, `${entry.id}.json`);
    const snapshot: Snapshot = {
      id: entry.id,
      promptVersion: result.promptVersion,
      promptVariant: result.promptVariant,
      capturedAt: new Date().toISOString(),
      model: result.model,
    };

    if (!existsSync(snapshotPath)) {
      writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      updated++;
      console.log(`  + ${entry.label} — new baseline (${result.promptVersion}, ${result.promptVariant})`);
      continue;
    }

    const previous = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;
    const diff = diffExtractions(previous.model, result.model);
    const versionNote =
      previous.promptVersion === result.promptVersion
        ? result.promptVersion
        : `${previous.promptVersion} -> ${result.promptVersion}`;
    console.log(formatExtractionDiff(`${entry.label} [${versionNote}, ${result.promptVariant}]`, diff));

    if (diff.unchanged) {
      unchanged++;
    } else {
      changed++;
      if (update) {
        writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
        updated++;
      }
    }
  }

  console.log('\n---');
  console.log(`unchanged ${unchanged}  changed ${changed}  baselines written ${updated}`);
  if (variantsSeen.size > 0) console.log(`variants exercised: ${[...variantsSeen].sort().join(', ')}`);

  if (missingBundles.length > 0) {
    console.log(`\n${missingBundles.length} document(s) have no captured bundle and were NOT tested:`);
    for (const e of missingBundles) console.log(`  - ${e.id} (${e.covers})`);
    console.log('  See fixtures/regression-set/README.md to capture them.');
  }

  const outcome = regressionOutcome({
    total: entries.length,
    unchanged,
    changed,
    missingBundles: missingBundles.length,
    failures: failures.length,
    update,
    requireBundles,
  });
  console.log(`\n${outcome.summary}`);
  process.exit(outcome.exitCode);
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});
