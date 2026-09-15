import React, { useEffect, useState } from 'react';
import { LogicModel } from '../types';
import { stringDomainHasContent } from '../shared/domainPresence';
import { shouldSuggestMismatch, appendCorrection } from '../shared/sourceMapping';
import { shouldShowFidelityBanner } from '../shared/extractionFidelity';
import { analyzeColorAxis } from '../shared/colorAxis';
import LogicModelBoard from './LogicModelBoard';

interface LogicModelEditorProps {
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
  mismatchBannerDismissed?: boolean;
  onDismissMismatchBanner?: () => void;
  fidelityBannerDismissed?: boolean;
  onDismissFidelityBanner?: () => void;
  onOpenSourceForFidelity?: () => void;
  /**
   * Jump source pane to this item’s page/column.
   * Pass `{ open: true }` from “Show in source” to expand the pane; omit to sync only when already open.
   */
  onFocusSource?: (
    anchor: {
      sourcePage?: number;
      sourceColumn?: number;
      needsReview?: boolean;
      /** Overrides the default needsReview-derived cue text when set (e.g. from the fidelity banner). */
      note?: string;
    },
    options?: { open?: boolean }
  ) => void;
}

const EditableTextSection: React.FC<{
  title: string;
  field: 'mission' | 'targetPopulation' | 'impactStatement';
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
}> = ({ title, field, model, onUpdate }) => {
  const fieldData = field === 'impactStatement' ? (model.impactStatement ?? { content: '' }) : model[field];
  const content = fieldData.content;

  const handleChange = (newText: string) => {
    if (field === 'impactStatement') {
      onUpdate({
        ...model,
        impactStatement: { ...fieldData, content: newText },
      });
    } else {
      onUpdate({
        ...model,
        [field]: { ...fieldData, content: newText },
      });
    }
  };

  return (
    <div className="border-b border-gray-100 pb-8 mb-8 last:border-0">
      <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-4">{title}</h4>
      <div className="relative bg-gray-50/50 rounded-lg p-3 border border-gray-200 focus-within:border-blue-300 transition-colors">
        <textarea
          className="w-full min-h-[120px] p-3 text-sm border border-gray-200 bg-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all leading-relaxed"
          value={content || ''}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Enter text here..."
        />
      </div>
    </div>
  );
};

