import type { LogicModel, LogicModelGroup } from '../types';
import {
  harvestImpactStatementFromPlainText,
  looksLikeImpactStatementProse,
} from './impactStatementHarvest.js';
import { applySourceAwareMapping } from './sourceMapping.js';
import { promoteInlineColonLabels } from './inlineLabelGroups.js';
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

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
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
 * Known tension with the extract prompt (`constants.ts`'s "no heading at all ... never infer one
 * from wording alone"), surfaced via codebase audit (docs/specs/codebase-audit-2026-09-19.md #10):
 * the prompt's rule is about how *Gemini* should decide the field from the page it's looking at;
 * this function post-processes Gemini's *output*, using the same weak `looksLikeImpactStatementProse`
 * classifier the disarmed sibling (`impactStatementHarvest.ts`'s front-matter fallback) used to run
 * unconditionally and got disarmed for. The two are not identical hazards, though: that sibling ran
 * on every extract, regardless of shape; this one only runs when `countOutcomeItems <= 3` — gated
 * from a real corruption of its own (Eureka! College Readiness, see the constant below), and kept
 * narrowed rather than removed because a sparse outcome section is real, if imperfect, circumstantial
 * evidence Gemini actually dropped a real impact statement rather than that this is ordinary outcome
 * prose. Decision: keep as a deliberately narrow, evidence-gated exception rather than disarm to
 * match the sibling — revisit only if a real document surfaces a false promotion under the current
 * gate (matching how the sibling and the gate below were each disarmed/narrowed: from a real
 * document, not from principle alone).
 */
function promoteImpactStatementFromGroupedDomains(model: LogicModel): void {

  if (model.impactStatement?.content?.trim()) return;
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
  promoteImpactStatementFromGroupedDomains(model);
  // Before applySourceAwareMapping, so a promoted label reaches `sourceHeader` by the same path
  // every other group name takes. See shared/inlineLabelGroups.ts for what it fires on.
  promoteInlineColonLabels(model);
  applySourceAwareMapping(model);
  reconcileExtractionFidelity(model, {
    lowLegibility: options?.lowLegibility,
    textOnlyFallback: options?.textOnlyFallback,
  });
  return model;
}

export { looksLikeImpactStatementProse };
