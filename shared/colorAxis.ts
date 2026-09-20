import type { LogicModel, LogicModelItem } from '../types';
import { domainFieldLabel, type CanonicalGroupedDomain } from './domainSynonyms.js';

const GROUPED: Array<CanonicalGroupedDomain | 'unmapped'> = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
  'unmapped',
];

/** Minimum coloured items in a column before we treat it as “all one colour.” */
const MONO_MIN = 3;

export type ColorAxisKind = 'none' | 'decorative' | 'column_chrome' | 'cross_cutting';

export interface ColorAxis {
  kind: ColorAxisKind;
  /** Distinct fill tokens, lowercased. */
  colors: string[];
  hasLegend: boolean;
  /** Columns that are a single colour while other columns mix — likely a stamp error. */
  stampedDomains: CanonicalGroupedDomain[];
}

export function normalizeFillColor(raw?: string): string | null {
  const token = raw?.trim().toLowerCase();
  return token ? token : null;
}

function groupsFor(model: LogicModel, domain: CanonicalGroupedDomain | 'unmapped') {
  if (domain === 'unmapped') return model.unmapped?.content ?? [];
  return model[domain]?.content ?? [];
}

function colouredItems(
  model: LogicModel,
  domain: CanonicalGroupedDomain | 'unmapped'
): { item: LogicModelItem; fill: string }[] {
  const out: { item: LogicModelItem; fill: string }[] = [];
  for (const group of groupsFor(model, domain)) {
    for (const item of group.items) {
      if (!item.text?.trim()) continue;
      const fill = normalizeFillColor(item.fillColor);
      if (fill) out.push({ item, fill });
    }
  }
  return out;
}

export function analyzeColorAxis(model: LogicModel): ColorAxis {
  const hasLegend = Boolean(model.colorLegend?.trim());
  const perDomain = GROUPED.map(domain => {
    const items = colouredItems(model, domain);
    const unique = [...new Set(items.map(i => i.fill))];
    return { domain, items, unique };
  });

  const allFills = perDomain.flatMap(d => d.items.map(i => i.fill));
  const colors = [...new Set(allFills)].sort();

  if (colors.length === 0) {
    return { kind: 'none', colors, hasLegend, stampedDomains: [] };
  }
  if (colors.length === 1) {
    return { kind: 'decorative', colors, hasLegend, stampedDomains: [] };
  }

  const mixedDomains = perDomain.filter(d => d.unique.length >= 2);
  const stampedDomains = perDomain
    .filter(
      (d): d is typeof d & { domain: CanonicalGroupedDomain } =>
        d.domain !== 'unmapped' &&
        d.unique.length === 1 &&
        d.items.length >= MONO_MIN &&
        mixedDomains.length > 0
    )
    .map(d => d.domain);

  if (mixedDomains.length > 0) {
    return { kind: 'cross_cutting', colors, hasLegend, stampedDomains };
  }

  return { kind: 'column_chrome', colors, hasLegend, stampedDomains: [] };
}

export function colorAxisNotes(axis: ColorAxis): string[] {
  const notes: string[] = [];
  if (axis.kind === 'cross_cutting' && !axis.hasLegend) {
    notes.push(
      'Several box colours, no key on the page. Filter by colour to compare groups — meaning is not assumed.'
    );
  }
  if (axis.stampedDomains.length > 0) {
    const labels = axis.stampedDomains.map(d => domainFieldLabel(d)).join(', ');
    notes.push(
      `${labels} ${axis.stampedDomains.length === 1 ? 'is' : 'are'} all one colour, but other columns mix. That is often a capture error — check those boxes against the source.`
    );
  }
  return notes;
}

export function itemMatchesColorFilter(item: LogicModelItem, filter: string | null): boolean {
  if (!filter) return true;
  return normalizeFillColor(item.fillColor) === filter;
}
