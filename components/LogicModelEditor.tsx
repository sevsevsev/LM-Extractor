import React, { useEffect, useState } from 'react';
import { LogicModel, LogicModelGroup, QualityRating } from '../types';
import {
  groupedDomainHasContent,
  sanitizeAbsentDomainCritiques,
  stringDomainHasContent,
} from '../shared/domainPresence';
import { itemNeedsReview } from '../shared/provenance';

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

const swatchColor = (value?: string): string | undefined => {
  if (!value) return undefined;
  const key = value.trim().toLowerCase();
  if (COLOR_SWATCH[key]) return COLOR_SWATCH[key];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(key)) return key;
  return undefined;
};

const ColorSwatch: React.FC<{ label: string; value: string }> = ({ label, value }) => {
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

interface LogicModelEditorProps {
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
  onReAnalyze: () => void;
  isAnalyzing: boolean;
}

const RATING_OPTIONS: QualityRating[] = ['Strong', 'Adequate', 'Weak'];

const ratingBadgeClass = (rating?: string) =>
  rating === 'Strong' || rating === 'Adequate'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : rating === 'Weak'
      ? 'bg-amber-100 text-amber-900 border-amber-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';


const EditableTextSection: React.FC<{
  title: string;
  field: 'mission' | 'targetPopulation' | 'impactStatement';
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
}> = ({ title, field, model, onUpdate }) => {
  const fieldData =
    field === 'impactStatement'
      ? (model.impactStatement ?? { content: '', critique: '', rating: undefined })
      : (model[field] as { content: string; critique: string; rating?: string });
  const content = fieldData.content;

  const isPassing = fieldData.rating === 'Strong' || fieldData.rating === 'Adequate';
  
  const critiqueStyles = isPassing 
    ? {
        container: "bg-emerald-50 border-emerald-100",
        titleText: "text-emerald-700",
        bodyText: "text-emerald-900",
        badge: "bg-emerald-100 text-emerald-800 border-emerald-200"
      }
    : {
        container: "bg-amber-50 border-amber-100",
        titleText: "text-amber-700",
        bodyText: "text-amber-900",
        badge: "bg-amber-100 text-amber-800 border-amber-200"
      };

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

  const needsAttention = fieldData.rating === 'Weak' || !fieldData.rating;

  return (
    <details open={needsAttention} className="border-b border-gray-100 pb-8 mb-8 last:border-0 group">
      <summary className="lg:col-span-3 cursor-pointer list-none flex items-center justify-between gap-3 mb-4">
         <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-0">{title}</h4>
         <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${critiqueStyles.badge}`}>
           {fieldData.rating || 'Unrated'}
         </span>
      </summary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
          <div className="relative bg-gray-50/50 rounded-lg p-3 border border-gray-200 focus-within:border-blue-300 transition-colors">
            <textarea
              className="w-full min-h-[120px] p-3 text-sm border border-gray-200 bg-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all leading-relaxed"
              value={content || ''}
              onChange={(e) => handleChange(e.target.value)}
              placeholder="Enter text here..."
            />
          </div>
      </div>

      <div className="lg:col-span-1">
        <div className={`${critiqueStyles.container} border rounded-lg p-4 sticky top-24`}>
          <div className="flex justify-between items-start mb-2">
            <h5 className={`text-[10px] font-bold ${critiqueStyles.titleText} uppercase tracking-widest flex items-center`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              AI Critique
            </h5>
            {fieldData.rating && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${critiqueStyles.badge} uppercase`}>
                    {fieldData.rating}
                </span>
            )}
          </div>
          <p className={`text-xs ${critiqueStyles.bodyText} leading-relaxed italic`}>
            {fieldData.critique || (fieldData.rating ? 'No specific suggestions for this section.' : 'Critique not available yet — run Re-Analyze after editing.')}
          </p>
        </div>
      </div>
      </div>
    </details>
  );
};

