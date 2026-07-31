import type {
  LogicModel,
  LogicModelGroup,
  LogicModelItem,
  MappingCorrectionEvent,
  LayoutFamily,
} from '../types';
import {
  synonymToDomain,
  isKnownInputSubBucket,
  type CanonicalGroupedDomain,
  normalizeHeader,
} from './domainSynonyms.js';

const GROUPED_FIELDS: CanonicalGroupedDomain[] = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
  'impact',
];

function getGroups(field: { content: LogicModelGroup[] } | undefined): LogicModelGroup[] {
  return field?.content ?? [];
}

function ensureUnmapped(model: LogicModel): void {
  if (!model.unmapped) model.unmapped = { content: [] };
  if (!Array.isArray(model.unmapped.content)) model.unmapped.content = [];
}

function cloneItem(item: LogicModelItem): LogicModelItem {
  return { ...item };
}

function annotateItem(
  item: LogicModelItem,
  opts: {
    sourceHeader?: string;
    mappedBy?: LogicModelItem['mappedBy'];
    mappingConfidence?: LogicModelItem['mappingConfidence'];
  }
): LogicModelItem {
  const next = cloneItem(item);
  if (opts.sourceHeader?.trim() && !next.sourceHeader?.trim()) {
    next.sourceHeader = opts.sourceHeader.trim();
    next.sourceSection = next.sourceSection?.trim() || opts.sourceHeader.trim();
  }
  if (opts.mappedBy) next.mappedBy = opts.mappedBy;
  if (opts.mappingConfidence) next.mappingConfidence = opts.mappingConfidence;
  return next;
}

function findOrCreateGroup(groups: LogicModelGroup[], name: string): LogicModelGroup {
  let g = groups.find(x => x.name === name);
  if (!g) {
    g = { name, items: [] };
    groups.push(g);
  }
  return g;
}

function pushItem(groups: LogicModelGroup[], groupName: string, item: LogicModelItem): void {
  const g = findOrCreateGroup(groups, groupName);
  const key = item.text.trim().toLowerCase();
  if (!g.items.some(i => i.text.trim().toLowerCase() === key)) {
    g.items.push(item);
  }
}

/**
 * Post-extract: annotate mapping metadata; synonym-remap when a group header
 * clearly belongs to another domain; leave track/custom group names in place
 * (spatial trust). Does not invent content.
 */
export function applySourceAwareMapping(model: LogicModel): LogicModel {
  ensureUnmapped(model);
  if (!model.layoutFamily) model.layoutFamily = 'vertical_columns';
  if (!model.mappingCorrections) model.mappingCorrections = [];

  for (const domain of GROUPED_FIELDS) {
    const field = model[domain];
    const groups = getGroups(field);
    const kept: LogicModelGroup[] = [];

    for (const group of groups) {
      const header = (group.name || 'General').trim() || 'General';
      const synonym = synonymToDomain(header);
      const remaining: LogicModelItem[] = [];

      for (const raw of group.items) {
        if (!raw.text?.trim()) {
          remaining.push(raw);
          continue;
        }

        // Synonym says this header belongs elsewhere → evidence-based move.
        if (synonym && synonym !== domain) {
          const moved = annotateItem(raw, {
            sourceHeader: header,
            mappedBy: 'auto',
            mappingConfidence: 'synonym',
          });
          pushItem(getGroups(model[synonym]), 'General', moved);
          continue;
        }

        if (synonym && synonym === domain) {
          remaining.push(
            annotateItem(raw, {
              sourceHeader: header,
              mappedBy: raw.mappedBy ?? 'auto',
              mappingConfidence: raw.mappingConfidence ?? 'synonym',
            })
          );
          continue;
        }

        // Known Resources sub-buckets under Inputs.
        if (domain === 'inputs' && isKnownInputSubBucket(header)) {
          remaining.push(
            annotateItem(raw, {
              sourceHeader: header,
              mappedBy: raw.mappedBy ?? 'auto',
              mappingConfidence: raw.mappingConfidence ?? 'subbucket',
            })
          );
          continue;
        }

        // General or custom track/group label: trust spatial column placement.
        remaining.push(
          annotateItem(raw, {
            sourceHeader: header === 'General' ? undefined : header,
            mappedBy: raw.mappedBy ?? 'auto',
            mappingConfidence: raw.mappingConfidence ?? 'spatial',
          })
        );
      }

      if (remaining.length > 0) {
        kept.push({ name: header, items: remaining });
      }
    }

    field.content = kept;
  }

  // Annotate existing unmapped items.
  for (const g of getGroups(model.unmapped)) {
    g.items = g.items.map(item =>
      annotateItem(item, {
        sourceHeader: g.name,
        mappedBy: item.mappedBy ?? undefined,
        mappingConfidence: item.mappingConfidence ?? 'unmapped',
      })
    );
  }

  return model;
}

export function countMappedItems(model: LogicModel): { total: number; unmapped: number } {
  let total = 0;
  let unmapped = 0;
  for (const domain of GROUPED_FIELDS) {
    for (const g of getGroups(model[domain])) {
      for (const item of g.items) {
        if (item.text?.trim()) total += 1;
      }
    }
  }
  for (const g of getGroups(model.unmapped)) {
    for (const item of g.items) {
      if (item.text?.trim()) {
        total += 1;
        unmapped += 1;
      }
    }
  }
  return { total, unmapped };
}

