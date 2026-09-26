import type {
  DocumentTypeAssessment,
  ExtractionConfidence,
  ExtractionFidelity,
  ExtractionStatus,
  LogicModel,
  LogicModelGroup,
  PossiblyMissedRegion,
} from '../types';
import { stringDomainHasContent, groupedDomainHasContent } from './domainPresence.js';
import { findUncoveredGridPages, formatUncoveredPages } from './pageCoverage.js';
import { shouldSuggestMismatch } from './sourceMapping.js';

const STATUSES: readonly ExtractionStatus[] = ['ok', 'partial', 'abstained'];
const CONFIDENCES: readonly ExtractionConfidence[] = ['high', 'medium', 'low'];
const DOCUMENT_TYPE_ASSESSMENTS: readonly DocumentTypeAssessment[] = [
  'logic_model',
  'not_logic_model',
  'unclear',
];

const STATUS_RANK: Record<ExtractionStatus, number> = {
  ok: 0,
  partial: 1,
  abstained: 2,
};

/** Stable blocker copy for tests and CSV. */
/**
 * Operator-facing warning text. These strings are read by whoever is checking an extraction before
 * it goes out for coding — not by developers — so they are written in plain language: say what
 * happened to the document, and what the person should do about it. No schema words ("domain",
 * "non-verbatim", "layout family"), no NLP words, no "the model".
 *
 * They surface in three places: the amber banner in LogicModelEditor, the one-line reason beside a
 * flagged file in SessionFileList, and the `extraction_blockers` column of the internal extraction
 * log. Keep each one short enough to read at a glance in the file list.
 */
export const FIDELITY_BLOCKERS = {
  abstained: 'The AI could not read this document well enough to extract anything from it',
  // `lowRes`, `highNonVerbatim` and `nonVerbatimShare` were removed in friction-log session 20.
  // All three were selected by the non-verbatim ratio, and that ratio counted a field Gemini is no
  // longer asked for, so none of them could be reached any more. An operator-facing string with no
  // path to the operator is worse than none: it reads as a warning the system can still give.
  mismatch:
    'Some content did not fit any of the standard columns and was put under "Unmapped" — check whether it belongs somewhere',
  unknownLayout:
    'The layout of this document could not be worked out, so items may have ended up in the wrong columns',
  noContent: 'Nothing could be extracted from this document',
  /**
   * Scope matters in this wording. The per-page warning that triggers it is specific and accurate
   * ("Page 5 of this document is a flattened image at low resolution"); this blocker used to drop
   * the page number and restate it as a document-wide diagnosis, "This image is low resolution".
   *
   * Rock School (friction-log session 20) is where that misleads: one of its five pages is a
   * flattened raster, which is what fired the detector, while the other four are unreadable for an
   * unrelated reason — their font never embedded, so they are mojibake at any DPI. An operator
   * told the whole document is low-resolution may go and re-scan it, which cannot help either
   * problem. So these say which pages and what to do, and leave the cause to the per-page warning
   * that actually measured it.
   */
  lowLegibilityPartial: 'Some pages of this document were hard to read, so some wording may have been misread',
  /**
   * Flattened / low-DPI dense grids (Oxford Circle–class) — do not trust fluent OCR. Caps at
   * partial/medium and never hard-stops (see the confidence block): the extraction is shown to the
   * operator with this warning attached, rather than discarded.
   */
  lowLegibilityDense:
    'Some pages of this document were hard to read, so wording may have been misread — check every item against the original before using this',
  /** Gemini's own per-image self-report — caps at partial/medium, never forces low/abstained. */
  possiblyIncomplete:
    'The AI was not sure it captured everything on part of the page — check the document for anything missing',
  /**
   * Gemini's document-type self-report (see DOCUMENT TYPE CHECK prompt) — never hard-stops.
   *
   * There are two of these because the self-report answers a narrower question than its name
   * suggests. `not_logic_model` comes back whenever the document does not lay its logic model out
   * as a labelled column grid, which is true of documents that extract perfectly well: Harlem
   * Lacrosse and UPenn BioEyes are both flagged and both produce a grid a coder can use. Telling
   * the person checking such an extraction "this may not be a logic model" contradicts what is on
   * the screen in front of them, and the one thing they can actually act on — that the app, not the
   * document, decided which column each item belongs in — was buried.
   *
   * So the flag is reported by what it means for this extraction, chosen on whether anything landed
   * in the grid (`countExtractionItems().grid`, which excludes Unmapped):
   *   - items in the grid  -> `noColumnGrid`: the columns are the app's reading, so check them.
   *   - nothing in the grid -> `notLogicModel`: the document-type doubt is the whole story.
   * Neither wording changes any decision; both sit at the same ok -> partial/medium ceiling the
   * single string had.
   */
  noColumnGrid:
    'This document does not label its columns, so the app worked out which column each item belongs in — check the columns before relying on this extraction',
  notLogicModel:
    'Nothing was put in the columns, and this may not be a logic model — check the document before relying on this extraction',
  /** Vision conversion failed entirely (not just low-res) — extracted from the text layer alone. */
  textOnlyFallback:
    'This document could not be read as images, only as text, so the columns and formatting may be wrong',
  /**
   * A page of the document holds a logic model grid whose wording is not in this extraction — see
   * shared/pageCoverage.ts for what is measured and why the bar is set where it is.
   *
   * This is the only missed-content signal in the app that does not come from Gemini. The wording
   * therefore says what was observed ("not in this extraction") rather than diagnosing why, because
   * the check cannot tell a second version of the same logic model from a second programme's grid
   * from a page the model simply skipped — and the operator, looking at the page, can.
   *
   * The page number is appended at the point of use, the way `notLogicModel` appends its note.
   */
  pageNotExtracted:
    'Part of this document holds a logic model that is not in this extraction — open the page named and check what is missing',
  /** Overview text (mission/target/impact) was recovered but the grid itself came back empty. */
  noGridItems:
    'No Inputs, Activities, Outputs or Outcomes were found — check whether this document actually has a logic model grid',
} as const;

