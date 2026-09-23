/**
 * Conservative source-header → canonical domain synonyms.
 * Keep this list short and high-precision; grow from correction exports, not guesswork.
 * See docs/specs/source-aware-mapping-v1.md.
 */

export type CanonicalGroupedDomain =
  | 'inputs'
  | 'activities'
  | 'outputs'
  | 'shortTermOutcomes'
  | 'mediumTermOutcomes'
  | 'longTermOutcomes'
  | 'generalOutcomes'
  | 'impact';

/** Normalized header fragment → domain. Longer keys checked first after sort. */
const SYNONYM_ENTRIES: { key: string; domain: CanonicalGroupedDomain }[] = [
  // Outcomes horizons (check before bare "outcomes")
  { key: 'short-term outcomes', domain: 'shortTermOutcomes' },
  { key: 'short term outcomes', domain: 'shortTermOutcomes' },
  { key: 'short-term', domain: 'shortTermOutcomes' },
  { key: 'short term', domain: 'shortTermOutcomes' },
  { key: 'near-term outcomes', domain: 'shortTermOutcomes' },
  { key: 'near term outcomes', domain: 'shortTermOutcomes' },
  { key: 'immediate outcomes', domain: 'shortTermOutcomes' },
  { key: 'medium-term outcomes', domain: 'mediumTermOutcomes' },
  { key: 'medium term outcomes', domain: 'mediumTermOutcomes' },
  { key: 'medium-term', domain: 'mediumTermOutcomes' },
  { key: 'medium term', domain: 'mediumTermOutcomes' },
  { key: 'intermediate outcomes', domain: 'mediumTermOutcomes' },
  { key: 'long-term outcomes', domain: 'longTermOutcomes' },
  { key: 'long term outcomes', domain: 'longTermOutcomes' },
  { key: 'long-term', domain: 'longTermOutcomes' },
  { key: 'long term', domain: 'longTermOutcomes' },
  { key: 'ultimate outcomes', domain: 'longTermOutcomes' },
  // Bare "Outcomes" (no time-horizon qualifier) — a single combined outcomes column/section,
  // not separately labeled short/medium/long-term. Checked after the more specific keys above.
  { key: 'outcomes', domain: 'generalOutcomes' },
  { key: 'program outcomes', domain: 'generalOutcomes' },
  // Impact column (not Impact Statement)
  { key: 'ultimate impact', domain: 'impact' },
  { key: 'impact', domain: 'impact' },
  // Core columns
  { key: 'resources', domain: 'inputs' },
  { key: 'inputs', domain: 'inputs' },
  { key: 'enablers', domain: 'inputs' },
  { key: 'activities', domain: 'activities' },
  { key: 'interventions', domain: 'activities' },
  { key: 'outputs', domain: 'outputs' },
  { key: 'deliverables', domain: 'outputs' },
  { key: 'products', domain: 'outputs' },
  { key: 'reach', domain: 'outputs' },
];

/** Common Resources-column sub-headings — stay under inputs when already there. */
const INPUT_SUBBUCKETS = new Set(
  [
    'frontline staff',
    'partners',
    'material & financial resources',
    'material and financial resources',
    'knowledge resources',
    'financial resources',
    'material resources',
  ].map(s => s.toLowerCase())
);

export function normalizeHeader(label: string): string {
  return label
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Return a canonical domain when `label` is a high-confidence synonym; otherwise null.
 * Does not map Situation / Assumptions / Goals / track names / etc.
 */
export function synonymToDomain(label: string): CanonicalGroupedDomain | null {
  const n = normalizeHeader(label);
  if (!n || n === 'general') return null;

  // Prefer longer keys so "short-term outcomes" wins over bare matches.
  const sorted = [...SYNONYM_ENTRIES].sort((a, b) => b.key.length - a.key.length);
  for (const { key, domain } of sorted) {
    if (n === key || n.startsWith(key + ' ') || n.endsWith(' ' + key)) return domain;
    // Exact column-header style: label is only the key (allow trailing punctuation)
    if (n.replace(/[:.\-–—]+$/g, '').trim() === key) return domain;
  }
  return null;
}

/**
 * Like `synonymToDomain`, but only when the header IS that column's name rather than merely
 * ending or starting with it. Use this — never the loose form — to decide whether to MOVE items
 * out of the column the extraction put them in.
 *
 * WHY THE DISTINCTION EXISTS. The loose form matches a domain word anywhere at a word boundary,
 * which is right for reading a header's meaning and wrong for overruling a column. A sub-heading
 * inside a correctly-placed column is almost always "<qualifier> <domain word>", and the loose
 * form reads every one of them as a claim about which column the items belong in:
 *
 *   "Youth Outcomes" / "School/Community Outcomes"   -> ends with "outcomes" -> generalOutcomes
 *   "Teacher/School Resources"                       -> ends with "resources" -> inputs
 *   "Sustained Community Impact"                     -> ends with "impact"   -> impact
 *
 * MEASURED, 2026-09-23, over the 14 recaptured documents: the loose form fired a move four times
 * and was wrong all four (the first two rows above), emptying A New Dawn's Short-Term Outcomes
 * column into General Outcomes and filing four of Cub Reporter's Activities and Outputs items
 * under Inputs. The third row never reached a move only because `inlineLabelGroups.ts` refuses to
 * promote a band of labels containing one, which cost that document its Long-Term Outcomes
 * grouping instead. Nothing in the set was ever moved correctly.
 *
 * The two failure modes are not symmetric. Not moving leaves items where the model's own reading
 * of the page put them, with their sub-heading intact and visible to the reviewer. Moving deletes
 * the sub-heading, files the items under "General" in another column, and looks deliberate. So a
 * move needs the unqualified name, and a qualified one is treated as what it reads like: a
 * sub-heading.
 *
 * NOT handled, for want of a document that shows it: a leading ordinal ("4. Short-Term Outcomes"),
 * which prose-section sources use for section headings and which would not match here.
 */
export function columnNameToDomain(label: string): CanonicalGroupedDomain | null {
  const n = normalizeHeader(label).replace(/[:.\-–—]+$/g, '').trim();
  if (!n || n === 'general') return null;
  for (const { key, domain } of SYNONYM_ENTRIES) {
    if (n === key) return domain;
  }
  return null;
}

export function isKnownInputSubBucket(label: string): boolean {
  return INPUT_SUBBUCKETS.has(normalizeHeader(label));
}

export const CANONICAL_DOMAIN_OPTIONS: { value: CanonicalGroupedDomain | ''; label: string }[] = [
  { value: '', label: 'Leave unmapped' },
  { value: 'inputs', label: 'Inputs' },
  { value: 'activities', label: 'Activities' },
  { value: 'outputs', label: 'Outputs' },
  { value: 'shortTermOutcomes', label: 'Short-Term Outcomes' },
  { value: 'mediumTermOutcomes', label: 'Medium-Term Outcomes' },
  { value: 'longTermOutcomes', label: 'Long-Term Outcomes' },
  { value: 'generalOutcomes', label: 'General Outcomes (time horizon not specified)' },
  { value: 'impact', label: 'Impact' },
];

export function domainFieldLabel(domain: CanonicalGroupedDomain | 'unmapped'): string {
  if (domain === 'unmapped') return 'Unmapped';
  return CANONICAL_DOMAIN_OPTIONS.find(o => o.value === domain)?.label ?? domain;
}
