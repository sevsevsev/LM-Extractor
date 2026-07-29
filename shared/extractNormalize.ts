import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import { harvestImpactStatementFromPlainText } from './impactStatementHarvest';

type GroupedDomain =
  | 'outputs'
  | 'shortTermOutcomes'
  | 'mediumTermOutcomes'
  | 'longTermOutcomes'
  | 'impact';

export interface NormalizeExtractOptions {
  /** PDF/DOCX text layer used to recover labeled Impact Statement when vision drops it. */
  sourceText?: string;
}

const OUTCOME_DOMAINS: GroupedDomain[] = [
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'impact',
];

/** Text patterns that usually indicate Outputs column content, not outcomes. */
const OUTPUT_TEXT_PATTERNS: RegExp[] = [
  /attendance\s+(is\s+)?maintained/i,
  /attendance\s+at\s+\d/i,
  /implementation\s+\d+\s+of/i,
  /implementation\s+of\s+.*(curriculum|dance|youth\s*moves)/i,
  /interactions?\s+\(\d+/i,
  /interaction\s+with\s+master/i,
  /student\s+choreography\s+driven/i,
];

/** Substring → track group hint when rebucketing outputs (YouthMoves-style tracks). */
const OUTPUT_TRACK_HINTS: { pattern: RegExp; group: string }[] = [
  { pattern: /attendance\s+at\s+90/i, group: 'YouthMoves at FLC' },
  { pattern: /implementation\s+5/i, group: 'YouthMoves at FLC' },
  { pattern: /interactions?\s+\(\s*3\s+events\s*\)\s*w\/\s*res/i, group: 'YouthMoves at FLC' },
  { pattern: /attendance\s+is\s+maintained/i, group: 'Summer Intensive' },
  { pattern: /implementation\s+2/i, group: 'Summer Intensive' },
  { pattern: /interaction\s+with\s+master\s+teachers/i, group: 'Summer Intensive' },
  { pattern: /student\s+choreography/i, group: 'Student Produced Concert' },
  { pattern: /implementation\s+of\s+flc\s+dance/i, group: 'Student Produced Concert' },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isOutputLikeText(text: string): boolean {
  return OUTPUT_TEXT_PATTERNS.some(p => p.test(text));
}

function inferOutputGroup(text: string): string {
  for (const { pattern, group } of OUTPUT_TRACK_HINTS) {
    if (pattern.test(text)) return group;
  }
  return 'General';
}

function looksLikeImpactStatementProse(text: string): boolean {
  const t = norm(text);
  if (t.length < 80) return false;
  // Labeled Impact Statement blocks are usually overview prose, not a short mission line.
  const signals =
    /through\s+sustained\s+participation/.test(t) ||
    /will\s+experience\s+an\s+affirming/.test(t) ||
    /fosters\s+artistic\s+growth/.test(t) ||
    /expanding\s+their\s+educational\s+pathways/.test(t) ||
    /long-term\s+career\s+opportunities/.test(t);
  return signals;
}

function promoteImpactStatementFromMission(model: LogicModel): void {
  const missionText = model.mission?.content?.trim() ?? '';
  const impactText = model.impactStatement?.content?.trim() ?? '';
  if (!missionText || impactText) return;

  if (looksLikeImpactStatementProse(missionText)) {
    model.impactStatement = { content: model.mission.content };
    model.mission = { ...model.mission, content: '' };
  }
}

/** Gemini sometimes drops page-1 Impact Statement into an outcome list item. */
function promoteImpactStatementFromGroupedDomains(model: LogicModel): void {
  if (model.impactStatement?.content?.trim()) return;

  for (const domain of OUTCOME_DOMAINS) {
    const field = model[domain];
    const groups = getGroups(field);
    let found: string | null = null;

    for (const g of groups) {
      for (const item of g.items) {
        if (item.text && looksLikeImpactStatementProse(item.text)) {
          found = item.text;
          break;
        }
      }
      if (found) break;
    }

    if (!found) continue;

    model.impactStatement = { content: found };
    for (const g of groups) removeItemFromGroups([g], found);
    setGroups(
      field,
      groups.filter(g => g.items.length > 0)
    );
    return;
  }
}

function getGroups(field: { content: LogicModelGroup[] }): LogicModelGroup[] {
  return field.content ?? [];
}

function setGroups(field: { content: LogicModelGroup[] }, groups: LogicModelGroup[]): void {
  field.content = groups;
}

function findGroup(groups: LogicModelGroup[], name: string): LogicModelGroup {
  let g = groups.find(x => x.name === name);
  if (!g) {
    g = { name, items: [] };
    groups.push(g);
  }
  return g;
}

function removeItemFromGroups(groups: LogicModelGroup[], text: string): void {
  const n = norm(text);
  for (const g of groups) {
    g.items = g.items.filter(item => norm(item.text) !== n);
  }
}

function addOutputItem(model: LogicModel, text: string, groupName: string): void {
  const groups = getGroups(model.outputs);
  const g = findGroup(groups, groupName);
  const n = norm(text);
  if (!g.items.some(item => norm(item.text) === n)) {
    g.items.push({ text });
  }
  setGroups(model.outputs, groups.filter(x => x.items.length > 0 || x.name === groupName));
}

/** Move obvious output-shaped items from outcome domains back to outputs. */
function rebucketObviousOutputs(model: LogicModel): void {
  for (const domain of OUTCOME_DOMAINS) {
    const field = model[domain];
    const groups = getGroups(field);
    const toMove: { text: string; group: string }[] = [];

    for (const g of groups) {
      for (const item of g.items) {
        if (item.text && isOutputLikeText(item.text)) {
          toMove.push({ text: item.text, group: inferOutputGroup(item.text) });
        }
      }
    }

    for (const { text } of toMove) {
      for (const g of groups) removeItemFromGroups([g], text);
    }
    setGroups(
      field,
      groups.filter(g => g.items.length > 0)
    );

    for (const { text, group } of toMove) {
      addOutputItem(model, text, group);
    }
  }
}

/** When model invents an Impact column, move those items to longTermOutcomes. */
function consolidateImpactIntoLongTerm(model: LogicModel): void {
  const impactGroups = getGroups(model.impact);
  const items: LogicModelItem[] = [];
  for (const g of impactGroups) {
    for (const item of g.items) {
      if (item.text?.trim()) items.push({ text: item.text });
    }
  }
  if (items.length === 0) return;

  const ltGroups = getGroups(model.longTermOutcomes);
  const ltGeneral = findGroup(ltGroups, 'General');
  for (const item of items) {
    const n = norm(item.text);
    if (!ltGeneral.items.some(i => norm(i.text) === n)) {
      ltGeneral.items.push(item);
    }
  }
  setGroups(model.longTermOutcomes, ltGroups);
  setGroups(model.impact, []);
}

/** Fill impactStatement from PDF/text layer when vision omitted it entirely. */
function fillMissingImpactStatementFromSourceText(model: LogicModel, sourceText?: string): void {
  if (!sourceText?.trim()) return;
  if (model.impactStatement?.content?.trim()) return;

  const harvested = harvestImpactStatementFromPlainText(sourceText);
  if (!harvested) return;

  model.impactStatement = { content: harvested };

  // Remove duplicate if harvest matches something still sitting in mission/outcomes.
  if (norm(model.mission?.content ?? '') === norm(harvested)) {
    model.mission = { ...model.mission, content: '' };
  }
  for (const domain of OUTCOME_DOMAINS) {
    const field = model[domain];
    const groups = getGroups(field);
    for (const g of groups) removeItemFromGroups([g], harvested);
    setGroups(
      field,
      groups.filter(g => g.items.length > 0)
    );
  }
}

/**
 * Post-extract fixes for common vision mis-bucketing on multi-column grid LMs.
 * Does not call Gemini; safe to run after every extract.
 */
export function normalizeExtractedLogicModel(
  model: LogicModel,
  options?: NormalizeExtractOptions
): LogicModel {
  fillMissingImpactStatementFromSourceText(model, options?.sourceText);
  promoteImpactStatementFromMission(model);
  rebucketObviousOutputs(model);
  promoteImpactStatementFromGroupedDomains(model);
  consolidateImpactIntoLongTerm(model);
  return model;
}

export { isOutputLikeText, looksLikeImpactStatementProse, inferOutputGroup };