export function countSourceSections(model: LogicModel): { source: number; mapped: number } {
  const labels = new Set<string>();
  const mappedLabels = new Set<string>();

  for (const domain of GROUPED_FIELDS) {
    for (const g of getGroups(model[domain])) {
      const h = normalizeHeader(g.name || '');
      if (!h || h === 'general') continue;
      labels.add(h);
      if (synonymToDomain(g.name) || (domain === 'inputs' && isKnownInputSubBucket(g.name))) {
        mappedLabels.add(h);
      }
    }
  }
  for (const g of getGroups(model.unmapped)) {
    const h = normalizeHeader(g.name || '');
    if (h && h !== 'general') labels.add(h);
  }

  return { source: labels.size, mapped: mappedLabels.size };
}

/** PRD mismatch thresholds — see source-aware-mapping-v1.md */
export function shouldSuggestMismatch(model: LogicModel): boolean {
  const { total: N, unmapped: U } = countMappedItems(model);
  if (N < 6) return false;

  const { source: Ssrc, mapped: Smapped } = countSourceSections(model);
  if (N >= 8 && U / N >= 0.3) return true;
  if (U >= 5 && Ssrc - Smapped >= 2) return true;

  const family: LayoutFamily = model.layoutFamily ?? 'vertical_columns';
  const nonGrid =
    family === 'horizontal_rows' ||
    family === 'diagram' ||
    family === 'prose_sections' ||
    family === 'unknown';
  if (nonGrid && N >= 6 && U / N >= 0.15) return true;

  return false;
}

export function makeItemKey(sourceHeader: string | undefined, text: string, index: number): string {
  const h = (sourceHeader || '').slice(0, 40);
  const t = text.trim().slice(0, 60);
  return `${h}|${t}|${index}`;
}

export function appendCorrection(
  model: LogicModel,
  event: Omit<MappingCorrectionEvent, 'at'> & { at?: string }
): LogicModel {
  const mappingCorrections = [
    ...(model.mappingCorrections ?? []),
    { ...event, at: event.at ?? new Date().toISOString() },
  ];
  return { ...model, mappingCorrections };
}

/**
 * Move one item between grouped domains / unmapped. Returns updated model (immutable-ish clone of structure).
 */
export function reassignItemDomain(
  model: LogicModel,
  args: {
    fromDomain: CanonicalGroupedDomain | 'unmapped';
    fromGroupIndex: number;
    itemIndex: number;
    toDomain: CanonicalGroupedDomain | 'unmapped';
    note?: string;
  }
): { model: LogicModel; event: MappingCorrectionEvent | null } {
  const next = structuredClone(model);
  ensureUnmapped(next);

  const fromField = args.fromDomain === 'unmapped' ? next.unmapped! : next[args.fromDomain];
  const fromGroups = getGroups(fromField);
  const group = fromGroups[args.fromGroupIndex];
  if (!group) return { model, event: null };
  const item = group.items[args.itemIndex];
  if (!item) return { model, event: null };

  const fromDomainLabel = args.fromDomain === 'unmapped' ? null : args.fromDomain;
  const toDomainLabel = args.toDomain === 'unmapped' ? null : args.toDomain;

  const moved = cloneItem(item);
  moved.mappedBy = 'user';
  moved.mappingConfidence = 'user';
  if (args.note?.trim()) moved.mappingNote = args.note.trim();
  if (!moved.sourceHeader?.trim() && group.name && group.name !== 'General') {
    moved.sourceHeader = group.name;
    moved.sourceSection = moved.sourceSection || group.name;
  }

  fromField.content = fromGroups
    .map((g, gi) =>
      gi === args.fromGroupIndex
        ? { ...g, items: g.items.filter((_, j) => j !== args.itemIndex) }
        : g
    )
    .filter(g => g.items.length > 0);

  if (args.toDomain === 'unmapped') {
    const header = moved.sourceHeader?.trim() || group.name || 'Unmapped';
    pushItem(getGroups(next.unmapped), header, moved);
  } else {
    pushItem(getGroups(next[args.toDomain]), 'General', moved);
  }

  const action =
    args.fromDomain === 'unmapped' && args.toDomain !== 'unmapped'
      ? 'assign_domain'
      : args.toDomain === 'unmapped'
        ? 'return_unmapped'
        : 'remap_domain';

  const event: MappingCorrectionEvent = {
    at: new Date().toISOString(),
    fileId: '',
    action,
    itemKey: makeItemKey(moved.sourceHeader, moved.text, args.itemIndex),
    itemText: moved.text,
    fromDomain: fromDomainLabel,
    toDomain: toDomainLabel,
    sourceSection: moved.sourceSection,
    sourceHeader: moved.sourceHeader,
    note: args.note?.trim() || undefined,
    autoSuggestedDomain: synonymToDomain(moved.sourceHeader || group.name) ?? null,
    layoutFamily: next.layoutFamily,
  };

  next.mappingCorrections = [...(next.mappingCorrections ?? []), event];
  return { model: next, event };
}
