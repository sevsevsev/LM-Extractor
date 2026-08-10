import type {
  ExtractionConfidence,
  ExtractionFidelity,
  ExtractionStatus,
  LogicModel,
  LogicModelGroup,
} from '../types';
import { stringDomainHasContent, groupedDomainHasContent } from './domainPresence.js';
import { shouldSuggestMismatch } from './sourceMapping.js';

const STATUSES: readonly ExtractionStatus[] = ['ok', 'partial', 'abstained'];
const CONFIDENCES: readonly ExtractionConfidence[] = ['high', 'medium', 'low'];

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
} as const;

export function isExtractionStatus(value: unknown): value is ExtractionStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export function isExtractionConfidence(value: unknown): value is ExtractionConfidence {
  return typeof value === 'string' && (CONFIDENCES as readonly string[]).includes(value);
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
  const M = shouldSuggestMismatch(model);
  const Uunk = model.layoutFamily === 'unknown';
  const noContent = !hasRecoveredLogicModelContent(model);

  if (status === 'ok') {
    if (
      (N >= 6 && ratio >= 0.15) ||
      M ||
      Uunk ||
      (L && Vf >= 1) ||
      (L && N >= 6) ||
      modelBlockers.length > 0 ||
      noContent
    ) {
      status = upgradeStatus(status, 'partial');
    }
  }

  // partial stays partial (never downgrade to ok)

  const blockers: string[] = [];
  const seen = new Set<string>();
  for (const b of modelBlockers) pushBlocker(blockers, seen, b);

  if (noContent) pushBlocker(blockers, seen, FIDELITY_BLOCKERS.noContent);
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

/** Restore document-level fidelity fields if critique dropped them. */
export function reconcileExtractionFidelityFields(
  target: LogicModel,
  source: LogicModel
): LogicModel {
  if (!target.extractionStatus && source.extractionStatus) {
    target.extractionStatus = source.extractionStatus;
  }
  if (!target.extractionConfidence && source.extractionConfidence) {
    target.extractionConfidence = source.extractionConfidence;
  }
  if (
    (!target.extractionBlockers || target.extractionBlockers.length === 0) &&
    source.extractionBlockers?.length
  ) {
    target.extractionBlockers = [...source.extractionBlockers];
  }
  // Prefer source severity if critique softened status (should not happen, but guard).
  if (
    isExtractionStatus(source.extractionStatus) &&
    isExtractionStatus(target.extractionStatus) &&
    STATUS_RANK[source.extractionStatus] > STATUS_RANK[target.extractionStatus]
  ) {
    target.extractionStatus = source.extractionStatus;
  }
  if (
    isExtractionConfidence(source.extractionConfidence) &&
    isExtractionConfidence(target.extractionConfidence)
  ) {
    const confRank: Record<ExtractionConfidence, number> = { high: 0, medium: 1, low: 2 };
    if (confRank[source.extractionConfidence] > confRank[target.extractionConfidence]) {
      target.extractionConfidence = source.extractionConfidence;
    }
  }
  return target;
}
