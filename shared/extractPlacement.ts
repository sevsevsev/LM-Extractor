import type { LogicModel, LogicModelGroup } from '../types';

export type LogicModelDomain =
  | 'impactStatement'
  | 'mission'
  | 'targetPopulation'
  | 'inputs'
  | 'activities'
  | 'outputs'
  | 'shortTermOutcomes'
  | 'mediumTermOutcomes'
  | 'longTermOutcomes'
  | 'generalOutcomes'
  | 'impact';

const GROUPED_DOMAINS: LogicModelDomain[] = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
];

export interface PlacementExpectation {
  domain: LogicModelDomain;
  group?: string;
  contentContains: string;
  mustNotBeIn?: LogicModelDomain[];
}

export interface ExtractFixture {
  meta?: Record<string, unknown>;
  mustHaveGroups?: Partial<Record<LogicModelDomain, string[]>>;
  placements?: PlacementExpectation[];
  /** Substrings that must not appear in ANY domain — catches fabricated content. */
  mustNotContainAnywhere?: string[];
  /** Domains whose only grouping should be "General" (no false tracks copied in). */
  groupsMustBeGeneralOnly?: LogicModelDomain[];
  impactStatement?: {
    required?: boolean;
    contentContains?: string[];
    mustNotBeIn?: LogicModelDomain[];
    mustNotDuplicate?: string;
  };
  mission?: {
    required?: boolean;
    mustNotDuplicate?: string;
  };
  regression?: {
    domainsMustRemainNonEmpty?: LogicModelDomain[];
  };
}

const ALL_DOMAINS: LogicModelDomain[] = [
  'impactStatement',
  'mission',
  'targetPopulation',
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function groupMatches(actual: string, expected: string): boolean {
  const a = norm(actual);
  const e = norm(expected);
  return a === e || a.includes(e) || e.includes(a);
}

function stringFieldContent(model: LogicModel, domain: 'impactStatement' | 'mission' | 'targetPopulation'): string {
  if (domain === 'impactStatement') return model.impactStatement?.content ?? '';
  if (domain === 'mission') return model.mission?.content ?? '';
  return model.targetPopulation?.content ?? '';
}

function groupedContent(model: LogicModel, domain: LogicModelDomain): LogicModelGroup[] {
  const field = model[domain as keyof LogicModel];
  if (!field || typeof field !== 'object' || !('content' in field)) return [];
  const content = (field as { content: unknown }).content;
  return Array.isArray(content) ? (content as LogicModelGroup[]) : [];
}

/** All { group, text } pairs in a domain (string domains return one General row). */
export function findItems(
  model: LogicModel,
  domain: LogicModelDomain
): { group: string; text: string }[] {
  if (domain === 'impactStatement' || domain === 'mission' || domain === 'targetPopulation') {
    const text = stringFieldContent(model, domain);
    return text.trim() ? [{ group: 'General', text }] : [];
  }
  const items: { group: string; text: string }[] = [];
  for (const g of groupedContent(model, domain)) {
    for (const item of g.items || []) {
      if (item.text?.trim()) items.push({ group: g.name || 'General', text: item.text });
    }
  }
  return items;
}

export function domainContainsSubstring(model: LogicModel, domain: LogicModelDomain, needle: string): boolean {
  const n = norm(needle);
  return findItems(model, domain).some(row => norm(row.text).includes(n));
}

export function assertPlacement(model: LogicModel, exp: PlacementExpectation): void {
  const needle = exp.contentContains;
  const inDomain = findItems(model, exp.domain).filter(
    row => (!exp.group || groupMatches(row.group, exp.group)) && norm(row.text).includes(norm(needle))
  );
  if (inDomain.length === 0) {
    throw new Error(
      `Expected "${needle}" in ${exp.domain}${exp.group ? ` / ${exp.group}` : ''} — not found`
    );
  }
  for (const forbidden of exp.mustNotBeIn ?? []) {
    if (domainContainsSubstring(model, forbidden, needle)) {
      throw new Error(`"${needle}" must not appear in ${forbidden} but was found there`);
    }
  }
}

function assertMustHaveGroups(model: LogicModel, fixture: ExtractFixture): void {
  for (const [domain, expectedGroups] of Object.entries(fixture.mustHaveGroups ?? {})) {
    const d = domain as LogicModelDomain;
    const actualNames = groupedContent(model, d).map(g => g.name);
    for (const expected of expectedGroups ?? []) {
      if (!actualNames.some(name => groupMatches(name, expected))) {
        throw new Error(
          `Expected group "${expected}" in ${d}; got [${actualNames.join(', ')}]`
        );
      }
    }
  }
}

function assertImpactStatement(model: LogicModel, spec: NonNullable<ExtractFixture['impactStatement']>): void {
  const content = model.impactStatement?.content?.trim() ?? '';
  if (spec.required && !content) {
    throw new Error('impactStatement required but missing or empty');
  }
  for (const sub of spec.contentContains ?? []) {
    if (content && !norm(content).includes(norm(sub))) {
      throw new Error(`impactStatement must contain "${sub}"`);
    }
  }
  for (const forbidden of spec.mustNotBeIn ?? []) {
    if (forbidden === 'mission') {
      const m = model.mission?.content?.trim() ?? '';
      if (m && spec.contentContains?.some(s => norm(m).includes(norm(s)))) {
        throw new Error('Impact Statement content duplicated in mission');
      }
    } else if (domainContainsSubstring(model, forbidden, content)) {
      throw new Error(`impactStatement prose must not appear in ${forbidden}`);
    }
  }
  if (spec.mustNotDuplicate === 'mission' && content) {
    const m = norm(model.mission?.content ?? '');
    if (m && m === norm(content)) {
      throw new Error('impactStatement must not duplicate mission verbatim');
    }
  }
}

/** Fail if a (usually fabricated) substring appears in any domain. */
export function assertNotContainedAnywhere(model: LogicModel, needle: string): void {
  for (const d of ALL_DOMAINS) {
    if (domainContainsSubstring(model, d, needle)) {
      throw new Error(`Fabrication check: "${needle}" must not appear anywhere but was found in ${d}`);
    }
  }
}

/** Fail if a domain uses any non-"General" group (false taxonomy carried across columns). */
export function assertGroupsGeneralOnly(model: LogicModel, domain: LogicModelDomain): void {
  const badGroups = groupedContent(model, domain).filter(
    g => g.items.some(i => i.text?.trim()) && norm(g.name || 'General') !== 'general'
  );
  if (badGroups.length > 0) {
    throw new Error(
      `Grouping check: ${domain} should use only "General" but has [${badGroups.map(g => g.name).join(', ')}]`
    );
  }
}

export function assertFixture(model: LogicModel, fixture: ExtractFixture): void {
  assertMustHaveGroups(model, fixture);
  for (const p of fixture.placements ?? []) {
    assertPlacement(model, p);
  }
  for (const needle of fixture.mustNotContainAnywhere ?? []) {
    assertNotContainedAnywhere(model, needle);
  }
  for (const d of fixture.groupsMustBeGeneralOnly ?? []) {
    assertGroupsGeneralOnly(model, d);
  }
  if (fixture.impactStatement) assertImpactStatement(model, fixture.impactStatement);
  for (const d of fixture.regression?.domainsMustRemainNonEmpty ?? []) {
    if (findItems(model, d).length === 0) {
      throw new Error(`Regression: ${d} must remain non-empty`);
    }
  }
}
