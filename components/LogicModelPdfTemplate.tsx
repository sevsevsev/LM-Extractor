import React, { forwardRef, useMemo } from 'react';
import { LogicModel, LogicModelGroup } from '../types';
import { brand } from '../config/brand';

interface Props {
  model: LogicModel;
  id?: string;
}

const { primary: BRAND_PRIMARY, secondary: BRAND_SECONDARY, accent: BRAND_ACCENT, highlight: BRAND_HIGHLIGHT, mutedBg: BRAND_MUTED_BG } = brand.colors;

// Layout Constants (Estimated pixels)
const PAGE_WIDTH_PX = 1400;
const CHARS_PER_LINE = 35; // Conservative wrapping estimate
const LINE_HEIGHT_PX = 18; // 11px font + padding
const GROUP_HEADER_PX = 32; // Height of group title
const SECTION_PADDING_PX = 12;

// Max heights for the grid area
const PAGE_1_GRID_HEIGHT = 600; 
const PAGE_N_GRID_HEIGHT = 800;

interface PageContent {
  pageIndex: number;
  columns: {
    inputs: LogicModelGroup[];
    activities: LogicModelGroup[];
    outputs: LogicModelGroup[];
    shortTermOutcomes: LogicModelGroup[];
    mediumTermOutcomes: LogicModelGroup[];
    longTermOutcomes: LogicModelGroup[];
  };
}

// Helper to estimate height of a group
const estimateGroupHeight = (group: LogicModelGroup): number => {
  let height = group.name !== 'General' ? GROUP_HEADER_PX : 10;
  if (group.items.length === 0) return height;
  
  group.items.forEach(item => {
    // Estimate lines based on char count
    const lines = Math.max(1, Math.ceil((item.text || '').length / CHARS_PER_LINE));
    height += lines * LINE_HEIGHT_PX;
  });
  
  return height + SECTION_PADDING_PX;
};

// Core pagination algorithm
const paginateModel = (model: LogicModel): PageContent[] => {
  const pages: PageContent[] = [];
  
  const getPage = (index: number) => {
    if (!pages[index]) {
      pages[index] = {
        pageIndex: index,
        columns: {
          inputs: [],
          activities: [],
          outputs: [],
          shortTermOutcomes: [],
          mediumTermOutcomes: [],
          longTermOutcomes: []
        }
      };
    }
    return pages[index];
  };

  // Helper to distribute a list of groups across pages for a specific column
  const distributeColumn = (
    groups: LogicModelGroup[], 
    colKey: keyof PageContent['columns']
  ) => {
    let currentPageIdx = 0;
    let currentHeight = 0;
    
    groups.forEach(group => {
      const gHeight = estimateGroupHeight(group);
      const limit = currentPageIdx === 0 ? PAGE_1_GRID_HEIGHT : PAGE_N_GRID_HEIGHT;

      // If adding this group exceeds limit, move to next page
      // (Unless it's the first item on the page, then we must fit it or clip it)
      if (currentHeight + gHeight > limit && currentHeight > 0) {
        currentPageIdx++;
        currentHeight = 0;
      }

      const page = getPage(currentPageIdx);
      page.columns[colKey].push(group);
      currentHeight += gHeight;
    });
  };

  distributeColumn(model.inputs.content, 'inputs');
  distributeColumn(model.activities.content, 'activities');
  distributeColumn(model.outputs.content, 'outputs');
  distributeColumn(model.shortTermOutcomes.content, 'shortTermOutcomes');
  distributeColumn(model.mediumTermOutcomes.content, 'mediumTermOutcomes');
  distributeColumn(model.longTermOutcomes.content, 'longTermOutcomes');

  return pages;
};

