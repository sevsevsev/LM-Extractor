/**
 * Regenerate the golden snapshot of every prompt `constants.ts` can emit.
 *
 * The snapshot exists so a *refactor* of constants.ts can be proven not to change a single
 * character of Gemini's input (`constants.test.ts` asserts it), and so an *intentional* wording
 * change shows up as a reviewable diff of the real prompt text rather than being buried in a
 * template literal.
 *
 * Workflow when changing prompt wording:
 *   1. edit constants.ts
 *   2. bump PROMPT_VERSION (or DETECT_PROMPT_VERSION)
 *   3. npm run prompt:snapshot
 *   4. review the snapshot diff — that diff is the change
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxBin = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const script = `
import { writeFileSync } from 'node:fs';
import { getAiExtractionPrompt, getDetectLogicModelGroupsPrompt, PROMPT_VERSION, DETECT_PROMPT_VERSION } from './constants.ts';

const out = {};
for (const isVision of [true, false]) {
  for (const hasTextTrack of [true, false]) {
    for (const lowLegibility of [true, false]) {
      out['extract:vision=' + isVision + ':text=' + hasTextTrack + ':lowleg=' + lowLegibility] =
        getAiExtractionPrompt(isVision, { lowLegibility, hasTextTrack, shape: 'full' });
    }
  }
}
out['extract:no-options'] = getAiExtractionPrompt(true);
// Kept in step with LAYERED_PROBES in constants.test.ts.
const probes = [
  ['present', 'Inputs\\nStaff\\nActivities\\nTutoring\\nOutputs\\nSessions'],
  ['absent', 'We believe every young person deserves a mentor and we work with schools across the city. '.repeat(6)],
];
for (const [grid, textTrack] of probes) {
  out['extract-layered:grid=' + grid] = getAiExtractionPrompt(true, { hasTextTrack: true, textTrack, shape: 'layered' });
}
for (const n of [1, 2, 7]) out['detect:pages=' + n] = getDetectLogicModelGroupsPrompt(n);

writeFileSync('fixtures/prompt/extraction-prompt-variants.json', JSON.stringify(out, null, 2) + '\\n');
console.log('Wrote ' + Object.keys(out).length + ' prompt variants (PROMPT_VERSION=' + PROMPT_VERSION + ', DETECT_PROMPT_VERSION=' + DETECT_PROMPT_VERSION + ')');
console.log('Review the snapshot diff — it is the record of what changed.');
`;

const result = spawnSync(process.execPath, [tsxBin, '--eval', script], {
  cwd: root,
  stdio: 'inherit',
  encoding: 'utf8',
});

process.exit(result.status ?? 1);
