import React, { useEffect, useMemo, useState } from 'react';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import { groupedDomainHasContent } from '../shared/domainPresence';
import {
  analyzeColorAxis,
  colorAxisNotes,
  itemMatchesColorFilter,
} from '../shared/colorAxis';
import { itemNeedsReview } from '../shared/provenance';
import { domainFieldLabel, type CanonicalGroupedDomain } from '../shared/domainSynonyms';
import { ColorSwatch, DomainAssignControls, swatchColor } from './itemChrome';

export type BoardItemRef = {
  domain: CanonicalGroupedDomain | 'unmapped';
  groupIndex: number;
  itemIndex: number;
};

// Titles derive from `domainFieldLabel` — the same canonical label the reassign dropdown and both
// CSV exports use — rather than a fourth, independent set of column-header strings. Previously
// hardcoded as "Short-term"/"Medium-term"/"Long-term" (no "Outcomes" suffix, lowercase second word),
// which disagreed with "Short-Term Outcomes" everywhere else, including this same board's own
// reassign dropdown rendered right next to it — found via codebase audit
// (docs/specs/codebase-audit-2026-09-19.md #25).
const CORE_COLUMN_KEYS: CanonicalGroupedDomain[] = [
  'inputs',
  'activities',
  'outputs',
  'shortTermOutcomes',
  'mediumTermOutcomes',
  'longTermOutcomes',
];
const CORE_COLUMNS: { key: CanonicalGroupedDomain; title: string }[] = CORE_COLUMN_KEYS.map(key => ({
  key,
  title: domainFieldLabel(key),
}));

const itemRefKey = (ref: BoardItemRef) => `${ref.domain}:${ref.groupIndex}:${ref.itemIndex}`;

const groupsFor = (model: LogicModel, domain: CanonicalGroupedDomain | 'unmapped'): LogicModelGroup[] => {
  if (domain === 'unmapped') return model.unmapped?.content ?? [];
  // generalOutcomes is optional (most models never set it); the rest are always present.
  return model[domain]?.content ?? [];
};

export function getBoardItem(model: LogicModel, ref: BoardItemRef): LogicModelItem | null {
  const group = groupsFor(model, ref.domain)[ref.groupIndex];
  return group?.items[ref.itemIndex] ?? null;
}

export function findBoardItemByText(
  model: LogicModel,
  text: string,
  preferDomain?: CanonicalGroupedDomain | 'unmapped'
): BoardItemRef | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  const domains: Array<CanonicalGroupedDomain | 'unmapped'> = [
    ...(preferDomain ? [preferDomain] : []),
    ...CORE_COLUMNS.map(c => c.key),
    'impact',
    'unmapped',
  ];
  const seen = new Set<string>();
  for (const domain of domains) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    const groups = groupsFor(model, domain);
    for (let gi = 0; gi < groups.length; gi++) {
      const items = groups[gi].items;
      for (let ii = 0; ii < items.length; ii++) {
        if (items[ii].text.trim().toLowerCase() === needle) {
          return { domain, groupIndex: gi, itemIndex: ii };
        }
      }
    }
  }
  return null;
}

interface LogicModelBoardProps {
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
  onFocusSource?: (
    anchor: {
      sourcePage?: number;
      sourceColumn?: number;
      needsReview?: boolean;
    },
    options?: { open?: boolean }
  ) => void;
}