export function isExtractionStatus(value: unknown): value is ExtractionStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isExtractionConfidence(value: unknown): value is ExtractionConfidence {
  return typeof value === 'string' && (CONFIDENCES as readonly string[]).includes(value);
}

export function isDocumentTypeAssessment(value: unknown): value is DocumentTypeAssessment {
  return typeof value === 'string' && (DOCUMENT_TYPE_ASSESSMENTS as readonly string[]).includes(value);
}

/** True when Gemini flagged the source as possibly not a logic model — never a hard-stop signal alone. */
export function isPossiblyNotLogicModel(model: LogicModel): boolean {
  const assessment = model.documentTypeAssessment;
  return assessment === 'not_logic_model' || assessment === 'unclear';
}

/** Short label for CSV export / UI — '' when there's nothing to flag. */
/**
 * The per-row document-type flag, in both CSVs.
 *
 * It used to say "Possibly Not a Logic Model", which hedges and — more importantly — leaves out
 * the consequence. When a document has no input/activity/output column structure, the app did not
 * READ the domain for each item off a column header; it decided the domain itself. Those are
 * different claims and a coder has no way to get from the first to the second.
 *
 * So the flag states the consequence rather than the diagnosis. The underlying rule is clean and
 * needs no new field: when `documentTypeAssessment` is anything other than `logic_model`, every
 * domain assignment in that document is the app's categorization rather than the document's own
 * labelling. `documentTypeNote` carries the specific reason and reaches "Review Reasons" in the
 * full CSV via the fidelity blocker.
 *
 * It no longer opens with "Not a logic model" when items did land in the grid. That sentence was
 * read as a verdict on the document, and it was wrong on both of the flagged documents that
 * extract correctly; the verdict is kept for the case it is true of, an extraction with an empty
 * grid.
 */
export function documentTypeFlagLabel(model: LogicModel): string {
  if (!isPossiblyNotLogicModel(model)) return '';
  // Same split as the two blockers above, for the same reason: a populated grid must not be
  // labelled "not a logic model". See the `noColumnGrid` comment in FIDELITY_BLOCKERS.
  const populatedGrid = countExtractionItems(model).grid > 0;
  if (model.documentTypeAssessment === 'not_logic_model')
    return populatedGrid
      ? 'No column grid in this document — the app sorted these items into columns; the document did not label them'
      : 'Not a logic model — nothing was extracted into the columns';
  return populatedGrid
    ? 'Unclear document type — some columns may have been assigned by the app rather than read from the document'
    : 'Unclear document type — nothing was extracted into the columns';
}

