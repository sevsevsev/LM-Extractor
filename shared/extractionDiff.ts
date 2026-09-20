import type { LogicModel, LogicModelGroup } from '../types';

/**
 * Structured diff between two extractions of the SAME document.
 *
 * This is the comparison half of the Tier-1 regression loop: run a fixed, stratified set of
 * documents under a new PROMPT_VERSION and diff each result against the committed snapshot from
 * the previous version. Because `server/geminiSeed.ts` keys the seed on document content only,
 * an unchanged prompt reproduces byte-identically — so any difference reported here is attributable
 * to the prompt change rather than to sampling noise.
 *
 * The distinction that matters for prompt tuning is **moved vs. added/removed**. A prompt change
 * that relocates an item between columns is a placement change (COLUMN FIDELITY behaviour); one
 * that makes an item appear or vanish is a recall or invention change. Reporting a move as a
 * remove plus an add would hide exactly the signal you are looking for.
 */

export interface ItemLocation {
  domain: string;
  group: string;
}

export interface MovedItem {
  text: string;
  from: ItemLocation;
  to: ItemLocation;
}

export interface PlacedItem extends ItemLocation {
  text: string;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface ExtractionDiff {
  unchanged: boolean;
  /** Document-level fields: fidelity, document type, layout, organization/program, overview prose. */
  fieldChanges: FieldChange[];
  itemsAdded: PlacedItem[];
  itemsRemoved: PlacedItem[];
  /** Same text, different domain and/or group — a placement change, not a recall change. */
  itemsMoved: MovedItem[];
  itemCountBefore: number;
  itemCountAfter: number;
}

const GROUPED_DOMAINS: { key: keyof LogicModel; label: string }[] = [
  { key: 'inputs', label: 'Inputs' },
  { key: 'activities', label: 'Activities' },
  { key: 'outputs', label: 'Outputs' },
  { key: 'shortTermOutcomes', label: 'Short-Term Outcomes' },
  { key: 'mediumTermOutcomes', label: 'Medium-Term Outcomes' },
  { key: 'longTermOutcomes', label: 'Long-Term Outcomes' },
  { key: 'generalOutcomes', label: 'General Outcomes' },
  { key: 'impact', label: 'Impact' },
  { key: 'unmapped', label: 'Unmapped' },
];

const STRING_FIELDS: { key: keyof LogicModel; label: string }[] = [
  { key: 'organization', label: 'organization' },
  { key: 'program', label: 'program' },
];

const CONTENT_FIELDS: { key: keyof LogicModel; label: string }[] = [
  { key: 'impactStatement', label: 'impactStatement' },
  { key: 'mission', label: 'mission' },
  { key: 'targetPopulation', label: 'targetPopulation' },
];

/** Compare item text the way a reviewer would — case and whitespace are not meaningful changes. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function groupsOf(model: LogicModel, key: keyof LogicModel): LogicModelGroup[] {
  const field = model[key] as { content?: LogicModelGroup[] } | undefined;
  return Array.isArray(field?.content) ? field!.content! : [];
}

/** normalized text -> every place it appears, with the original casing kept for display. */
function locationIndex(model: LogicModel): Map<string, { display: string; places: ItemLocation[] }> {
  const index = new Map<string, { display: string; places: ItemLocation[] }>();
  for (const { key, label } of GROUPED_DOMAINS) {
    for (const group of groupsOf(model, key)) {
      for (const item of group.items ?? []) {
        const text = item.text?.trim();
        if (!text) continue;
        const norm = normalizeText(text);
        const entry = index.get(norm) ?? { display: text, places: [] };
        entry.places.push({ domain: label, group: group.name || 'General' });
        index.set(norm, entry);
      }
    }
  }
  return index;
}

function sameLocation(a: ItemLocation, b: ItemLocation): boolean {
  return a.domain === b.domain && a.group === b.group;
}

/** Pair up before/after locations for one text, leaving genuinely new/lost placements unpaired. */
function pairLocations(
  before: ItemLocation[],
  after: ItemLocation[]
): { moved: [ItemLocation, ItemLocation][]; onlyBefore: ItemLocation[]; onlyAfter: ItemLocation[] } {
  const remainingBefore = [...before];
  const remainingAfter = [...after];

  // Exact matches first — an item that did not move must never be reported as one.
  for (let i = remainingBefore.length - 1; i >= 0; i--) {
    const j = remainingAfter.findIndex(loc => sameLocation(loc, remainingBefore[i]));
    if (j >= 0) {
      remainingBefore.splice(i, 1);
      remainingAfter.splice(j, 1);
    }
  }

  const moved: [ItemLocation, ItemLocation][] = [];
  while (remainingBefore.length > 0 && remainingAfter.length > 0) {
    moved.push([remainingBefore.shift()!, remainingAfter.shift()!]);
  }
  return { moved, onlyBefore: remainingBefore, onlyAfter: remainingAfter };
}

function stringValue(model: LogicModel, key: keyof LogicModel): string {
  const v = model[key];
  return typeof v === 'string' ? v.trim() : '';
}

function contentValue(model: LogicModel, key: keyof LogicModel): string {
  const field = model[key] as { content?: string } | undefined;
  return typeof field?.content === 'string' ? field.content.trim() : '';
}

function countItems(index: Map<string, { places: ItemLocation[] }>): number {
  let n = 0;
  for (const entry of index.values()) n += entry.places.length;
  return n;
}

export function diffExtractions(before: LogicModel, after: LogicModel): ExtractionDiff {
  const fieldChanges: FieldChange[] = [];
  const push = (field: string, b: string, a: string) => {
    if (b !== a) fieldChanges.push({ field, before: b, after: a });
  };

  for (const { key, label } of STRING_FIELDS) {
    push(label, stringValue(before, key), stringValue(after, key));
  }
  for (const { key, label } of CONTENT_FIELDS) {
    push(label, contentValue(before, key), contentValue(after, key));
  }
  push('extractionStatus', before.extractionStatus ?? '', after.extractionStatus ?? '');
  push('extractionConfidence', before.extractionConfidence ?? '', after.extractionConfidence ?? '');
  push('layoutFamily', before.layoutFamily ?? '', after.layoutFamily ?? '');
  push('documentTypeAssessment', before.documentTypeAssessment ?? '', after.documentTypeAssessment ?? '');
  push('colorLegend', (before.colorLegend ?? '').trim(), (after.colorLegend ?? '').trim());
  push(
    'extractionBlockers',
    (before.extractionBlockers ?? []).join(' | '),
    (after.extractionBlockers ?? []).join(' | ')
  );
  push(
    'possiblyMissedRegions',
    String((before.possiblyMissedRegions ?? []).length),
    String((after.possiblyMissedRegions ?? []).length)
  );

  const beforeIndex = locationIndex(before);
  const afterIndex = locationIndex(after);

  const itemsAdded: PlacedItem[] = [];
  const itemsRemoved: PlacedItem[] = [];
  const itemsMoved: MovedItem[] = [];

  for (const [norm, entry] of beforeIndex) {
    const afterEntry = afterIndex.get(norm);
    if (!afterEntry) {
      for (const place of entry.places) itemsRemoved.push({ text: entry.display, ...place });
      continue;
    }
    const { moved, onlyBefore, onlyAfter } = pairLocations(entry.places, afterEntry.places);
    for (const [from, to] of moved) itemsMoved.push({ text: entry.display, from, to });
    for (const place of onlyBefore) itemsRemoved.push({ text: entry.display, ...place });
    for (const place of onlyAfter) itemsAdded.push({ text: afterEntry.display, ...place });
  }
  for (const [norm, entry] of afterIndex) {
    if (beforeIndex.has(norm)) continue;
    for (const place of entry.places) itemsAdded.push({ text: entry.display, ...place });
  }

  return {
    unchanged:
      fieldChanges.length === 0 &&
      itemsAdded.length === 0 &&
      itemsRemoved.length === 0 &&
      itemsMoved.length === 0,
    fieldChanges,
    itemsAdded,
    itemsRemoved,
    itemsMoved,
    itemCountBefore: countItems(beforeIndex),
    itemCountAfter: countItems(afterIndex),
  };
}

function truncate(text: string, max = 90): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Human-readable summary for the regression runner's console output. */
export function formatExtractionDiff(name: string, diff: ExtractionDiff): string {
  if (diff.unchanged) return `  = ${name} (${diff.itemCountAfter} items, unchanged)`;

  const lines: string[] = [
    `  ~ ${name} (${diff.itemCountBefore} -> ${diff.itemCountAfter} items)`,
  ];
  for (const c of diff.fieldChanges) {
    lines.push(`      field ${c.field}: ${truncate(c.before || '(empty)', 50)} -> ${truncate(c.after || '(empty)', 50)}`);
  }
  for (const m of diff.itemsMoved) {
    lines.push(
      `      moved  ${m.from.domain}/${m.from.group} -> ${m.to.domain}/${m.to.group}: ${truncate(m.text)}`
    );
  }
  for (const i of diff.itemsRemoved) {
    lines.push(`      -      ${i.domain}/${i.group}: ${truncate(i.text)}`);
  }
  for (const i of diff.itemsAdded) {
    lines.push(`      +      ${i.domain}/${i.group}: ${truncate(i.text)}`);
  }
  return lines.join('\n');
}
