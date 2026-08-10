import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import { reconcileExtractionFidelityFields } from './extractionFidelity.js';

/** Provenance / colour / source-location fields carried on each item independent of critique. */
export interface ItemProvenance {
  verbatim?: boolean;
  sourceNote?: string;
  fillColor?: string;
  borderColor?: string;
  sourcePage?: number;
  sourceColumn?: number;
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

function normText(s: string): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function pickProvenance(item: LogicModelItem): ItemProvenance {
  const p: ItemProvenance = {};
  if (typeof item.verbatim === 'boolean') p.verbatim = item.verbatim;
  if (item.sourceNote?.trim()) p.sourceNote = item.sourceNote;
  if (item.fillColor?.trim()) p.fillColor = item.fillColor;
  if (item.borderColor?.trim()) p.borderColor = item.borderColor;
  if (typeof item.sourcePage === 'number' && item.sourcePage >= 1) p.sourcePage = item.sourcePage;
  if (typeof item.sourceColumn === 'number' && item.sourceColumn >= 1) {
    p.sourceColumn = item.sourceColumn;
  }
  return p;
}

function hasAnyProvenance(p: ItemProvenance): boolean {
  return (
    typeof p.verbatim === 'boolean' ||
    Boolean(p.sourceNote) ||
    Boolean(p.fillColor) ||
    Boolean(p.borderColor) ||
    typeof p.sourcePage === 'number' ||
    typeof p.sourceColumn === 'number'
  );
}

function forEachGroup(model: LogicModel, fn: (group: LogicModelGroup) => void): void {
  for (const domain of GROUPED_DOMAINS) {
    const field = model[domain] as { content?: LogicModelGroup[] } | undefined;
    for (const group of field?.content ?? []) fn(group);
  }
}

/**
 * Copy provenance/colour fields from `source` onto `target` when the target lost them.
 * The critique model must not reword or move items, so we match on normalized item text.
 * Mutates and returns `target`.
 */
export function reconcileProvenance(target: LogicModel, source: LogicModel): LogicModel {
  const byText = new Map<string, ItemProvenance>();
  forEachGroup(source, group => {
    for (const item of group.items) {
      const p = pickProvenance(item);
      if (hasAnyProvenance(p)) byText.set(normText(item.text), p);
    }
  });

  // Model-level colour legend is also easily dropped by critique — restore it.
  if (!target.colorLegend?.trim() && source.colorLegend?.trim()) {
    target.colorLegend = source.colorLegend;
  }

  reconcileExtractionFidelityFields(target, source);

  if (byText.size === 0) return target;

  forEachGroup(target, group => {
    for (const item of group.items) {
      const p = byText.get(normText(item.text));
      if (!p) continue;
      if (typeof item.verbatim !== 'boolean' && typeof p.verbatim === 'boolean') {
        item.verbatim = p.verbatim;
      }
      if (!item.sourceNote?.trim() && p.sourceNote) item.sourceNote = p.sourceNote;
      if (!item.fillColor?.trim() && p.fillColor) item.fillColor = p.fillColor;
      if (!item.borderColor?.trim() && p.borderColor) item.borderColor = p.borderColor;
      if (typeof item.sourcePage !== 'number' && typeof p.sourcePage === 'number') {
        item.sourcePage = p.sourcePage;
      }
      if (typeof item.sourceColumn !== 'number' && typeof p.sourceColumn === 'number') {
        item.sourceColumn = p.sourceColumn;
      }
    }
  });

  return target;
}

/** True when an item should be surfaced for human verification. */
export function itemNeedsReview(item: LogicModelItem): boolean {
  return item.verbatim === false || Boolean(item.sourceNote?.trim());
}