export function applyExtractionFidelity(model: LogicModel, fidelity: ExtractionFidelity): LogicModel {
  model.extractionStatus = fidelity.status;
  model.extractionConfidence = fidelity.confidence;
  model.extractionBlockers = fidelity.blockers.length ? fidelity.blockers : undefined;
  return model;
}

export function normalizeBlockers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = (typeof item === 'string' ? item : String(item ?? '')).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

/** Clamp optional fidelity fields from AI JSON (before or after reconcile). */
export function parseExtractionFidelityFields(model: Record<string, unknown>): void {
  if ('extractionStatus' in model) {
    if (isExtractionStatus(model.extractionStatus)) {
      // keep
    } else if (model.extractionStatus == null || model.extractionStatus === '') {
      delete model.extractionStatus;
    } else {
      delete model.extractionStatus;
    }
  }
  if ('extractionConfidence' in model) {
    if (!isExtractionConfidence(model.extractionConfidence)) {
      delete model.extractionConfidence;
    }
  }
  if ('documentTypeAssessment' in model) {
    if (!isDocumentTypeAssessment(model.documentTypeAssessment)) {
      delete model.documentTypeAssessment;
    }
  }
  if ('documentTypeNote' in model) {
    const note = model.documentTypeNote;
    const trimmed = typeof note === 'string' ? note.trim().slice(0, 200) : '';
    if (trimmed) model.documentTypeNote = trimmed;
    else delete model.documentTypeNote;
  }
  if ('possiblyMissedRegions' in model) {
    const regions = normalizePossiblyMissedRegions(model.possiblyMissedRegions);
    if (regions.length) model.possiblyMissedRegions = regions;
    else delete model.possiblyMissedRegions;
  }
  if ('extractionBlockers' in model) {
    const blockers = normalizeBlockers(model.extractionBlockers);
    if (blockers.length) model.extractionBlockers = blockers;
    else delete model.extractionBlockers;
  }
}

const GROUPED_DOMAINS: (keyof LogicModel)[] = [
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

/**
 * Count the items an extraction actually produced.
 *
 * This used to also return `nonVerbatim`, counting `item.verbatim === false`, and that count fed
 * the ratio below. Gemini stopped being asked for `verbatim` in friction-log session 20 (see
 * `server/geminiLogicModel.ts`), and the only thing that sets it now is an operator editing an
 * item, which sets it to `true`. The count was therefore structurally zero, and every branch
 * reading it was dead code shaped like a guard — the exact thing a previous audit of this file
 * removed once already (see the `N < 6` confidence branch).
 */
export function countExtractionItems(model: LogicModel): { total: number; grid: number } {
  let total = 0;
  let grid = 0;
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) {
      for (const item of group.items ?? []) {
        if (!item.text?.trim()) continue;
        total += 1;
        // `grid` is what a reader sees in the columns, so Unmapped does not count towards it. It
        // exists to tell "no column grid, items placed by content" apart from "nothing extracted",
        // which `total` cannot: Philadelphia Ballet returns 42 items, all of them Unmapped.
        if (domain !== 'unmapped') grid += 1;
      }
    }
  }
  return { total, grid };
}

const MAX_MISSED_REGIONS = 6;

