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
import { estimateCompleteness } from './completenessCheck.js';

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
export const FIDELITY_BLOCKERS = {
  abstained: 'Model abstained from extraction',
  lowRes: 'Low-resolution source — many items need verification',
  highNonVerbatim: 'Share of items flagged non-verbatim is high',
  nonVerbatimShare: 'Some items flagged non-verbatim — verify against source',
  mismatch: 'Layout/label mismatch — review unmapped items',
  unknownLayout: 'Layout family unknown',
  noContent: 'No logic-model content recovered',
  lowLegibilityPartial: 'Low-resolution source with uncertain transcriptions',
  /** Flattened / low-DPI dense grids (Oxford Circle–class) — do not trust fluent OCR. */
  lowLegibilityDense:
    'Low-resolution dense grid — transcription is not reliable enough to continue',
  /** Unvalidated proxy (see completenessCheck.ts) — caps at partial/medium, never forces low/abstained. */
  possiblyIncomplete:
    'Source text suggests more items may be present than were extracted — spot-check for missed content',
  /** Gemini's document-type self-report (see DOCUMENT TYPE CHECK prompt) — never hard-stops. */
  notLogicModel: 'Document may not be a logic model — verify before treating extraction as reliable',
  /** Vision conversion failed entirely (not just low-res) — extracted from the text layer alone. */
  textOnlyFallback:
    'Extracted from text only — the document could not be read as images, so layout-based columns and formatting may be less reliable',
  /** Overview text (mission/target/impact) was recovered but the grid itself came back empty. */
  noGridItems:
    'No inputs/activities/outputs/outcomes items were extracted — verify this document actually has a logic-model grid',
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
export function documentTypeFlagLabel(model: LogicModel): string {
  if (model.documentTypeAssessment === 'not_logic_model') return 'Possibly Not a Logic Model';
  if (model.documentTypeAssessment === 'unclear') return 'Unclear Document Type';
  return '';
}

export function getExtractionFidelity(model: LogicModel): ExtractionFidelity | undefined {
  if (!isExtractionStatus(model.extractionStatus)) return undefined;
  const confidence = isExtractionConfidence(model.extractionConfidence)
    ? model.extractionConfidence
    : 'medium';
  const blockers = normalizeBlockers(model.extractionBlockers);
  return { status: model.extractionStatus, confidence, blockers };
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

/** Bucket extracted items by `sourcePage` — items without a known page contribute nothing. */
export function countItemsByPage(model: LogicModel): Map<number, number> {
  const counts = new Map<number, number>();
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) {
      for (const item of group.items ?? []) {
        if (!item.text?.trim()) continue;
        if (typeof item.sourcePage !== 'number') continue;
        counts.set(item.sourcePage, (counts.get(item.sourcePage) ?? 0) + 1);
      }
    }
  }
  return counts;
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
  /** Track A text (PDF/DOCX/PPTX text layer) — drives the completeness proxy below. */
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
  // Unvalidated heuristic (see completenessCheck.ts) — deliberately excluded from every `low`/
  // `abstained` condition below; it can only ever push ok -> partial, same ceiling as mismatch/
  // unknown-layout, until it's been checked against real documents.
  const completeness = estimateCompleteness(options?.sourceText, N, countItemsByPage(model));
  const possiblyIncomplete = completeness.possiblyIncomplete;
  // Gemini's own per-image self-report (see server/geminiLogicModel.ts) — same trust ceiling as
  // possiblyIncomplete (can only push ok -> partial), but a distinct signal: it can fire even when
  // the text-count heuristic above doesn't (or vice versa), so both feed the same blocker/upgrade.
  const geminiMissedRegions = normalizePossiblyMissedRegions(model.possiblyMissedRegions);
  const hasMissedContentSignal = possiblyIncomplete || geminiMissedRegions.length > 0;

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
  // Dense low-legibility grids (e.g. Oxford Circle) — force stop even if the model under-flags verbatim.
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
  } else if (N >= 6 && ratio >= 0.15) {
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
  if (
    status === 'abstained' ||
    (L && N >= 6) ||
    (status === 'partial' && (L || (N >= 6 && ratio >= 0.4))) ||
    (L && N >= 6 && ratio >= 0.25) ||
    noContent
  ) {
    confidence = 'low';
  } else if (
    status === 'partial' ||
    (N >= 6 && ratio >= 0.15) ||
    M ||
    Uunk ||
    (L && Vf >= 1)
  ) {
    confidence = 'medium';
  } else if (N < 6 && (status !== 'ok' || L)) {
    confidence = 'medium';
  } else {
    confidence = 'high';
  }

  // Small docs: high only when ok and not L (already handled); if ok, not L, N<6 → high
  if (N < 6 && status === 'ok' && !L && !M && !Uunk && Vf === 0) {
    confidence = 'high';
  }

  // Merge Gemini's per-image self-report with the text-heuristic's page-level pointer — Gemini
  // entries (which may carry a column) win for a page it already covered; the heuristic only adds
  // pages Gemini didn't already flag.
  const mergedRegions: PossiblyMissedRegion[] = [...geminiMissedRegions];
  if (completeness.suspectPages) {
    const coveredPages = new Set(geminiMissedRegions.map(r => r.page));
    for (const page of completeness.suspectPages) {
      if (coveredPages.has(page)) continue;
      coveredPages.add(page);
      mergedRegions.push({ page, note: FIDELITY_BLOCKERS.possiblyIncomplete });
    }
  }
  model.possiblyMissedRegions = mergedRegions.length
    ? mergedRegions.slice(0, MAX_MISSED_REGIONS)
    : undefined;

  return applyExtractionFidelity(model, { status, confidence, blockers });
}

/** Stop pipeline (no critique / editor) when capture is not trustworthy enough. */
export function shouldHardStopExtraction(model: LogicModel): boolean {
  return model.extractionStatus === 'abstained' || model.extractionConfidence === 'low';
}

export function shouldSoftGateCodingExport(model: LogicModel): boolean {
  // `low` hard-stops before edit; soft-gate covers proceed-with-caution partial/medium.
  return model.extractionStatus === 'partial' || model.extractionConfidence === 'medium';
}

export function shouldShowFidelityBanner(model: LogicModel): boolean {
  if (shouldHardStopExtraction(model)) return false;
  const status = model.extractionStatus;
  const confidence = model.extractionConfidence;
  if (status === 'partial') return true;
  if (confidence === 'medium') return true;
  return false;
}

export function formatHardStopMessage(blockers: string[]): string {
  const list = normalizeBlockers(blockers);
  if (list.length === 0) {
    return 'Extraction stopped — the source could not be read reliably enough to continue.';
  }
  if (list.length === 1) {
    return `Extraction stopped: ${list[0]}`;
  }
  return `Extraction stopped: ${list[0]} (${list.length - 1} more reason${list.length > 2 ? 's' : ''})`;
}

/** @deprecated Prefer formatHardStopMessage — kept for callers that only handle abstain. */
export function formatAbstainMessage(blockers: string[]): string {
  return formatHardStopMessage(blockers);
}

