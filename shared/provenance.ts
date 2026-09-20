import type { LogicModelItem } from '../types';

/** True when an item should be surfaced for human verification. */
export function itemNeedsReview(item: LogicModelItem): boolean {
  return item.verbatim === false || Boolean(item.sourceNote?.trim());
}