const EditableGroupSection: React.FC<{
  title: string;
  field: keyof LogicModel;
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
}> = ({ title, field, model, onUpdate }) => {
  const fieldData = model[field] as { content: LogicModelGroup[], critique: string, rating?: string };
  const groups = fieldData.content;

  // Determine styling based on rating
  // Green for Strong/Adequate, Amber for Weak or missing
  const isPassing = fieldData.rating === 'Strong' || fieldData.rating === 'Adequate';
  
  const critiqueStyles = isPassing 
    ? {
        container: "bg-emerald-50 border-emerald-100",
        titleText: "text-emerald-700",
        bodyText: "text-emerald-900",
        badge: "bg-emerald-100 text-emerald-800 border-emerald-200"
      }
    : {
        container: "bg-amber-50 border-amber-100",
        titleText: "text-amber-700",
        bodyText: "text-amber-900",
        badge: "bg-amber-100 text-amber-800 border-amber-200"
      };

  const handleGroupNameChange = (groupIndex: number, newName: string) => {
    const newGroups = groups.map((group, i) =>
      i === groupIndex ? { ...group, name: newName } : group
    );
    onUpdate({
      ...model,
      [field]: { ...fieldData, content: newGroups }
    });
  };

  const handleItemTextChange = (groupIndex: number, itemIndex: number, newText: string) => {
    const newGroups = groups.map((group, i) => {
      if (i !== groupIndex) return group;
      return {
        ...group,
        items: group.items.map((item, j) =>
          j === itemIndex ? { ...item, text: newText } : item
        ),
      };
    });
    onUpdate({
      ...model,
      [field]: { ...fieldData, content: newGroups }
    });
  };

  const markItemReviewed = (groupIndex: number, itemIndex: number) => {
    const newGroups = groups.map((group, i) => {
      if (i !== groupIndex) return group;
      return {
        ...group,
        items: group.items.map((item, j) => {
          if (j !== itemIndex) return item;
          const { sourceNote: _drop, ...rest } = item;
          return { ...rest, verbatim: true };
        }),
      };
    });
    onUpdate({ ...model, [field]: { ...fieldData, content: newGroups } });
  };

  const addItemToGroup = (groupIndex: number) => {
    const newGroups = groups.map((group, i) =>
      i === groupIndex
        ? { ...group, items: [...group.items, { text: '', critique: '', rating: 'Adequate' as const }] }
        : group
    );
    onUpdate({ ...model, [field]: { ...fieldData, content: newGroups } });
  };

  const removeItemFromGroup = (groupIndex: number, itemIndex: number) => {
    const newGroups = groups.map((group, i) =>
      i === groupIndex
        ? { ...group, items: group.items.filter((_, j) => j !== itemIndex) }
        : group
    );
    onUpdate({ ...model, [field]: { ...fieldData, content: newGroups } });
  };

  const addGroup = () => {
    const newGroups = [...groups, { name: 'New Category', items: [] }];
    onUpdate({
      ...model,
      [field]: { ...fieldData, content: newGroups }
    });
  };

  const removeGroup = (index: number) => {
    if (!window.confirm('Remove this group?')) return;
    const newGroups = groups.filter((_, i) => i !== index);
    onUpdate({
      ...model,
      [field]: { ...fieldData, content: newGroups }
    });
  };

  const needsAttention = fieldData.rating === 'Weak' || !fieldData.rating;

  return (
    <details open={needsAttention} className="border-b border-gray-100 pb-8 mb-8 last:border-0">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 mb-4">
         <h4 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-0">{title}</h4>
         <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${critiqueStyles.badge}`}>
           {fieldData.rating || 'Unrated'}
         </span>
      </summary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Content Column (Groups) */}
      <div className="lg:col-span-2 space-y-6">
        {groups.map((group, idx) => (
          <div key={idx} className="relative bg-gray-50/50 rounded-lg p-3 border border-gray-200 group-hover:border-blue-300 transition-colors">
            <div className="flex items-center justify-between mb-4">
              <input
                className="bg-transparent text-sm font-bold text-slate-700 focus:outline-none focus:border-b focus:border-blue-500 px-1"
                value={group.name}
                onChange={(e) => handleGroupNameChange(idx, e.target.value)}
                placeholder="Group Name (e.g., General)"
              />
              <button 
                onClick={() => removeGroup(idx)}
                className="text-gray-400 hover:text-red-500 text-xs px-2"
                title="Remove Group"
                aria-label={`Remove group ${group.name}`}
                type="button"
              >
                Remove group
              </button>
            </div>
            
            <div className="space-y-4">
               {group.items.map((item, itemIdx) => {
                 const isItemPassing = item.rating === 'Strong' || item.rating === 'Adequate';
                 const itemCritiqueStyles = isItemPassing
                    ? "bg-emerald-50 text-emerald-800 border-emerald-100"
                    : "bg-amber-50 text-amber-800 border-amber-100";
                 const needsReview = itemNeedsReview(item);
                 const hasColor = Boolean(item.fillColor?.trim() || item.borderColor?.trim());
                 return (
                   <div
                     key={itemIdx}
                     className={`flex flex-col space-y-2 pl-2 border-l-2 ${needsReview ? 'border-amber-400' : 'border-slate-200'}`}
                   >
                     <div className="flex items-start justify-between space-x-2">
                       <textarea
                         className={`flex-grow min-h-[60px] p-2 text-sm border bg-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all leading-relaxed ${needsReview ? 'border-amber-300' : 'border-gray-200'}`}
                         value={item.text}
                         onChange={(e) => handleItemTextChange(idx, itemIdx, e.target.value)}
                         placeholder="Enter item details..."
                       />
                       <button
                         type="button"
                         onClick={() => removeItemFromGroup(idx, itemIdx)}
                         className="text-gray-400 hover:text-red-500 py-2"
                         aria-label="Remove item"
                       >
                         Remove
                       </button>
                     </div>
                     {(needsReview || hasColor) && (
                       <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                         {needsReview && (
                           <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border bg-amber-100 text-amber-900 border-amber-300">
                             <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3" aria-hidden="true">
                               <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                             </svg>
                             Verify against source
                           </span>
                         )}
                         {item.fillColor?.trim() && <ColorSwatch label="Fill" value={item.fillColor} />}
                         {item.borderColor?.trim() && <ColorSwatch label="Border" value={item.borderColor} />}
                         {needsReview && (
                           <button
                             type="button"
                             onClick={() => markItemReviewed(idx, itemIdx)}
                             className="text-[10px] font-bold text-blue-600 hover:text-blue-800"
                           >
                             Mark reviewed
                           </button>
                         )}
                       </div>
                     )}
                     {item.sourceNote?.trim() && (
                       <p className="text-[11px] text-amber-800 italic">{item.sourceNote}</p>
                     )}
                     {item.critique && (
                       <div className={`text-xs p-2 rounded border ${itemCritiqueStyles} flex items-start space-x-2`}>
                         <strong className="uppercase text-[9px] mt-0.5 tracking-wider">{item.rating}:</strong>
                         <span className="italic">{item.critique}</span>
                       </div>
                     )}
                   </div>
                 );
               })}
               <button type="button" onClick={() => addItemToGroup(idx)} className="text-xs text-blue-500 font-bold hover:underline py-1">+ Add Item</button>
            </div>
          </div>
        ))}
        <button 
          type="button"
          onClick={addGroup}
          className="w-full py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs font-bold text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all flex items-center justify-center space-x-1"
        >
          <span>+ Add Sub-Group</span>
        </button>
      </div>

      {/* Critique Column */}
      <div className="lg:col-span-1">
        <div className={`${critiqueStyles.container} border rounded-lg p-4 sticky top-24`}>
          <div className="flex justify-between items-start mb-2">
            <h5 className={`text-[10px] font-bold ${critiqueStyles.titleText} uppercase tracking-widest flex items-center`}>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 mr-1" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              AI Critique
            </h5>
            {fieldData.rating && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${critiqueStyles.badge} uppercase`}>
                    {fieldData.rating}
                </span>
            )}
          </div>
          <p className={`text-xs ${critiqueStyles.bodyText} leading-relaxed italic`}>
            {fieldData.critique || (fieldData.rating ? 'No specific suggestions for this section.' : 'Critique not available yet — run Re-Analyze after editing.')}
          </p>
        </div>
      </div>
      </div>
    </details>
  );
};