/** Clamp/validate Gemini's self-reported `possiblyMissedRegions` (same posture as `normalizeBlockers`). */
function normalizePossiblyMissedRegions(raw: unknown): PossiblyMissedRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: PossiblyMissedRegion[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const page = rec.page;
    if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) continue;
    const pageInt = Math.round(page);
    const xStartRaw = rec.xStart;
    const xEndRaw = rec.xEnd;
    const hasValidSpan =
      typeof xStartRaw === 'number' &&
      Number.isFinite(xStartRaw) &&
      typeof xEndRaw === 'number' &&
      Number.isFinite(xEndRaw) &&
      xStartRaw >= 0 &&
      xEndRaw <= 1 &&
      xEndRaw > xStartRaw;
    const xStart = hasValidSpan ? xStartRaw : undefined;
    const xEnd = hasValidSpan ? xEndRaw : undefined;
    const noteRaw = rec.note;
    const note = typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim().slice(0, 200) : undefined;
    const key = `${pageInt}:${hasValidSpan ? `${xStart!.toFixed(2)}-${xEnd!.toFixed(2)}` : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hasValidSpan ? { page: pageInt, xStart, xEnd, note } : { page: pageInt, note });
    if (out.length >= MAX_MISSED_REGIONS) break;
  }
  return out;
}

export function hasRecoveredLogicModelContent(model: LogicModel): boolean {
  if (stringDomainHasContent(model.mission?.content)) return true;
  if (stringDomainHasContent(model.targetPopulation?.content)) return true;
  if (model.impactStatement && stringDomainHasContent(model.impactStatement.content)) return true;
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    if (groupedDomainHasContent(field?.content)) return true;
  }
  return false;
}

function upgradeStatus(current: ExtractionStatus, next: ExtractionStatus): ExtractionStatus {
  return STATUS_RANK[next] > STATUS_RANK[current] ? next : current;
}

function pushBlocker(list: string[], seen: Set<string>, text: string): void {
  const key = text.toLowerCase();
  if (seen.has(key) || list.length >= 4) return;
  seen.add(key);
  list.push(text);
}

export interface ReconcileFidelityOptions {
  lowLegibility?: boolean;
  /** True when vision conversion failed entirely — see `bundleUsedTextOnlyFallback` in types.ts. */
  textOnlyFallback?: boolean;
  /**
   * The bundle's Track A text, for the page-coverage check (shared/pageCoverage.ts). Optional, and
   * absent means "no opinion", not "covered": re-normalizing an already-reconciled model without it
   * (App.tsx's `modelForExport`) must not clear a warning the first pass raised. It does not:
   * blockers already on the model are read back through `modelBlockers` and re-pushed below, and
   * `status` is never downgraded.
   */
  sourceText?: string;
}

/**
 * Reconcile document-level extraction fidelity after normalize.
 * Never downgrades status severity; confidence is computed from signals.
 */
export function reconcileExtractionFidelity(
  model: LogicModel,
  options?: ReconcileFidelityOptions
): LogicModel {
  const lowLegibility = Boolean(options?.lowLegibility);
  const modelBlockers = normalizeBlockers(model.extractionBlockers);
  let status: ExtractionStatus = isExtractionStatus(model.extractionStatus)
    ? model.extractionStatus
    : 'ok';

  if (status === 'abstained') {
    const blockers: string[] = [];
    const seen = new Set<string>();
    pushBlocker(blockers, seen, FIDELITY_BLOCKERS.abstained);
    for (const b of modelBlockers) pushBlocker(blockers, seen, b);
    return applyExtractionFidelity(model, {
      status: 'abstained',
      confidence: 'low',
      blockers,
    });
  }

  const { total: N, grid: G } = countExtractionItems(model);
  const L = lowLegibility;
  const T = Boolean(options?.textOnlyFallback);
  const M = shouldSuggestMismatch(model);
  const Uunk = model.layoutFamily === 'unknown';
  // Gemini's document-type self-report — same trust ceiling as mismatch/unknown-layout (can only
  // push ok -> partial/medium); never a hard-stop, since the point is a human reviews it, not that
  // extraction is untrustworthy.
  const notLogicModel = isPossiblyNotLogicModel(model);
  const noContent = !hasRecoveredLogicModelContent(model);
  // Overview text alone (mission/target/impact) satisfies `hasRecoveredLogicModelContent`, so a
  // document that extracted zero grid items could previously sail through as `ok`/`high` as long
  // as some overview prose came back — found via real-batch log analysis. Same non-severe ceiling
  // as M/Uunk/notLogicModel — a genuinely empty result (noContent too) still gets the stricter
  // low-confidence/hard-stop treatment via `noContent` below.
  const noGridItems = N === 0;
  // Gemini's own per-image self-report (see server/geminiLogicModel.ts) — Gemini re-looks at each
  // TRACK B image it was shown and flags any it wasn't confident it fully transcribed. Same trust
  // ceiling as mismatch/unknown-layout (can only push ok -> partial/medium), never a hard-stop.
  //
  // A client-side text-line-counting heuristic used to feed this signal too (compared candidate
  // bullet/numbered lines in Track A against extracted item counts). Removed after auditing a real
  // 112-file batch: hand-verifying 3 flagged documents against their source PDFs found it firing on
  // wrapped multi-column table lines, numbered academic references, and legitimate secondary
  // sections (evaluation frameworks, stat-tile infographics) that were never meant to be extracted
  // as grid items — 3 for 3 false positives, driving the large majority of that batch's "Needs
  // Review" flags. See docs/specs/extraction-confidence-v1.md.
  const geminiMissedRegions = normalizePossiblyMissedRegions(model.possiblyMissedRegions);
  const hasMissedContentSignal = geminiMissedRegions.length > 0;
  // The code-side counterpart to the self-report above: pages that structurally hold a logic model
  // grid whose wording did not come back. Deliberately a separate signal with its own blocker
  // rather than a second contributor to `possiblyMissedRegions` — see shared/pageCoverage.ts.
  // Same trust ceiling as everything else in this block: ok -> partial/medium, never a hard stop.
  // Skipped when nothing came back at all, since `noContent`/`noGridItems` say that far louder.
  const uncoveredPages =
    noContent || noGridItems ? [] : findUncoveredGridPages(model, options?.sourceText);
  const hasUncoveredPages = uncoveredPages.length > 0;

  if (status === 'ok') {
    if (
      M ||
      Uunk ||
      notLogicModel ||
      T ||
      noGridItems ||
      (L && N >= 6) ||
      modelBlockers.length > 0 ||
      noContent ||
      hasMissedContentSignal ||
      hasUncoveredPages
    ) {
      status = upgradeStatus(status, 'partial');
    }
  }

  // partial stays partial (never downgrade to ok)

  const blockers: string[] = [];
  const seen = new Set<string>();
  for (const b of modelBlockers) pushBlocker(blockers, seen, b);

  if (noContent) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.noContent);
  else if (noGridItems) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.noGridItems);
  if (T) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.textOnlyFallback);
  // Dense low-legibility grids (e.g. Oxford Circle). Raises the loudest warning available; since
  // 2026-09-20 it no longer forces a hard stop (see the confidence block for why).
  if (L && N >= 6) {
    pushBlocker(blockers, seen, FIDELITY_BLOCKERS.lowLegibilityDense);
  } else if (L && status === 'partial') {
    // The message used to be chosen by the non-verbatim ratio (`lowRes` above 0.25, this one
    // below). With that count gone there is one honest message left: the image was hard to read.
    pushBlocker(blockers, seen, FIDELITY_BLOCKERS.lowLegibilityPartial);
  }
  if (M) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.mismatch);
  if (Uunk) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.unknownLayout);
  if (notLogicModel) {
    // Which of the two wordings applies is decided by the grid, not by the flag — see the
    // `noColumnGrid` comment in FIDELITY_BLOCKERS. `G` counts the same items the board shows in
    // its columns, so `N` (which includes Unmapped) cannot stand in for it.
    const base = G > 0 ? FIDELITY_BLOCKERS.noColumnGrid : FIDELITY_BLOCKERS.notLogicModel;
    pushBlocker(
      blockers,
      seen,
      model.documentTypeNote ? `${base} (${model.documentTypeNote})` : base
    );
  }
  if (hasMissedContentSignal) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.possiblyIncomplete);
  if (hasUncoveredPages) {
    pushBlocker(
      blockers,
      seen,
      `${FIDELITY_BLOCKERS.pageNotExtracted} (${formatUncoveredPages(uncoveredPages)})`
    );
  }

  let confidence: ExtractionConfidence;
  // `low` is reserved for "there is nothing worth showing the operator" — the model abstained, or
  // no content came back. It is NOT a doubt level: `shouldHardStopExtraction` turns `low` into
  // `status: 'error'` with `result: undefined` in App.tsx, discarding the extraction outright.
  //
  // Low legibility used to reach here via `(L && N >= 6)` and `(status === 'partial' && L)`, which
  // meant ANY image under the resolution threshold that extracted 6+ items was thrown away
  // regardless of how good the extraction was. Measured on art-thru-youth (friction-log session
  // 11): a 1024px PNG whose extraction matched the source string for string, with zero inventions
  // and the source's own "Suport working families" typo preserved, was discarded by this branch.
  // The conversion warning that triggers it (fileService.ts) asks the operator to "verify the
  // extracted wording against the original" — a review instruction, not a refusal.
  //
  // So low legibility now carries the same non-severe ceiling already documented for mismatch,
  // unknown-layout and the document-type self-report: it can push `ok -> partial/medium` and
  // raise a blocker, never hard-stop. The operator sees the extraction and the warning together
  // and decides. Keep in mind the underlying concern is real — art-thru-youth returns 18/17/13
  // items across three runs — which is exactly why it must be flagged loudly, and also why a gate
  // that cannot measure the extraction should not be the thing deciding.
  // The third arm here used to be `status === 'partial' && N >= 6 && ratio >= 0.4`, which made an
  // undefined, model-guessed field the deciding input to whether an extraction was DISCARDED. That
  // is the whole reason session 20 cut the field loose; `low` now means only what it says it means
  // two paragraphs up — the model abstained, or nothing came back.
  if (status === 'abstained' || noContent) {
    confidence = 'low';
  } else if (status === 'partial' || M || Uunk || L) {
    confidence = 'medium';
  } else if (N < 6 && (status !== 'ok' || L)) {
    // A small extract (<6 items) with any non-verbatim item still needs a review nudge, same as a
    // large one crossing the ratio threshold above — found via codebase audit: this branch
    // previously only checked `status !== 'ok' || L`, so a document with e.g. 5 items and 4 flagged
    // non-verbatim fell straight to the `high` default below with no blocker at all, since `status`
    // stays `ok` (nothing else upgrades it) and low legibility wasn't in play. The `Vf === 0`
    // override that used to sit below this block was meant to guard exactly this case, but every
    // path that reached it had already been assigned `high` by the same default — dead code that
    // looked like a guard. Removed; this condition is the actual fix.
    confidence = 'medium';
  } else {
    confidence = 'high';
  }

  // Gemini's own per-image self-report is now the only source of possiblyMissedRegions — see the
  // removal note above for why the client-side text heuristic that used to also contribute here
  // was taken out.
  model.possiblyMissedRegions = geminiMissedRegions.length
    ? geminiMissedRegions.slice(0, MAX_MISSED_REGIONS)
    : undefined;

  return applyExtractionFidelity(model, { status, confidence, blockers });
}

/** Stop pipeline (no critique / editor) when capture is not trustworthy enough. */
export function shouldHardStopExtraction(model: LogicModel): boolean {
  return model.extractionStatus === 'abstained' || model.extractionConfidence === 'low';
}

/**
 * The "partial or medium" rule — single source of truth for the fidelity banner, the coding-export
 * soft-gate, and App.tsx's source-pane auto-open, so tuning it can't leave those three disagreeing
 * about the same document (codebase-audit-2026-09-19.md #7).
 */
export function shouldSoftGateCodingExport(model: LogicModel): boolean {
  // `low` hard-stops before edit; soft-gate covers proceed-with-caution partial/medium.
  return model.extractionStatus === 'partial' || model.extractionConfidence === 'medium';
}

export function shouldShowFidelityBanner(model: LogicModel): boolean {
  if (shouldHardStopExtraction(model)) return false;
  return shouldSoftGateCodingExport(model);
}

export function formatHardStopMessage(blockers: string[]): string {
  const list = normalizeBlockers(blockers);
  if (list.length === 0) {
    return 'Could not extract this document — it could not be read reliably enough.';
  }
  if (list.length === 1) {
    return `Could not extract this document. ${list[0]}`;
  }
  return `Could not extract this document. ${list[0]} (and ${list.length - 1} other reason${list.length > 2 ? 's' : ''})`;
}