const LogicModelEditor: React.FC<LogicModelEditorProps> = ({
  model,
  onUpdate,
  mismatchBannerDismissed,
  onDismissMismatchBanner,
  fidelityBannerDismissed,
  onDismissFidelityBanner,
  onOpenSourceForFidelity,
  onFocusSource,
}) => {
  const [showOptionalMission, setShowOptionalMission] = useState(() =>
    stringDomainHasContent(model.mission.content)
  );

  useEffect(() => {
    if (stringDomainHasContent(model.mission.content)) setShowOptionalMission(true);
  }, [model.mission.content]);

  return (
    <div className="bg-white rounded-md border border-gray-200 overflow-hidden">
      <div className="bg-brand-navy text-white px-6 py-3">
        <h3 className="headline text-sm text-white truncate">{model.program || 'Draft logic model'}</h3>
        <p className="text-xs text-white/75 mt-0.5">Read columns left to right. Click an item to edit wording or placement.</p>
      </div>

      <fieldset className="p-8 border-0 m-0 min-w-0 max-w-full w-full [min-inline-size:0]">
        <legend className="sr-only">Logic model fields</legend>
        <div className="grid grid-cols-2 gap-6 mb-6 bg-slate-50 p-6 rounded-lg border border-slate-100">
           <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Organization</label>
              <input 
                type="text" 
                className="w-full p-2 bg-transparent border-b border-gray-300 font-bold text-lg focus:border-blue-500 outline-none"
                value={model.organization} 
                onChange={e => onUpdate({...model, organization: e.target.value})}
              />
           </div>
           <div>
              <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Program</label>
              <input 
                type="text" 
                className="w-full p-2 bg-transparent border-b border-gray-300 font-bold text-lg focus:border-blue-500 outline-none"
                value={model.program} 
                onChange={e => onUpdate({...model, program: e.target.value})}
              />
           </div>
        </div>

        {/* PROGRAM CONTEXT SECTION */}
        <div className="relative py-4 mb-8">
           <div className="absolute inset-0 flex items-center" aria-hidden="true">
             <div className="w-full border-t border-gray-200"></div>
           </div>
           <div className="relative flex justify-center">
             <span className="bg-white px-3 text-sm font-bold text-gray-900 uppercase tracking-widest border border-gray-200 rounded-full py-1">Program Context</span>
           </div>
        </div>

        {model.impactStatement?.content?.trim() ? (
          <EditableTextSection title="Impact Statement" field="impactStatement" model={model} onUpdate={onUpdate} />
        ) : null}
        {showOptionalMission ? (
          <EditableTextSection title="Mission / Overview" field="mission" model={model} onUpdate={onUpdate} />
        ) : (
          <p className="text-xs text-slate-500 mb-6">
            Mission not in source.{' '}
            <button
              type="button"
              className="font-bold text-blue-600 hover:text-blue-800"
              onClick={() => setShowOptionalMission(true)}
            >
              Add mission (optional)
            </button>
          </p>
        )}
        <EditableTextSection title="Target Population" field="targetPopulation" model={model} onUpdate={onUpdate} />

        {analyzeColorAxis(model).kind === 'cross_cutting' && model.colorLegend?.trim() && (
          <div
            className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-3"
            role="note"
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Colour key (from source)
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-line">{model.colorLegend.trim()}</p>
          </div>
        )}

        {!fidelityBannerDismissed && shouldShowFidelityBanner(model) && (
          <div
            className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-3 flex flex-wrap items-start justify-between gap-3"
            role="status"
            id="extraction-fidelity-banner"
          >
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800 mb-1">
                Extraction fidelity — {model.extractionStatus || 'unknown'}
                {model.extractionConfidence ? ` · ${model.extractionConfidence} confidence` : ''}
              </p>
              <p className="text-sm text-amber-950 mb-2">
                Capture quality may need verification before coding export.
              </p>
              {model.extractionBlockers && model.extractionBlockers.length > 0 && (
                <ul className="text-sm text-amber-950 list-disc pl-5 space-y-0.5">
                  {model.extractionBlockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              )}
              {model.possiblyMissedRegions && model.possiblyMissedRegions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-amber-900">Pages to spot-check:</span>
                  {(() => {
                    const pages: number[] = Array.from(
                      new Set(model.possiblyMissedRegions.map(r => r.page))
                    );
                    pages.sort((a, b) => a - b);
                    return pages;
                  })().map(page => (
                      <button
                        key={page}
                        type="button"
                        className="rounded border border-amber-400 bg-white px-1.5 py-0.5 text-xs font-bold text-amber-900 hover:bg-amber-100"
                        onClick={() =>
                          onFocusSource?.(
                            { sourcePage: page, note: 'Spot-check for missed content' },
                            { open: true }
                          )
                        }
                      >
                        {page}
                      </button>
                    ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <a
                href="#needs-review-hint"
                className="text-xs font-bold text-amber-900 hover:text-amber-950 underline"
              >
                Review flagged items
              </a>
              <button
                type="button"
                className="text-xs font-bold text-amber-900 hover:text-amber-950 underline"
                onClick={() => onOpenSourceForFidelity?.()}
              >
                Show source
              </button>
              <button
                type="button"
                className="text-xs font-bold text-amber-700 hover:text-amber-950"
                onClick={() => onDismissFidelityBanner?.()}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <p id="needs-review-hint" className="sr-only">
          Items marked verify against source need human review.
        </p>

        {!mismatchBannerDismissed && shouldSuggestMismatch(model) && (
          <div
            className="mb-6 rounded-lg border border-brand-accent/50 bg-brand-sky/15 p-3 flex flex-wrap items-start justify-between gap-3"
            role="status"
            id="unmapped-mismatch-banner"
          >
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-brand-navy mb-1">
                Mapping review suggested
              </p>
              <p className="text-sm text-brand-navy">
                Significant layout or label mismatch detected. Review unmapped items and assign domains
                with the dropdown — leave empty when there is no clear home.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href="#unmapped-section"
                className="text-xs font-bold text-brand-blue hover:text-brand-navy underline"
              >
                Review unmapped
              </a>
              <button
                type="button"
                className="text-xs font-bold text-brand-gray hover:text-brand-navy"

                onClick={() => {
                  onUpdate(
                    appendCorrection(model, {
                      fileId: '',
                      action: 'dismiss_mismatch_banner',
                      itemKey: 'banner',
                      itemText: '',
                      fromDomain: null,
                      toDomain: null,
                      layoutFamily: model.layoutFamily,
                    })
                  );
                  onDismissMismatchBanner?.();
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <LogicModelBoard model={model} onUpdate={onUpdate} onFocusSource={onFocusSource} />
      </fieldset>
    </div>
  );
};

export default LogicModelEditor;