const LogicModelEditor: React.FC<LogicModelEditorProps> = ({ model, onUpdate, onReAnalyze, isAnalyzing }) => {
  const [showOptionalMission, setShowOptionalMission] = useState(() =>
    stringDomainHasContent(model.mission.content)
  );
  const [showOptionalMediumTerm, setShowOptionalMediumTerm] = useState(() =>
    groupedDomainHasContent(model.mediumTermOutcomes.content)
  );
  const [showOptionalImpact, setShowOptionalImpact] = useState(() =>
    groupedDomainHasContent(model.impact.content)
  );

  useEffect(() => {
    if (stringDomainHasContent(model.mission.content)) setShowOptionalMission(true);
  }, [model.mission.content]);

  useEffect(() => {
    if (groupedDomainHasContent(model.mediumTermOutcomes.content)) setShowOptionalMediumTerm(true);
  }, [model.mediumTermOutcomes.content]);

  useEffect(() => {
    if (groupedDomainHasContent(model.impact.content)) setShowOptionalImpact(true);
  }, [model.impact.content]);

  useEffect(() => {
    const sanitized = sanitizeAbsentDomainCritiques(model);
    const rationaleChanged =
      JSON.stringify(sanitized.overallQuality?.rationale ?? []) !==
      JSON.stringify(model.overallQuality?.rationale ?? []);
    const optionalCritiqueCleared =
      sanitized.mission.critique !== model.mission.critique ||
      sanitized.mediumTermOutcomes.critique !== model.mediumTermOutcomes.critique ||
      sanitized.impact.critique !== model.impact.critique;
    if (rationaleChanged || optionalCritiqueCleared) {
      onUpdate(sanitized);
    }
  }, [model, onUpdate]);

  const ratingSummary: Array<{ label: string; rating?: string }> = [
    ...(model.impactStatement?.content?.trim()
      ? [{ label: 'Impact Statement', rating: model.impactStatement.rating }]
      : []),
    ...(stringDomainHasContent(model.mission.content)
      ? [{ label: 'Mission', rating: model.mission.rating }]
      : []),
    ...(stringDomainHasContent(model.targetPopulation.content)
      ? [{ label: 'Target Population', rating: model.targetPopulation.rating }]
      : []),
    ...(groupedDomainHasContent(model.inputs.content)
      ? [{ label: 'Inputs', rating: model.inputs.rating }]
      : []),
    ...(groupedDomainHasContent(model.activities.content)
      ? [{ label: 'Activities', rating: model.activities.rating }]
      : []),
    ...(groupedDomainHasContent(model.outputs.content)
      ? [{ label: 'Outputs', rating: model.outputs.rating }]
      : []),
    ...(groupedDomainHasContent(model.shortTermOutcomes.content)
      ? [{ label: 'Short-Term', rating: model.shortTermOutcomes.rating }]
      : []),
    ...(groupedDomainHasContent(model.mediumTermOutcomes.content)
      ? [{ label: 'Medium-Term', rating: model.mediumTermOutcomes.rating }]
      : []),
    ...(groupedDomainHasContent(model.longTermOutcomes.content)
      ? [{ label: 'Long-Term', rating: model.longTermOutcomes.rating }]
      : []),
    ...(groupedDomainHasContent(model.impact.content)
      ? [{ label: 'Impact', rating: model.impact.rating }]
      : []),
  ];
  const weakCount = ratingSummary.filter(r => r.rating === 'Weak' || !r.rating).length;
  const overall = model.overallQuality;
  const overallTone = ratingBadgeClass(overall?.rating);

  const updateOverallRating = (rating: QualityRating) => {
    onUpdate({
      ...model,
      overallQuality: {
        rating,
        rationale: overall?.rationale?.length ? overall.rationale : ['', ''],
      },
    });
  };

  const updateRationaleBullet = (index: number, text: string) => {
    const bullets = [...(overall?.rationale || ['', ''])];
    while (bullets.length < 2) bullets.push('');
    bullets[index] = text;
    onUpdate({
      ...model,
      overallQuality: {
        rating: overall?.rating || 'Adequate',
        rationale: bullets,
      },
    });
  };

  const addRationaleBullet = () => {
    const bullets = [...(overall?.rationale || [])];
    if (bullets.length >= 4) return;
    bullets.push('');
    onUpdate({
      ...model,
      overallQuality: {
        rating: overall?.rating || 'Adequate',
        rationale: bullets,
      },
    });
  };

  const removeRationaleBullet = (index: number) => {
    const bullets = (overall?.rationale || []).filter((_, i) => i !== index);
    onUpdate({
      ...model,
      overallQuality: {
        rating: overall?.rating || 'Adequate',
        rationale: bullets.length >= 2 ? bullets : [...bullets, ''].slice(0, 2),
      },
    });
  };

  return (
    <div className={`bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden ${isAnalyzing ? 'opacity-90' : ''}`}>
      <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-lg">{model.program || 'Draft Logic Model'}</h3>
          <p className="text-xs opacity-70">Review the AI critique. Groups are detected automatically from the visual layout.</p>
        </div>
        <button
          type="button"
          onClick={onReAnalyze}
          disabled={isAnalyzing}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 px-4 py-2 rounded-lg text-sm font-bold transition-colors flex items-center space-x-2"
        >
          {isAnalyzing ? (
            <><div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full" aria-hidden="true"></div><span>Refining...</span></>
          ) : (
            <span>Re-Analyze Edits</span>
          )}
        </button>
      </div>

      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${overallTone}`}>
            Overall{overall?.rating ? `: ${overall.rating}` : ': Unrated'}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
            {weakCount > 0 ? `${weakCount} section${weakCount === 1 ? '' : 's'} need attention` : 'All sections rated Strong or Adequate'}
          </span>
          {ratingSummary.map(item => {
            const tone = ratingBadgeClass(item.rating);
            return (
              <span
                key={item.label}
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${tone}`}
                title={item.rating || 'No rating'}
              >
                {item.label}
                {item.rating ? `: ${item.rating}` : ''}
              </span>
            );
          })}
        </div>
      </div>
      
      <fieldset disabled={isAnalyzing} className="p-8 border-0 m-0 min-w-0 disabled:opacity-70">
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

        <div className={`mb-10 border rounded-lg p-5 ${overall?.rating === 'Weak' || !overall?.rating ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-700">Overall quality</h4>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
              <span className="sr-only">Overall rating</span>
              <select
                className="border border-slate-300 rounded-md px-2 py-1 bg-white text-sm font-bold"
                value={overall?.rating || ''}
                onChange={e => {
                  const v = e.target.value as QualityRating;
                  if (RATING_OPTIONS.includes(v)) updateOverallRating(v);
                }}
              >
                <option value="" disabled>
                  Unrated
                </option>
                {RATING_OPTIONS.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-500 mb-3">
            Why this rating (2–4 bullets). Re-Analyze refreshes overall quality from AI.
          </p>
          <ul className="space-y-2">
            {(overall?.rationale?.length ? overall.rationale : ['', '']).map((bullet, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="text-slate-400 text-xs mt-2.5" aria-hidden="true">
                  •
                </span>
                <input
                  type="text"
                  className="flex-1 text-sm border border-slate-200 rounded-md px-3 py-2 bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                  value={bullet}
                  onChange={e => updateRationaleBullet(i, e.target.value)}
                  placeholder={`Rationale bullet ${i + 1}`}
                />
                {(overall?.rationale?.length || 0) > 2 ? (
                  <button
                    type="button"
                    className="text-xs text-slate-400 hover:text-red-600 px-1 py-2"
                    onClick={() => removeRationaleBullet(i)}
                    aria-label={`Remove rationale bullet ${i + 1}`}
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {(overall?.rationale?.length || 0) < 4 ? (
            <button
              type="button"
              onClick={addRationaleBullet}
              className="mt-3 text-xs font-bold text-blue-600 hover:text-blue-800"
            >
              + Add rationale bullet
            </button>
          ) : null}
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

        {model.colorLegend?.trim() && (
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

        {/* LOGIC MODEL COLUMNS */}
        <div className="relative py-4 mb-8">
           <div className="absolute inset-0 flex items-center" aria-hidden="true">
             <div className="w-full border-t border-gray-200"></div>
           </div>
           <div className="relative flex justify-center">
             <span className="bg-white px-3 text-sm font-bold text-gray-900 uppercase tracking-widest border border-gray-200 rounded-full py-1">Resources & Activities</span>
           </div>
        </div>

        <EditableGroupSection title="Inputs" field="inputs" model={model} onUpdate={onUpdate} />
        <EditableGroupSection title="Activities" field="activities" model={model} onUpdate={onUpdate} />
        <EditableGroupSection title="Outputs" field="outputs" model={model} onUpdate={onUpdate} />
        
        {/* OUTCOMES SECTION */}
        <div className="relative py-4 mb-8">
           <div className="absolute inset-0 flex items-center" aria-hidden="true">
             <div className="w-full border-t border-gray-200"></div>
           </div>
           <div className="relative flex justify-center">
             <span className="bg-white px-3 text-sm font-bold text-gray-900 uppercase tracking-widest border border-gray-200 rounded-full py-1">Outcomes & Impact</span>
           </div>
        </div>

        <EditableGroupSection title="Short-Term Outcomes" field="shortTermOutcomes" model={model} onUpdate={onUpdate} />
        {showOptionalMediumTerm ? (
          <EditableGroupSection title="Medium-Term Outcomes" field="mediumTermOutcomes" model={model} onUpdate={onUpdate} />
        ) : (
          <p className="text-xs text-slate-500 mb-6">
            No medium-term outcomes in source.{' '}
            <button
              type="button"
              className="font-bold text-blue-600 hover:text-blue-800"
              onClick={() => setShowOptionalMediumTerm(true)}
            >
              Add medium-term section (optional)
            </button>
          </p>
        )}
        <EditableGroupSection title="Long-Term Outcomes" field="longTermOutcomes" model={model} onUpdate={onUpdate} />
        {showOptionalImpact ? (
          <EditableGroupSection title="Impact" field="impact" model={model} onUpdate={onUpdate} />
        ) : (
          <p className="text-xs text-slate-500 mb-6">
            No impact column in source.{' '}
            <button
              type="button"
              className="font-bold text-blue-600 hover:text-blue-800"
              onClick={() => setShowOptionalImpact(true)}
            >
              Add impact section (optional)
            </button>
          </p>
        )}
      </fieldset>
    </div>
  );
};

export default LogicModelEditor;