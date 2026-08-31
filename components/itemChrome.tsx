import React, { useEffect, useState } from 'react';
import type { LogicModel, QualityRating } from '../types';
import { CANONICAL_DOMAIN_OPTIONS, type CanonicalGroupedDomain } from '../shared/domainSynonyms';
import { appendCorrection, reassignItemDomain } from '../shared/sourceMapping';

/** Approximate CSS colour for a model-reported colour name, for the editor swatch. */
const COLOR_SWATCH: Record<string, string> = {
  orange: '#f4923b',
  purple: '#7c6bf0',
  red: '#ef5350',
  yellow: '#f6d743',
  blue: '#5b8def',
  green: '#4caf7d',
  gray: '#9ca3af',
  grey: '#9ca3af',
  white: '#f8fafc',
  black: '#1f2937',
};

export const swatchColor = (value?: string): string | undefined => {
  if (!value) return undefined;
  const key = value.trim().toLowerCase();
  if (COLOR_SWATCH[key]) return COLOR_SWATCH[key];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(key)) return key;
  return undefined;
};

export const ColorSwatch: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const css = swatchColor(value);
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-500">
      <span
        className="inline-block w-3 h-3 rounded-sm border border-slate-300"
        style={css ? { backgroundColor: css } : undefined}
        aria-hidden="true"
      />
      {label}: {value}
    </span>
  );
};

export const ratingBadgeClass = (rating?: string) =>
  rating === 'Strong' || rating === 'Adequate'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : rating === 'Weak'
      ? 'bg-amber-100 text-amber-900 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';

export const DomainAssignControls: React.FC<{
  currentDomain: CanonicalGroupedDomain | 'unmapped';
  groupIndex: number;
  itemIndex: number;
  item: { mappingNote?: string; sourceHeader?: string };
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
}> = ({ currentDomain, groupIndex, itemIndex, item, model, onUpdate }) => {
  const [note, setNote] = useState(item.mappingNote || '');
  const selectValue = currentDomain === 'unmapped' ? '' : currentDomain;

  useEffect(() => {
    setNote(item.mappingNote || '');
  }, [item.mappingNote]);

  return (
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <label className="flex flex-col gap-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        Assign domain
        <select
          className="text-sm font-normal normal-case tracking-normal border border-slate-200 rounded-md px-2 py-1 bg-white min-w-[11rem]"
          value={selectValue}
          onChange={e => {
            const raw = e.target.value;
            const toDomain: CanonicalGroupedDomain | 'unmapped' =
              raw === '' ? 'unmapped' : (raw as CanonicalGroupedDomain);
            if (toDomain === currentDomain) return;
            const { model: next } = reassignItemDomain(model, {
              fromDomain: currentDomain,
              fromGroupIndex: groupIndex,
              itemIndex,
              toDomain,
              note,
            });
            onUpdate(next);
          }}
        >
          {CANONICAL_DOMAIN_OPTIONS.map(opt => (
            <option key={opt.label} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 flex-grow min-w-[12rem]">
        Mapping note
        <input
          type="text"
          className="text-sm font-normal normal-case tracking-normal border border-slate-200 rounded-md px-2 py-1 bg-white"
          value={note}
          placeholder="Optional — why this domain?"
          onChange={e => setNote(e.target.value)}
          onBlur={() => {
            const trimmed = note.trim();
            if (trimmed === (item.mappingNote || '').trim()) return;
            const fieldKey = currentDomain;
            const field = fieldKey === 'unmapped' ? model.unmapped ?? { content: [] } : model[fieldKey];
            const groups = (field.content || []).map((g, gi) => {
              if (gi !== groupIndex) return g;
              return {
                ...g,
                items: g.items.map((it, ii) =>
                  ii === itemIndex ? { ...it, mappingNote: trimmed || undefined } : it
                ),
              };
            });
            let next: LogicModel =
              fieldKey === 'unmapped'
                ? { ...model, unmapped: { ...field, content: groups } }
                : { ...model, [fieldKey]: { ...field, content: groups } };
            next = appendCorrection(next, {
              fileId: '',
              action: 'note_edit',
              itemKey: `${item.sourceHeader || ''}|note|${itemIndex}`,
              itemText: '',
              fromDomain: currentDomain === 'unmapped' ? null : currentDomain,
              toDomain: currentDomain === 'unmapped' ? null : currentDomain,
              sourceHeader: item.sourceHeader,
              note: trimmed || undefined,
              layoutFamily: model.layoutFamily,
            });
            onUpdate(next);
          }}
        />
      </label>
      {item.sourceHeader?.trim() && (
        <span className="text-[10px] text-slate-400 pb-1">Source: {item.sourceHeader}</span>
      )}
    </div>
  );
};

export const RATING_OPTIONS: QualityRating[] = ['Strong', 'Adequate', 'Weak'];