const LogicModelBoard: React.FC<LogicModelBoardProps> = ({ model, onUpdate, onFocusSource }) => {
  const [selected, setSelected] = useState<BoardItemRef | null>(null);
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const showImpact = groupedDomainHasContent(model.impact.content);
  const showGeneralOutcomes = groupedDomainHasContent(model.generalOutcomes?.content);
  const showUnmapped = groupedDomainHasContent(model.unmapped?.content);
  const columnCount = 6 + (showGeneralOutcomes ? 1 : 0) + (showImpact ? 1 : 0);
  const colorAxis = useMemo(() => analyzeColorAxis(model), [model]);
  const colorNotes = useMemo(() => colorAxisNotes(colorAxis), [colorAxis]);
  const showColorMeta = colorAxis.kind === 'cross_cutting';

  useEffect(() => {
    if (!showColorMeta) setColorFilter(null);
  }, [showColorMeta]);

  const selectedItem = selected ? getBoardItem(model, selected) : null;

  useEffect(() => {
    if (!selected) return;
    if (getBoardItem(model, selected)) return;
    setSelected(null);
  }, [model, selected]);

  const handleSelect = (ref: BoardItemRef) => {
    setSelected(ref);
    const item = getBoardItem(model, ref);
    if (!item) return;
    onFocusSource?.({
      sourcePage: item.sourcePage,
      sourceColumn: item.sourceColumn,
      needsReview: itemNeedsReview(item),
    });
  };

  const handleItemTextChange = (ref: BoardItemRef, newText: string) => {
    const groups = groupsFor(model, ref.domain);
    const field =
      ref.domain === 'unmapped'
        ? (model.unmapped ?? { content: [] })
        : (model[ref.domain] ?? { content: [] });
    const newGroups = groups.map((group, i) => {
      if (i !== ref.groupIndex) return group;
      return {
        ...group,
        items: group.items.map((item, j) => (j === ref.itemIndex ? { ...item, text: newText } : item)),
      };
    });
    if (ref.domain === 'unmapped') {
      onUpdate({ ...model, unmapped: { ...field, content: newGroups } });
    } else {
      onUpdate({ ...model, [ref.domain]: { ...field, content: newGroups } });
    }
  };

  const markItemReviewed = (ref: BoardItemRef) => {
    const groups = groupsFor(model, ref.domain);
    const field =
      ref.domain === 'unmapped'
        ? (model.unmapped ?? { content: [] })
        : (model[ref.domain] ?? { content: [] });
    const newGroups = groups.map((group, i) => {
      if (i !== ref.groupIndex) return group;
      return {
        ...group,
        items: group.items.map((item, j) => {
          if (j !== ref.itemIndex) return item;
          const { sourceNote: _drop, ...rest } = item;
          return { ...rest, verbatim: true };
        }),
      };
    });
    if (ref.domain === 'unmapped') {
      onUpdate({ ...model, unmapped: { ...field, content: newGroups } });
    } else {
      onUpdate({ ...model, [ref.domain]: { ...field, content: newGroups } });
    }
  };

  const handleBoardUpdate = (next: LogicModel) => {
    const previous = selected && selectedItem ? selectedItem.text : '';
    onUpdate(next);
    if (!selected || !previous.trim()) return;
    if (getBoardItem(next, selected)) return;
    const found = findBoardItemByText(next, previous);
    setSelected(found);
  };

  const columns = useMemo(
    () => [
      ...CORE_COLUMNS,
      ...(showGeneralOutcomes
        ? [{ key: 'generalOutcomes' as const, title: 'General Outcomes' }]
        : []),
      ...(showImpact ? [{ key: 'impact' as const, title: 'Impact' }] : []),
    ],
    [showGeneralOutcomes, showImpact]
  );

  return (
    <div className="mb-8 space-y-3 min-w-0 max-w-full">
      {!selected && (
        <p className="text-sm text-slate-600">Click an item to edit wording or move it to another column.</p>
      )}
      {colorNotes.map(note => (
        <p
          key={note}
          className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"
          role="status"
        >
          {note}
        </p>
      ))}
      {showColorMeta && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by box colour">
          <button
            type="button"
            onClick={() => setColorFilter(null)}
            className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
              colorFilter === null
                ? 'bg-brand-navy text-white border-brand-navy'
                : 'bg-white text-brand-navy border-gray-200 hover:border-brand-blue'
            }`}
            aria-pressed={colorFilter === null}
          >
            All colours
          </button>
          {colorAxis.colors.map(color => {
            const css = swatchColor(color);
            const active = colorFilter === color;
            return (
              <button
                key={color}
                type="button"
                onClick={() => setColorFilter(active ? null : color)}
                className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${
                  active
                    ? 'bg-brand-sky/25 text-brand-navy border-brand-blue'
                    : 'bg-white text-brand-navy border-gray-200 hover:border-brand-blue'
                }`}
                aria-pressed={active}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm border border-slate-300"
                  style={css ? { backgroundColor: css } : undefined}
                  aria-hidden="true"
                />
                {color}
              </button>
            );
          })}
        </div>
      )}
      {showUnmapped && (
        <section
          id="unmapped-section"
          className="rounded-lg border border-brand-accent/50 bg-brand-sky/15 p-3"
          aria-label="Unmapped items"
        >
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-navy mb-2">
            Unmapped — assign a column
          </h4>
          <div className="flex flex-wrap gap-2">
            {groupsFor(model, 'unmapped').map((group, gi) =>
              group.items.map((item, ii) => (
                <BoardItemCard
                  key={`${gi}-${ii}`}
                  item={item}
                  groupName={group.name}
                  selected={
                    selected?.domain === 'unmapped' &&
                    selected.groupIndex === gi &&
                    selected.itemIndex === ii
                  }
                  showColorMeta={showColorMeta}
                  dimmed={!itemMatchesColorFilter(item, colorFilter)}
                  onSelect={() => handleSelect({ domain: 'unmapped', groupIndex: gi, itemIndex: ii })}
                />
              ))
            )}
          </div>
        </section>
      )}

      <div className="overflow-x-auto max-w-full pb-2">
        <div
          className="grid gap-2 w-full"
          style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(10.5rem, 1fr))` }}
          role="list"
          aria-label="Logic model columns"
        >
          {columns.map(col => (
            <BoardColumn
              key={col.key}
              title={col.title}
              domain={col.key}
              groups={groupsFor(model, col.key)}
              selected={selected}
              onSelect={handleSelect}
              showColorMeta={showColorMeta}
              colorFilter={colorFilter}
            />
          ))}
        </div>
      </div>

      <ItemInspector
        model={model}
        selected={selected}
        item={selectedItem}
        onUpdate={handleBoardUpdate}
        onChangeText={handleItemTextChange}
        onMarkReviewed={markItemReviewed}
        onFocusSource={onFocusSource}
        onClear={() => setSelected(null)}
      />
    </div>
  );
};

const BoardColumn: React.FC<{
  title: string;
  domain: CanonicalGroupedDomain;
  groups: LogicModelGroup[];
  selected: BoardItemRef | null;
  onSelect: (ref: BoardItemRef) => void;
  showColorMeta: boolean;
  colorFilter: string | null;
}> = ({ title, domain, groups, selected, onSelect, showColorMeta, colorFilter }) => {
  const itemCount = groups.reduce((n, g) => n + g.items.filter(i => i.text?.trim()).length, 0);
  return (
    <section className="min-w-0 rounded-md border border-gray-200 bg-brand-muted/60 flex flex-col" aria-label={title}>
      <header className="px-2 py-2 border-b border-gray-200 bg-white rounded-t-md">
        <h4 className="text-[11px] font-bold uppercase tracking-wide text-brand-navy leading-tight">{title}</h4>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </p>
      </header>
      <div className="p-2 space-y-2 flex-1">
        {groups.length === 0 || itemCount === 0 ? (
          <p className="text-[11px] text-slate-400 italic px-0.5">None extracted</p>
        ) : (
          groups.map((group, gi) => (
            <div key={gi} className="space-y-1.5">
              {group.name && group.name !== 'General' && (
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 px-0.5">{group.name}</p>
              )}
              {group.items.map((item, ii) => (
                <BoardItemCard
                  key={ii}
                  item={item}
                  selected={
                    selected?.domain === domain && selected.groupIndex === gi && selected.itemIndex === ii
                  }
                  showColorMeta={showColorMeta}
                  dimmed={!itemMatchesColorFilter(item, colorFilter)}
                  onSelect={() => onSelect({ domain, groupIndex: gi, itemIndex: ii })}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
};

const BoardItemCard: React.FC<{
  item: LogicModelItem;
  groupName?: string;
  selected: boolean;
  showColorMeta?: boolean;
  dimmed?: boolean;
  onSelect: () => void;
}> = ({ item, groupName, selected, showColorMeta = false, dimmed = false, onSelect }) => {
  const fill = showColorMeta ? swatchColor(item.fillColor) : undefined;
  const needsReview = itemNeedsReview(item);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-md border px-2 py-1.5 text-sm leading-snug transition-colors ${
        selected
          ? 'border-brand-navy ring-2 ring-brand-accent/40 bg-white'
          : needsReview
            ? 'border-amber-300 bg-white hover:border-amber-400'
            : 'border-gray-200 bg-white hover:border-brand-blue'
      } ${dimmed ? 'opacity-35' : ''}`}
      style={fill ? { borderLeftWidth: 4, borderLeftColor: fill } : undefined}
      aria-pressed={selected}
    >
      <span className="text-slate-800">{item.text || 'Empty item'}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1">
        {needsReview && (
          <span className="text-[9px] font-bold uppercase tracking-wide text-amber-800">Verify</span>
        )}
        {showColorMeta && item.fillColor?.trim() && <ColorSwatch label="Fill" value={item.fillColor} />}
        {showColorMeta && item.borderColor?.trim() && item.borderColor !== item.fillColor && (
          <ColorSwatch label="Border" value={item.borderColor} />
        )}
        {groupName && groupName !== 'General' && (
          <span className="text-[9px] text-slate-400">{groupName}</span>
        )}
      </span>
    </button>
  );
};

