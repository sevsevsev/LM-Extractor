/**
 * Mechanical first pass for an invention audit: is every extracted item's text findable in the
 * bundle's Track A?
 *
 * WHY THIS EXISTS: three times now I have reported something ABSENT that was present, each time
 * because my probe was weaker than the data (session 5: a single-line grep vs multi-line output;
 * session 19: walking only group-bearing fields; session 20: an exact-substring search vs a text
 * track with hard line breaks mid-phrase). Absence is the claim a weak instrument manufactures,
 * so the probe normalises whitespace on BOTH sides before comparing.
 *
 * A miss here is NOT an invention — Track A can legitimately lack text that only the page image
 * carries (a scanned table, a text box the extractor skipped). A miss means LOOK AT THE IMAGE.
 * A hit means the string came from somewhere real and needs no visual check for invention.
 */
import { readFileSync } from 'node:fs';

// usage: node scripts/audit-coverage.mjs <bundle-id> <path-to-extraction-json>

const norm = s => s.replace(/[\s ]+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').trim().toLowerCase();

const id = process.argv[2];
const bundle = JSON.parse(readFileSync(`/home/user/LM-Extractor/fixtures/regression-set/bundles/${id}.json`, 'utf8'));
const raw = JSON.parse(readFileSync(`${process.argv[3]}`, 'utf8'));
const model = raw.model ?? raw;
const track = norm(bundle.textTrack ?? bundle.text ?? '');

const miss = [];
let total = 0;
for (const [domain, field] of Object.entries(model)) {
  if (!field || !Array.isArray(field?.content)) continue;
  for (const g of field.content) for (const it of g.items ?? []) {
    if (!it.text?.trim()) continue;
    total += 1;
    if (!track.includes(norm(it.text))) miss.push(`${domain} / ${g.name}: ${it.text}`);
  }
}
// Scalars too — session 19's near-miss was a scalar field.
for (const k of ['mission', 'targetPopulation', 'impactStatement']) {
  const v = model[k]?.content ?? model[k];
  if (typeof v === 'string' && v.trim()) {
    total += 1;
    if (!track.includes(norm(v))) miss.push(`${k} (scalar): ${v.slice(0, 90)}`);
  }
}
console.log(`${id}: ${total - miss.length}/${total} findable in Track A`);
for (const m of miss) console.log(`   NEEDS EYES: ${m}`);
