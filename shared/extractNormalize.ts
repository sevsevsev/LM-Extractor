import type { LogicModel, LogicModelGroup } from '../types';
import {
  harvestImpactStatementFromPlainText,
  looksLikeImpactStatementProse,
} from './impactStatementHarvest.js';
import { applySourceAwareMapping } from './sourceMapping.js';
import { promoteInlineColonLabels } from './inlineLabelGroups.js';
import { splitRunOnItems } from './listItemSplit.js';
import { reconcileExtractionFidelity } from './extractionFidelity.js';
import { dropRestatedDuplicates } from './restatedDuplicates.js';

export interface NormalizeExtractOptions {
  /**
   * The bundle's Track A text. Recovers a labelled Impact Statement when vision drops it, and
   * feeds the page-coverage check in `reconcileExtractionFidelity` (shared/pageCoverage.ts).
   */
  sourceText?: string;
  /** From DocumentBundle warnings — drives extraction fidelity rollup. */
  lowLegibility?: boolean;
  /** From `bundleUsedTextOnlyFallback` — drives extraction fidelity rollup. */
  textOnlyFallback?: boolean;
}

/**
 * Fill an EMPTY impactStatement from a labelled heading in the PDF/text layer when vision omitted it.
 *
 * This only ever fills a field the model left empty, from text sitting under one of the
 * impact-statement headings. It used to also delete any matching item from the outcome columns and
 * clear `mission` when it matched — that is, move content out of the place the model put it. That
 * was removed with `promoteImpactStatementFromGroupedDomains` under the rule now stated on
 * `normalizeExtractedLogicModel`: post-processing may fix shape, never move an item between
 * domains. If the same sentence now shows twice, a reviewer sees it and deletes one; a silent
 * removal is a loss nobody sees.
 */
function fillMissingImpactStatementFromSourceText(model: LogicModel, sourceText?: string): void {
  if (!sourceText?.trim()) return;
  if (model.impactStatement?.content?.trim()) return;

  const harvested = harvestImpactStatementFromPlainText(sourceText);
  if (!harvested) return;

  model.impactStatement = { content: harvested };
}

/**
 * Drop a trailing colon from a group name.
 *
 * MEASURED, not tidied: the 2026-09-22 census had Oxford Circle down as the one unstable PDF left
 * in the set, and the whole of its instability was four group names coming back as
 * `Frontline Staff:` on one run and `Frontline Staff` on the next. Zero items moved column, none
 * appeared or vanished. The model simply carries the source's colon into the name some runs and
 * not others, and a regression diff cannot tell that apart from a real regrouping.
 *
 * Safe because no group name legitimately ends in a colon: none of the ten committed snapshots has
 * one, and `promoteInlineColonLabels` already strips the colon off the labels it promotes, so this
 * only catches names Gemini wrote itself. A name that is nothing BUT punctuation is left alone
 * rather than emptied.
 */
function trimGroupNameColons(model: LogicModel): void {
  for (const field of Object.values(model) as { content?: LogicModelGroup[] }[]) {
    if (!field || !Array.isArray(field.content)) continue;
    for (const group of field.content) {
      const trimmed = (group.name ?? '').trim().replace(/\s*:+$/, '').trim();
      if (trimmed) group.name = trimmed;
    }
  }
}

/**
 * Post-extract fixes that preserve source fidelity.
 *
 * THE RULE EVERY PASS HERE KEEPS: post-processing may change an item's SHAPE — trim a colon off a
 * group name, promote an inline `Label:` to the group name within its own column, split a run-on
 * cell into its parts, drop an `unmapped` copy that is word-for-word already in a column — and it
 * may fill a field the model left EMPTY from labelled source text. It never moves an item from the
 * domain the model put it in to another domain.
 *
 * Why it is a rule and not a judgement call: both post-processing defects this project shipped were
 * moves. `promoteImpactStatementFromGroupedDomains` stole a correctly placed Medium-Term outcome
 * into `impactStatement` on Eureka! College Readiness, and its sibling harvester duplicated mission
 * prose into `impactStatement` on Imagine That Philly. Each was a weak string classifier overriding
 * a model that could see the page. A wrong column is a prompt problem or a reviewer's call; the
 * board already lets an operator move an item in one click, and logs it.
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
  // Before applySourceAwareMapping, so a promoted label reaches `sourceHeader` by the same path
  // every other group name takes. See shared/inlineLabelGroups.ts for what it fires on.
  promoteInlineColonLabels(model);
  // After promotion (whose labels never carry one) and before mapping, so `sourceHeader` and every
  // later comparison see the same name the reviewer will.
  trimGroupNameColons(model);
  // After the label promoter (which strips a promoted `Label:` prefix, so a cell that was a
  // labelled list is now a bare list this can act on) and before mapping, so a part that names
  // its own column is placed on its own rather than dragging the whole cell with it.
  splitRunOnItems(model);
  applySourceAwareMapping(model);
  // After mapping, because a restated copy only counts as a duplicate once both it and the item it
  // repeats have reached their final domains; before the fidelity rollup, so the page-coverage
  // check counts the board the reviewer will actually see.
  dropRestatedDuplicates(model);
  reconcileExtractionFidelity(model, {
    lowLegibility: options?.lowLegibility,
    textOnlyFallback: options?.textOnlyFallback,
    // Same Track A text `fillMissingImpactStatementFromSourceText` reads above, reused here for
    // the page-coverage check rather than threaded in as a second parameter.
    sourceText: options?.sourceText,
  });
  return model;
}

export { looksLikeImpactStatementProse };