const ColumnRender: React.FC<{ groups: LogicModelGroup[], isContinuation?: boolean }> = ({ groups, isContinuation }) => (
  <div className="flex-1 flex flex-col min-w-0 border-r last:border-r-0 border-gray-300">
    <div style={{ backgroundColor: BRAND_MUTED_BG }} className="flex-grow p-3 space-y-4">
      {groups.length === 0 && isContinuation && (
        <div className="h-full w-full opacity-0"></div>
      )}
      {groups.map((g, i) => (
        <div key={i}>
          {g.name !== 'General' && (
             <h4 style={{ color: BRAND_SECONDARY }} className="text-[11px] font-bold uppercase mb-1 border-b border-gray-300 pb-0.5 mt-1">
               {g.name}
             </h4>
          )}
          <ul className="list-disc pl-4 space-y-1">
            {g.items.map((item, idx) => (
              <li key={idx} className="text-[11px] leading-snug text-slate-800">
                {item.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  </div>
);

const ContextText: React.FC<{ title: string; text: string }> = ({ title, text }) => {
    if (!text || text.trim() === '') return null;

    return (
        <div className="mb-4 last:mb-0">
             <h4 className="text-[11px] font-bold uppercase mb-1 text-slate-500 border-b border-gray-200">{title}</h4>
             <div className="space-y-2">
                 <p className="text-xs text-slate-600 leading-snug whitespace-pre-wrap">{text}</p>
             </div>
        </div>
    );
};

export const LogicModelPdfTemplate = forwardRef<HTMLDivElement, Props>(({ model, id }, ref) => {
  const pages = useMemo(() => paginateModel(model), [model]);

  return (
    <div ref={ref} id={id}>
      {pages.map((page, index) => (
        <div 
          key={index}
          className="pdf-page bg-white font-brand text-slate-900 relative mb-8"
          style={{ 
            width: '1400px', 
            height: '990px', // Fixed A4 Landscape ratio (297mm x 210mm)
            padding: '40px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* --- HEADER SECTION --- */}
          {index === 0 ? (
            // Page 1 Header
            <div className="flex justify-center items-center border-b-4 pb-4 mb-6 flex-shrink-0" style={{ borderColor: BRAND_ACCENT }}>
              <div className="text-center w-full max-w-4xl">
                <h1 className="text-3xl font-bold uppercase tracking-tight" style={{ color: BRAND_PRIMARY }}>
                  {model.program || 'PROGRAM NAME'} <span className="text-slate-400 font-light mx-2">|</span> LOGIC MODEL
                </h1>
                <h2 className="text-lg font-medium" style={{ color: BRAND_SECONDARY }}>
                  {model.organization || 'Organization Name'}
                </h2>
              </div>
            </div>
          ) : (
            // Page 2+ Condensed Header
            <div className="flex justify-between items-end border-b-2 pb-2 mb-4 flex-shrink-0" style={{ borderColor: BRAND_ACCENT }}>
                {/* Spacer to keep title centered */}
                <div className="w-1/4"></div>
                
                <div className="text-center w-2/4">
                    <h1 className="text-xl font-bold uppercase tracking-tight text-slate-400">
                        {model.program} <span className="text-sm font-normal italic">(Continued)</span>
                    </h1>
                </div>
                
                <div className="text-xs text-slate-400 font-bold w-1/4 text-right">
                    Page {index + 1}
                </div>
            </div>
          )}

          {/* --- CONTEXT BLOCK (Page 1 Only) --- */}
          {index === 0 && (
            <div className="flex gap-6 mb-6 flex-shrink-0">
               <div className="w-3/5 p-4 rounded bg-white border-l-4 shadow-sm" style={{ borderColor: BRAND_HIGHLIGHT }}>
                  <h3 className="text-sm font-bold uppercase mb-2" style={{ color: BRAND_PRIMARY }}>Mission & Who We Serve</h3>
                  
                  {/* Dynamic Rendering of Context Sections */}
                  {(!model.impactStatement?.content?.trim() &&
                    !model.mission.content &&
                    !model.targetPopulation.content) ? (
                     <p className="text-xs text-slate-400 italic">No mission or context details extracted.</p>
                  ) : (
                     <div className="space-y-4">
                         {model.mission.content?.trim() ? (
                           <ContextText title="Mission / Overview" text={model.mission.content} />
                         ) : null}
                         {model.targetPopulation.content?.trim() ? (
                           <ContextText title="Target Population" text={model.targetPopulation.content} />
                         ) : null}
                     </div>
                  )}

               </div>

               <div className="w-2/5 p-4 rounded text-white flex flex-col justify-center shadow-sm" style={{ backgroundColor: BRAND_PRIMARY }}>
                  <h3 className="text-sm font-bold uppercase mb-2" style={{ color: BRAND_HIGHLIGHT }}>Impact Statement</h3>
                  {model.impactStatement?.content?.trim() ? (
                    <p className="text-sm italic font-medium leading-snug text-white">
                      &ldquo;{model.impactStatement.content}&rdquo;
                    </p>
                  ) : (
                    <p className="text-sm italic opacity-50">No impact statement defined.</p>
                  )}
               </div>
            </div>
          )}

          {/* --- COLUMN HEADERS (Repeated on every page) --- */}
          <div className="flex items-stretch flex-shrink-0">
             {['Resources (Inputs)', 'Activities', 'Outputs', 'Short-Term Outcomes', 'Medium-Term Outcomes', 'Long-Term Outcomes'].map((title, i) => (
                <div key={i} className="flex-1 min-w-0 border-r last:border-r-0 border-gray-300">
                    <div style={{ backgroundColor: BRAND_PRIMARY }} className="p-2 text-center h-full flex items-center justify-center">
                      <h3 className="text-white text-[10px] font-bold uppercase tracking-wider leading-tight">{title}</h3>
                    </div>
                </div>
             ))}
          </div>

          {/* --- MAIN GRID CONTENT --- */}
          <div className="flex items-stretch border border-t-0 border-gray-300 rounded-b overflow-hidden shadow-sm flex-grow">
             <ColumnRender groups={page.columns.inputs} isContinuation={index > 0} />
             <ColumnRender groups={page.columns.activities} isContinuation={index > 0} />
             <ColumnRender groups={page.columns.outputs} isContinuation={index > 0} />
             <ColumnRender groups={page.columns.shortTermOutcomes} isContinuation={index > 0} />
             <ColumnRender groups={page.columns.mediumTermOutcomes} isContinuation={index > 0} />
             <ColumnRender groups={page.columns.longTermOutcomes} isContinuation={index > 0} />
          </div>

          {/* --- FOOTER REMOVED --- */}
          
        </div>
      ))}
    </div>
  );
});

LogicModelPdfTemplate.displayName = 'LogicModelPdfTemplate';