const ItemInspector: React.FC<{
  model: LogicModel;
  selected: BoardItemRef | null;
  item: LogicModelItem | null;
  onUpdate: (updatedModel: LogicModel) => void;
  onChangeText: (ref: BoardItemRef, text: string) => void;
  onMarkReviewed: (ref: BoardItemRef) => void;
  onFocusSource?: LogicModelBoardProps['onFocusSource'];
  onClear: () => void;
}> = ({ model, selected, item, onUpdate, onChangeText, onMarkReviewed, onFocusSource, onClear }) => {
  if (!selected || !item) {
    return null;
  }

  const needsReview = itemNeedsReview(item);

  return (
    <aside
      className="rounded-md border border-brand-blue/40 bg-white p-4"
      aria-label="Selected item"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <h4 className="text-sm font-bold text-slate-800">
          {domainFieldLabel(selected.domain)}
        </h4>
        <button type="button" className="text-xs font-bold text-slate-500 hover:text-slate-800" onClick={onClear}>
          Clear
        </button>
      </div>
      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
        Item text
        <textarea
          className="mt-1 w-full min-h-[88px] p-2 text-sm border border-gray-200 bg-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none leading-relaxed font-normal normal-case tracking-normal"
          value={item.text}
          onChange={e => onChangeText(selected, e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        {needsReview && (
          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-amber-100 text-amber-900 border-amber-300">
            Verify against source
          </span>
        )}
        {item.fillColor?.trim() && <ColorSwatch label="Fill" value={item.fillColor} />}
        {item.borderColor?.trim() && <ColorSwatch label="Border" value={item.borderColor} />}
        {onFocusSource && (
          <button
            type="button"
            onClick={() =>
              onFocusSource(
                {
                  sourcePage: item.sourcePage,
                  sourceColumn: item.sourceColumn,
                  needsReview,
                },
                { open: true }
              )
            }
            className="text-[10px] font-bold text-brand-blue hover:text-brand-navy"
          >
            Show in source
          </button>
        )}
        {needsReview && (
          <button
            type="button"
            onClick={() => onMarkReviewed(selected)}
            className="text-[10px] font-bold text-brand-blue hover:text-brand-navy"
          >
            Mark reviewed
          </button>
        )}
      </div>
      {item.sourceNote?.trim() && (
        <p className="text-[11px] text-amber-800 italic mb-2">{item.sourceNote}</p>
      )}
      {typeof item.sourcePage === 'number' && (
        <p className="text-[10px] text-slate-500 mb-2">
          Source: page {item.sourcePage}
          {typeof item.sourceColumn === 'number' ? ` · column ${item.sourceColumn}` : ''}
        </p>
      )}
      <DomainAssignControls
        key={itemRefKey(selected)}
        currentDomain={selected.domain}
        groupIndex={selected.groupIndex}
        itemIndex={selected.itemIndex}
        item={item}
        model={model}
        onUpdate={onUpdate}
      />
    </aside>
  );
};

export default LogicModelBoard;
