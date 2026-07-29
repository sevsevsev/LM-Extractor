import type { LogicModel, LogicModelField, LogicModelGroup } from '../types';

export function stringDomainHasContent(content?: string): boolean {
  return Boolean(content?.trim());
}

export function groupedDomainHasContent(groups?: LogicModelGroup[]): boolean {
  return (groups ?? []).some(g => g.items.some(i => Boolean(i.text?.trim())));
}

function clearAbsentStringDomainCritique<T extends LogicModelField<string>>(field: T): void {
  if (!stringDomainHasContent(field.content)) {
    field.critique = '';
    delete field.rating;
  }
}

function clearAbsentGroupedDomainCritique<T extends LogicModelField<LogicModelGroup[]>>(field: T): void {
  if (!groupedDomainHasContent(field.content)) {
    field.critique = '';
    delete field.rating;
    for (const g of field.content) {
      for (const item of g.items) {
        delete item.critique;
        delete item.rating;
      }
    }
  }
}

function rationaleMentionsAbsentMission(bullet: string): boolean {
  const b = bullet.toLowerCase();
  if (!/\bmission\b/.test(b)) return false;
  return (
    /\b(absent|missing|not present|no mission|entirely absent|fundamental flaw)\b/.test(b) ||
    /\blacks?\s+(a\s+)?mission\b/.test(b) ||
    /\bmission\s+(is\s+)?(absent|missing|not present)\b/.test(b) ||
    /\bwithout\s+(a\s+)?mission\b/.test(b)
  );
}

/** Grid Impact column only — not labeled Impact Statement prose. */
function rationaleMentionsEmptyImpactGrid(bullet: string): boolean {
  const b = bullet.toLowerCase();
  if (/\bimpact statement\b/.test(b)) return false;
  if (!/\bimpact\b/.test(b)) return false;
  return (
    (/\b(empty|missing|absent|not present)\b/.test(b) &&
      (/\bimpact\s*(section|column|domain)\b/.test(b) ||
        /['']impact['']/.test(b) ||
        /\bthe\s+impact\b/.test(b))) ||
    /\bimpact\b.*\b(fails?|failing)\s+to\s+articulate\b/.test(b) ||
    /\bno\s+impact\s+(section|column)\b/.test(b)
  );
}

function rationaleMentionsAbsentMediumTerm(bullet: string): boolean {
  const b = bullet.toLowerCase();
  if (!/\bmedium[- ]term\b/.test(b)) return false;
  return /\b(absent|missing|not present|no medium)\b/.test(b);
}

export function shouldDropOverallRationaleBullet(bullet: string, model: LogicModel): boolean {
  const text = bullet.trim();
  if (!text) return true;

  if (!stringDomainHasContent(model.mission.content) && rationaleMentionsAbsentMission(text)) {
    return true;
  }
  if (
    !groupedDomainHasContent(model.mediumTermOutcomes.content) &&
    rationaleMentionsAbsentMediumTerm(text)
  ) {
    return true;
  }
  if (!groupedDomainHasContent(model.impact.content) && rationaleMentionsEmptyImpactGrid(text)) {
    return true;
  }
  return false;
}

function filterAbsentDomainRationaleBullets(model: LogicModel): string[] {
  const bullets = (model.overallQuality?.rationale ?? []).map(b => b.trim()).filter(Boolean);
  return bullets.filter(bullet => !shouldDropOverallRationaleBullet(bullet, model));
}

function ensureMinRationale(bullets: string[], min = 2): string[] {
  const out = [...bullets];
  const fallbacks = [
    'Assessment reflects domains present in the source document.',
    'Optional absent sections (e.g. Mission, Medium-Term) were not penalized.',
  ];
  for (const fb of fallbacks) {
    if (out.length >= min) break;
    if (!out.includes(fb)) out.push(fb);
  }
  return out.slice(0, 4);
}

/**
 * Clear critique/rating on optional domains with no content; strip unfair overall rationale bullets.
 */
export function sanitizeAbsentDomainCritiques(model: LogicModel): LogicModel {
  const m = structuredClone(model);

  if (m.impactStatement) clearAbsentStringDomainCritique(m.impactStatement);
  clearAbsentStringDomainCritique(m.mission);

  clearAbsentGroupedDomainCritique(m.mediumTermOutcomes);
  clearAbsentGroupedDomainCritique(m.impact);

  if (m.overallQuality) {
    m.overallQuality.rationale = ensureMinRationale(filterAbsentDomainRationaleBullets(m));
  }

  return m;
}

export interface GranularExportRow {
  organization: string;
  program: string;
  domain: string;
  group: string;
  content: string;
  domainCritique: string;
  domainRating: string;
  itemCritique: string;
  itemRating: string;
  overallRating: string;
  overallRationale: string;
}

/** Build full CSV rows — omit domains with no content (presence-first export). */
export function buildGranularExportRows(models: LogicModel[]): GranularExportRow[] {
  const rows: GranularExportRow[] = [];

  for (const m of models) {
    const overallRating = m.overallQuality?.rating || '';
    const overallRationale = (m.overallQuality?.rationale || []).filter(Boolean).join(' | ');

    const pushStringField = (
      domain: string,
      field: { content: string; critique?: string; rating?: string }
    ) => {
      if (!stringDomainHasContent(field.content)) return;
      rows.push({
        organization: m.organization,
        program: m.program,
        domain,
        group: 'General',
        content: field.content,
        domainCritique: field.critique || '',
        domainRating: field.rating || '',
        itemCritique: '',
        itemRating: '',
        overallRating,
        overallRationale,
      });
    };

    const pushField = (
      domain: string,
      field: { content: LogicModelGroup[]; critique?: string; rating?: string }
    ) => {
      if (!groupedDomainHasContent(field.content)) return;
      for (const g of field.content) {
        for (const item of g.items) {
          const text = item.text?.trim();
          if (!text) continue;
          rows.push({
            organization: m.organization,
            program: m.program,
            domain,
            group: g.name,
            content: text,
            domainCritique: field.critique || '',
            domainRating: field.rating || '',
            itemCritique: item.critique || '',
            itemRating: item.rating || '',
            overallRating,
            overallRationale,
          });
        }
      }
    };

    if (m.impactStatement?.content?.trim()) {
      pushStringField('Impact Statement', m.impactStatement);
    }
    pushStringField('Mission / Overview', m.mission);
    pushStringField('Target Population', m.targetPopulation);
    pushField('Inputs', m.inputs);
    pushField('Activities', m.activities);
    pushField('Outputs', m.outputs);
    pushField('Short-Term Outcomes', m.shortTermOutcomes);
    pushField('Medium-Term Outcomes', m.mediumTermOutcomes);
    pushField('Long-Term Outcomes', m.longTermOutcomes);
    pushField('Impact', m.impact);
  }

  return rows;
}
