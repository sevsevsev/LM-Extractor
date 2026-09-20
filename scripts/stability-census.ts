/**
 * Stability census: run every regression-set document through the extract API TWICE on the
 * CURRENT prompt, and report whether each one reproduces.
 *
 * Why this is separate from `regression:check`: that tool answers "did output change since the
 * baseline?", which is only meaningful for a document that reproduces in the first place.
 * Friction-log session 6 found one that does not — Performance Garage flips between two different
 * groupings under an unchanged prompt — so a single diff on it can show a "regression" that is
 * nothing of the kind. This calibrates the instrument: it says which documents a diff can be
 * trusted on.
 *
 * Run it after any prompt change, before reading `regression:check` output:
 *
 *   npm run dev                      # API must be running, GEMINI_API_KEY set
 *   npx tsx scripts/stability-census.ts
 *   npx tsx scripts/stability-census.ts --only=cub --passes=3
 *
 * Costs 2 Gemini extract calls per document (3 with --passes=3). Documents with no captured
 * bundle are reported loudly, never silently skipped — same posture as `regression:check`. Use
 * `scripts/capture-bundles.mjs` to rebuild missing bundles from the source documents.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffExtractions } from '../shared/extractionDiff.ts';
import { findNestingViolations } from '../shared/nestingConsistency.ts';
import type { LogicModel } from '../types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setDir = path.join(root, 'fixtures', 'regression-set');
const bundlesDir = path.join(setDir, 'bundles');
const apiBase = process.env.LM_API_BASE || 'http://localhost:3011';

const args = process.argv.slice(2);
const onlyArg = args.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;
const passesArg = args.find(a => a.startsWith('--passes='));
const passes = Math.max(2, Number(passesArg?.slice('--passes='.length) ?? 2));

interface ManifestEntry { id: string; label: string; covers: string; bundle: string }

function countItems(model: LogicModel): number {
  let n = 0;
  for (const field of Object.values(model) as { content?: { items?: { text?: string }[] }[] }[]) {
    if (!field || !Array.isArray(field?.content)) continue;
    for (const g of field.content) for (const it of g.items ?? []) if (it.text?.trim()) n += 1;
  }
  return n;
}

/** Group-name fingerprint: catches a grouping flip even when the item count is unchanged. */
function groupSignature(model: LogicModel): string {
  return Object.entries(model)
    .filter(([, f]) => f && Array.isArray((f as { content?: unknown }).content))
    .map(([d, f]) => `${d}:${(f as { content: { name: string }[] }).content.map(g => g.name).join(',')}`)
    .join('|');
}

async function extract(bundle: unknown): Promise<LogicModel> {
  const res = await fetch(`${apiBase}/api/gemini/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  const payload = (await res.json().catch(() => ({}))) as { model?: LogicModel; error?: string };
  if (!res.ok || !payload.model) throw new Error(payload.error || `extract failed (${res.status})`);
  return payload.model;
}

async function main(): Promise<void> {
  const all = JSON.parse(readFileSync(path.join(setDir, 'manifest.json'), 'utf8')) as ManifestEntry[];
  const entries = only ? all.filter(e => e.id === only || e.id.includes(only)) : all;
  if (entries.length === 0) {
    console.error(only ? `No manifest entry matching "${only}".` : 'Manifest is empty.');
    process.exit(2);
  }

  console.log(`Stability census: ${entries.length} document(s) x ${passes} passes via ${apiBase}`);
  console.log(`(${entries.length * passes} Gemini extract calls)\n`);

  const missing: ManifestEntry[] = [];
  const unstable: string[] = [];
  let stable = 0;

  for (const entry of entries) {
    const bundlePath = path.join(bundlesDir, entry.bundle);
    if (!existsSync(bundlePath)) {
      missing.push(entry);
      console.log(`  ! ${entry.label} — bundle not captured (${entry.bundle})`);
      continue;
    }
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

    const runs: LogicModel[] = [];
    try {
      for (let i = 0; i < passes; i++) runs.push(await extract(bundle));
    } catch (error) {
      console.log(`  x ${entry.label} — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const counts = runs.map(countItems);
    const sigs = runs.map(groupSignature);
    const sameCount = counts.every(c => c === counts[0]);
    const sameGroups = sigs.every(s => s === sigs[0]);
    const identical = runs.every(r => diffExtractions(runs[0], r).unchanged);
    const violations = runs.reduce((n, r) => n + findNestingViolations(r).length, 0);

    const verdict = identical
      ? 'STABLE — byte-identical'
      : !sameGroups
        ? 'UNSTABLE — grouping differs between runs'
        : !sameCount
          ? 'UNSTABLE — item count differs'
          : 'stable items — scalar field drift only';
    if (identical || (sameCount && sameGroups)) stable += 1;
    else unstable.push(entry.id);

    console.log(`  ${identical || (sameCount && sameGroups) ? '=' : '~'} ${entry.label}`);
    console.log(`      items ${counts.join(' / ')}   ${verdict}${violations ? `   rule-9 violations: ${violations}` : ''}`);
  }

  console.log('\n---');
  console.log(`stable ${stable}   unstable ${unstable.length}`);
  if (unstable.length) {
    console.log('\nA regression diff on these documents is NOT trustworthy — they change without any');
    console.log('prompt change. Reproduce a suspected regression against a same-prompt control first:');
    for (const id of unstable) console.log(`  - ${id}`);
  }
  if (missing.length) {
    console.log(`\n${missing.length} document(s) have no captured bundle and were NOT tested:`);
    for (const e of missing) console.log(`  - ${e.id}`);
    console.log('  Rebuild them with `node scripts/capture-bundles.mjs <id>=<source path>`.');
  }
  process.exit(missing.length > 0 || unstable.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(2);
});
