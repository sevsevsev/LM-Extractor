import type { LogicModel, LogicModelGroup } from '../types';
import {
  harvestImpactStatementFromPlainText,
  hasImpactStatementHeading,
  looksLikeImpactStatementProse,
} from './impactStatementHarvest.js';
import { applySourceAwareMapping } from './sourceMapping.js';
import { reconcileExtractionFidelity } from './extractionFidelity.js';

type GroupedDomain =
  | 'outputs'
  | 'shortTermOutcomes'
  | 'mediumTermOutcomes'
  | 'longTermOutcomes'
  | 'generalOutcomes'
  | 'impact';

export interface NormalizeExtractOptions {
  /** PDF/DOCX text layer used to recover labeled Impact Statement when vision drops it. */
  sourceText?: string;
  /** From DocumentBundle warnings — drives extraction fidelity rollup. */
  lowLegibility?: boolean;
  /** From `bundleUsedTextOnlyFallback` — drives extraction fidelity rollup. */
  textOnlyFallback?: boolean;
}

const OUTCOME_DOMAINS: GroupedDomain[] = [
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'generalOutcomes',
  'impact',
];

/** Text patterns that usually indicate Outputs column content, not outcomes. Kept for tests/diagnostics. */
const OUTPUT_TEXT_PATTERNS: RegExp[] = [
  /attendance\s+(is\s+)?maintained/i,
  /attendance\s+at\s+\d/i,
  /implementation\s+\d+\s+of/i,
  /implementation\s+of\s+.*(curriculum|dance|youth\s*moves)/i,
  /interactions?\s+\(\d+/i,
  /interaction\s+with\s+master/i,
  /student\s+choreography\s+driven/i,
];

/** @deprecated Fixture-era track hints — no longer used to rebucket; retained for test helpers. */
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

/**
 * Only promote when the outcomes section overall is sparse (a handful of items total, across
 * every outcome domain). Found via a real document (Eureka! College Readiness — no separate
 * Impact section at all) where a legitimately-placed, specific Medium-Term Outcomes item
 * ("Increase in the number of participants in post-secondary education...") was silently stolen
 * into `impactStatement` purely because it shares ordinary population/change-verb vocabulary with
 * mission-style prose — `looksLikeImpactStatementProse` can't tell "this reads like an overview
 * sentence" from "this is a normal, well-formed outcome bullet," and richly-itemized outcomes
 * (several short/medium/long-term bullets, as any well-structured logic model has) are strong
 * evidence Gemini found the real grid rather than dumping one paragraph in its place. A genuinely
 * dropped impact statement, by contrast, tends to show up alongside very few other outcome items.
 */
const MAX_TOTAL_OUTCOME_ITEMS_FOR_PROMOTION = 3;

function countOutcomeItems(model: LogicModel): number {
  let total = 0;
  for (const domain of OUTCOME_DOMAINS) {
    for (const g of getGroups(model[domain])) total += g.items.length;
  }
  return total;
}

/**
 * Gemini sometimes drops page-1 Impact Statement into an outcome list item.
 *
 * Gated on heading evidence whenever a text layer is available. The extraction prompt tells the
 * model `impactStatement` "requires an explicit heading … never infer one from wording alone"
 * (see CONTEXT & OVERVIEW in constants.ts) — so when the source text demonstrably has no such
 * heading, promoting an outcome item here would manufacture exactly what the prompt forbids, and
 * silently overwrite a correct empty answer. `looksLikeImpactStatementProse` cannot tell an
 * overview sentence from a well-formed outcome bullet; the heading can. When there is no text
 * layer to check (vision-only bundles), behavior is unchanged — we have no evidence either way,
 * and the `MAX_TOTAL_OUTCOME_ITEMS_FOR_PROMOTION` gate still applies.
 */
function promoteImpactStatementFromGroupedDomains(model: LogicModel, sourceText?: string): void {
  if (model.impactStatement?.content?.trim()) return;
  if (sourceText?.trim() && !hasImpactStatementHeading(sourceText)) return;
  if (countOutcomeItems(model) > MAX_TOTAL_OUTCOME_ITEMS_FOR_PROMOTION) return;

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

function removeItemFromGroups(groups: LogicModelGroup[], text: string): void {
  const n = norm(text);
  for (const g of groups) {
    g.items = g.items.filter(item => norm(item.text) !== n);
  }
}

/** Fill impactStatement from PDF/text layer when vision omitted it entirely. */
function fillMissingImpactStatementFromSourceText(model: LogicModel, sourceText?: string): void {
  if (!sourceText?.trim()) return;
  if (model.impactStatement?.content?.trim()) return;

  const harvested = harvestImpactStatementFromPlainText(sourceText);
  if (!harvested) return;

  model.impactStatement = { content: harvested };

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
 * Post-extract fixes that preserve source fidelity.
 * Does NOT force YouthMoves-style output rebucketing or clear a real Impact column.
 * Source-aware synonym annotation/remap runs after presence recoveries.
 */
export function normalizeExtractedLogicModel(
  model: LogicModel,
  options?: NormalizeExtractOptions
): LogicModel {
  // generalOutcomes is optional on raw Gemini JSON (most documents never populate it) — initialize
  // it up front so every helper below (and applySourceAwareMapping after them) can treat it like
  // the always-present outcome fields instead of each needing its own undefined guard.
  if (!model.generalOutcomes) model.generalOutcomes = { content: [] };
  fillMissingImpactStatementFromSourceText(model, options?.sourceText);
  promoteImpactStatementFromGroupedDomains(model, options?.sourceText);
  applySourceAwareMapping(model);
  reconcileExtractionFidelity(model, {
    lowLegibility: options?.lowLegibility,
    textOnlyFallback: options?.textOnlyFallback,
  });
  return model;
}

export { isOutputLikeText, looksLikeImpactStatementProse, inferOutputGroup };
