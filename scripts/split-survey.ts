/**
 * Show every cell of the blessed regression snapshots that `shared/listItemSplit.ts` would split,
 * and what it would split it into.
 *
 *   npm run split:survey
 *
 * WHY IT IS A SCRIPT AND NOT A WRITE-UP. The list is the evidence for the rule, and it has to be
 * re-checkable whenever the rule or a baseline moves. It cannot be pasted into
 * `docs/verification/` because the snapshots hold real client wording, and no client wording goes
 * into a document, a comment or a fixture in this repository — so the finding is written up there
 * and the evidence is regenerated here, from files a clone already has.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitRunOnCell } from '../shared/listItemSplit.ts';
import type { LogicModel } from '../types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotsDir = path.join(root, 'fixtures', 'regression-set', 'snapshots');

const DOMAINS = [
  'inputs', 'activities', 'outputs', 'shortTermOutcomes',
  'mediumTermOutcomes', 'longTermOutcomes', 'generalOutcomes', 'impact',
] as const;

let items = 0;
let split = 0;
let produced = 0;
const documents = new Set<string>();

for (const file of readdirSync(snapshotsDir).filter(f => f.endsWith('.json')).sort()) {
  const snapshot = JSON.parse(readFileSync(path.join(snapshotsDir, file), 'utf8')) as {
    model: LogicModel;
  };
  for (const domain of DOMAINS) {
    const content = snapshot.model[domain]?.content;
    if (!Array.isArray(content)) continue;
    for (const group of content) {
      for (const item of group.items ?? []) {
        items++;
        const parts = splitRunOnCell(item.text);
        if (!parts) continue;
        split++;
        produced += parts.length;
        documents.add(file);
        console.log(`\n[${file.replace('.json', '')} / ${domain} / "${group.name}"]  1 -> ${parts.length}`);
        console.log(`  was: ${item.text}`);
        parts.forEach((part, i) => console.log(`  ${i + 1}. ${part}`));
      }
    }
  }
}

const total = readdirSync(snapshotsDir).filter(f => f.endsWith('.json')).length;
console.log(
  `\n${items} items, ${split} cell(s) split into ${produced} (net +${produced - split}), ` +
    `${documents.size}/${total} documents touched`
);
