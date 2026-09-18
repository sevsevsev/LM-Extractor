import type { LogicModel } from '../types';
import { shouldShowFidelityBanner } from './extractionFidelity.js';
import { shouldSuggestMismatch } from './sourceMapping.js';

/**
 * Same "needs a second look" signal already driving the session list's NEEDS REVIEW grouping
 * (components/SessionFileList.tsx) — kept as one shared check so an export's QA flag can never
 * silently drift from what the app already showed the operator.
 */
export function needsQaReview(model: LogicModel): boolean {
  return shouldShowFidelityBanner(model) || shouldSuggestMismatch(model);
}

export function qaStatusLabel(model: LogicModel): string {
  return needsQaReview(model) ? 'Needs Review' : 'Successfully Processed';
}
