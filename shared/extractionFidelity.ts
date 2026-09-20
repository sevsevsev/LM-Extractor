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
  lowRes: 'This image is low resolution, so a lot of the wording may have been misread — check it against the original',
  highNonVerbatim: 'The AI was unsure about a lot of these items — check them against the original',
  nonVerbatimShare: 'The AI was unsure about some of these items — check them against the original',
  mismatch:
    'Some content did not fit any of the standard columns and was put under "Unmapped" — check whether it belongs somewhere',
  unknownLayout:
    'The layout of this document could not be worked out, so items may have ended up in the wrong columns',
  noContent: 'Nothing could be extracted from this document',
  lowLegibilityPartial: 'This image is low resolution, so some wording may have been misread',
  /**
   * Flattened / low-DPI dense grids (Oxford Circle–class) — do not trust fluent OCR. Caps at
   * partial/medium and never hard-stops (see the confidence block): the extraction is shown to the
   * operator with this warning attached, rather than discarded.
   */
  lowLegibilityDense:
    'This image is low resolution and the grid is dense, so small text may be misread — check every item against the original before using this',
  /** Gemini's own per-image self-report — caps at partial/medium, never forces low/abstained. */
  possiblyIncomplete:
    'The AI was not sure it captured everything on part of the page — check the document for anything missing',
  /** Gemini's document-type self-report (see DOCUMENT TYPE CHECK prompt) — never hard-stops. */
  notLogicModel: 'This may not be a logic model — check the document before relying on this extraction',
  /** Vision conversion failed entirely (not just low-res) — extracted from the text layer alone. */
  textOnlyFallback:
    'This document could not be read as images, only as text, so the columns and formatting may be wrong',
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
 * So the flag now states the consequence rather than the diagnosis. The underlying rule is clean
 * and needs no new field: when `documentTypeAssessment` is anything other than `logic_model`,
 * every domain assignment in that document is the app's categorization rather than the document's
 * own labelling. `documentTypeNote` carries the specific reason and reaches "Review Reasons" in
 * the full CSV via the fidelity blocker.
 */
export function documentTypeFlagLabel(model: LogicModel): string {
  if (model.documentTypeAssessment === 'not_logic_model')
    return 'Not a logic model — the app sorted these items into columns; the document did not label them';
  if (model.documentTypeAssessment === 'unclear')
    return 'Unclear document type — some columns may have been assigned by the app rather than read from the document';
  return '';
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

export function countExtractionItems(model: LogicModel): { total: number; nonVerbatim: number } {
  let total = 0;
  let nonVerbatim = 0;
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) {
      for (const item of group.items ?? []) {
        if (!item.text?.trim()) continue;
        total += 1;
        if (item.verbatim === false) nonVerbatim += 1;
      }
    }
  }
  return { total, nonVerbatim };
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

  const { total: N, nonVerbatim: Vf } = countExtractionItems(model);
  const ratio = N > 0 ? Vf / N : 0;
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

  if (status === 'ok') {
    if (
      (N >= 6 && ratio >= 0.15) ||
      M ||
      Uunk ||
      notLogicModel ||
      T ||
      noGridItems ||
      (L && Vf >= 1) ||
      (L && N >= 6) ||
      modelBlockers.length > 0 ||
      noContent ||
      hasMissedContentSignal
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
  } else if (L && (Vf >= 1 || status === 'partial')) {
    pushBlocker(
      blockers,
      seen,
      N >= 6 && ratio >= 0.25 ? FIDELITY_BLOCKERS.lowRes : FIDELITY_BLOCKERS.lowLegibilityPartial
    );
  }
  if (N >= 6 && ratio >= 0.4) {
    pushBlocker(blockers, seen, FIDELITY_BLOCKERS.highNonVerbatim);
  } else if ((N >= 6 && ratio >= 0.15) || (N < 6 && Vf > 0)) {
    // The N<6 arm matches the small-doc confidence bump above — without it, a small extract with a
    // non-verbatim item would drop to `medium` confidence with no stated reason in the banner.
    pushBlocker(blockers, seen, FIDELITY_BLOCKERS.nonVerbatimShare);
  }
  if (M) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.mismatch);
  if (Uunk) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.unknownLayout);
  if (notLogicModel) {
    pushBlocker(
      blockers,
      seen,
      model.documentTypeNote
        ? `${FIDELITY_BLOCKERS.notLogicModel} (${model.documentTypeNote})`
        : FIDELITY_BLOCKERS.notLogicModel
    );
  }
  if (hasMissedContentSignal) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.possiblyIncomplete);

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
  if (status === 'abstained' || noContent || (status === 'partial' && N >= 6 && ratio >= 0.4)) {
    confidence = 'low';
  } else if (
    status === 'partial' ||
    (N >= 6 && ratio >= 0.15) ||
    M ||
    Uunk ||
    L
  ) {
    confidence = 'medium';
  } else if (N < 6 && (status !== 'ok' || L || Vf > 0)) {
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

