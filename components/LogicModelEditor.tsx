import React from 'react';
import { LogicModel, LogicModelGroup } from '../types';

interface LogicModelEditorProps {
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
  onReAnalyze: () => void;
  isAnalyzing: boolean;
}

const EditableTextSection: React.FC<{
  title: string;
  field: 'mission' | 'targetPopulation';
  model: LogicModel;
  onUpdate: (updatedModel: LogicModel) => void;
}> = ({ title, field, model, onUpdate }) => {
  const fieldData = model[field] as { content: string, critique: string, rating?: string };
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
    onUpdate({
      ...model,
      [field]: { ...fieldData, content: newText }
    });
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
                 return (
                   <div key={itemIdx} className="flex flex-col space-y-2 pl-2 border-l-2 border-slate-200">
                     <div className="flex items-start justify-between space-x-2">
                       <textarea
                         className="flex-grow min-h-[60px] p-2 text-sm border border-gray-200 bg-white rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all leading-relaxed"
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
  const ratingSummary: Array<{ label: string; rating?: string }> = [
    { label: 'Mission', rating: model.mission.rating },
    { label: 'Target Population', rating: model.targetPopulation.rating },
    { label: 'Inputs', rating: model.inputs.rating },
    { label: 'Activities', rating: model.activities.rating },
    { label: 'Outputs', rating: model.outputs.rating },
    { label: 'Short-Term', rating: model.shortTermOutcomes.rating },
    { label: 'Medium-Term', rating: model.mediumTermOutcomes.rating },
    { label: 'Long-Term', rating: model.longTermOutcomes.rating },
    { label: 'Impact', rating: model.impact.rating },
  ];
  const weakCount = ratingSummary.filter(r => r.rating === 'Weak' || !r.rating).length;

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

      <div className="px-6 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mr-1">
            {weakCount > 0 ? `${weakCount} section${weakCount === 1 ? '' : 's'} need attention` : 'All sections rated Strong or Adequate'}
          </span>
          {ratingSummary.map(item => {
            const tone =
              item.rating === 'Strong' || item.rating === 'Adequate'
                ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                : item.rating === 'Weak'
                  ? 'bg-amber-100 text-amber-900 border-amber-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200';
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
        <div className="grid grid-cols-2 gap-6 mb-10 bg-slate-50 p-6 rounded-lg border border-slate-100">
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

        <EditableTextSection title="Mission / Overview" field="mission" model={model} onUpdate={onUpdate} />
        <EditableTextSection title="Target Population" field="targetPopulation" model={model} onUpdate={onUpdate} />
        
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
        <EditableGroupSection title="Medium-Term Outcomes" field="mediumTermOutcomes" model={model} onUpdate={onUpdate} />
        <EditableGroupSection title="Long-Term Outcomes" field="longTermOutcomes" model={model} onUpdate={onUpdate} />
        <EditableGroupSection title="Impact" field="impact" model={model} onUpdate={onUpdate} />
      </fieldset>
    </div>
  );
};

export default LogicModelEditor;