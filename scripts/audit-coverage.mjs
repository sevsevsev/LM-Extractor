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

/**
 * Normalise both sides before comparing. Each clause here is a blind spot this tool actually had,
 * and every one of them manufactured a false "missing" finding before it was fixed:
 *
 *   whitespace      session 19 — a flattener that walked only group-bearing fields
 *   line breaks     session 20 — Track A wraps phrases mid-sentence, so exact substring failed
 *   hyphen breaks   session 20 — "socio-\nemotional" vs "socio-emotional"
 *   inline markup   session 22 — Track A holds "**150+ students** engaged", the item holds the
 *                   words without the asterisks, and 11 of A New Dawn's outputs read as invented
 *
 * The pattern is always the same: the extraction is right and the PROBE is narrower than the data.
 * Add a clause here rather than special-casing a document.
 */
const norm = s =>
  s
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/(\w)-\s+(\w)/g, '$1-$2')
    .replace(/[\s ]+/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .toLowerCase();

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
