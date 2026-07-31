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
  { value: 'impact', label: 'Impact' },
];

export function domainFieldLabel(domain: CanonicalGroupedDomain | 'unmapped'): string {
  if (domain === 'unmapped') return 'Unmapped';
  return CANONICAL_DOMAIN_OPTIONS.find(o => o.value === domain)?.label ?? domain;
}
