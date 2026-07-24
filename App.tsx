import React, { useState, useEffect, useRef } from 'react';
import { ProcessingFile, LogicModel, LogicModelGroup } from './types';
import FileUpload from './components/FileUpload';
import LogicModelEditor from './components/LogicModelEditor';
import { LogicModelPdfTemplate } from './components/LogicModelPdfTemplate';
import { generatePdfFromElement, createZipFromBlobs } from './services/pdfService';
import { convertPdfToImages, convertDocxToImages, convertPptxToImages, convertFileToMarkdown } from './services/fileService';
import { extractLogicModel, critiqueLogicModel } from './services/geminiService';

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const processingRef = useRef(false);

  const handleFilesSelected = (newFiles: File[]) => {
    const newProcessingFiles: ProcessingFile[] = newFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      file,
      status: 'pending'
    }));
    setFiles(prev => [...prev, ...newProcessingFiles]);
  };

  useEffect(() => {
    const processQueue = async () => {
      if (processingRef.current) return;
      const pendingFile = files.find(f => f.status === 'pending');
      if (!pendingFile) return;

      processingRef.current = true;
      setIsProcessing(true);
      const fileId = pendingFile.id;

      try {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'converting' } : f));
        
        let inputForGemini: string | string[];
        const fileName = pendingFile.file.name.toLowerCase();

        // 1. Attempt Vision Processing for ALL types to detect structure
        try {
            if (fileName.endsWith('.pdf')) {
                inputForGemini = await convertPdfToImages(pendingFile.file);
            } else if (fileName.endsWith('.docx')) {
                inputForGemini = await convertDocxToImages(pendingFile.file);
            } else if (fileName.endsWith('.pptx')) {
                inputForGemini = await convertPptxToImages(pendingFile.file);
            } else {
                throw new Error("Unsupported format for vision");
            }
        } catch (visionError) {
            console.warn("Vision processing failed, falling back to text extraction:", visionError);
            // Fallback to text extraction if visual rendering fails
            inputForGemini = await convertFileToMarkdown(pendingFile.file);
        }
        
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'extracting', progressMsg: 'Extracting data from document...' } : f));
        const extractedResult = await extractLogicModel(inputForGemini);

        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'analyzing', progressMsg: 'Applying guidance critique...' } : f));
        const finalResult = await critiqueLogicModel(extractedResult);

        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'editing', result: finalResult } : f));
      } catch (error: any) {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', error: error.message } : f));
      } finally {
        processingRef.current = false;
        setIsProcessing(false);
      }
    };
    processQueue();
  }, [files, isProcessing]);

  const updateModel = (fileId: string, updatedModel: LogicModel) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, result: updatedModel } : f));
  };

  const reAnalyzeModel = async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file || !file.result) return;

    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'analyzing', progressMsg: 'Re-evaluating changes...' } : f));
    setIsProcessing(true);
    
    try {
      const result = await critiqueLogicModel(file.result);
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'editing', result, progressMsg: undefined } : f));
    } catch (e: any) {
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error', error: e.message } : f));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportCSV = () => {
    const completed = files.filter(f => (f.status === 'editing' || f.status === 'completed') && f.result);
    if (completed.length === 0) return;

    const headers = ['Organization', 'Program', 'Domain', 'Group', 'Content', 'Domain Critique', 'Domain Rating', 'Item Critique', 'Item Rating'];
    const rows: string[][] = [];

    completed.forEach(f => {
      const m = f.result!;
      const pushStringField = (domain: string, field: { content: string, critique: string, rating?: string }) => {
         rows.push([m.organization, m.program, domain, 'General', field.content || '', field.critique, field.rating || '', '', '']);
      };

      const pushField = (domain: string, field: { content: LogicModelGroup[], critique: string, rating?: string }) => {
         field.content.forEach(g => {
            if (g.items.length === 0) {
               rows.push([m.organization, m.program, domain, g.name, '', field.critique, field.rating || '', '', '']);
            } else {
               g.items.forEach(item => {
                  rows.push([m.organization, m.program, domain, g.name, item.text, field.critique, field.rating || '', item.critique || '', item.rating || '']);
               });
            }
         });
      };
      pushStringField('Mission / Overview', m.mission);
      pushStringField('Target Population', m.targetPopulation);
      pushField('Inputs', m.inputs);
      pushField('Activities', m.activities);
      pushField('Outputs', m.outputs);
      pushField('Short-Term Outcomes', m.shortTermOutcomes);
      pushField('Medium-Term Outcomes', m.mediumTermOutcomes);
      pushField('Long-Term Outcomes', m.longTermOutcomes);
      pushField('Impact', m.impact);
    });

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `logic_models_granular_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleDownloadSinglePdf = async (file: ProcessingFile) => {
    if (!file.result) return;
    setIsGeneratingPdf(true);
    try {
        // Use the ID from the hidden rendered template or the modal if open
        const elementId = `pdf-template-${file.id}`;
        const blob = await generatePdfFromElement(elementId, `${file.result.program}.pdf`);
        if (blob) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${file.result.program || 'logic_model'}_SDP_Branded.pdf`;
            link.click();
            URL.revokeObjectURL(url);
        }
    } catch (e) {
        console.error("PDF Fail", e);
        alert("Failed to generate PDF");
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  const handleBatchDownloadPdf = async () => {
    const completed = files.filter(f => (f.status === 'editing' || f.status === 'completed') && f.result);
    if (completed.length === 0) return;

    setIsGeneratingPdf(true);
    try {
        const blobs: { name: string, blob: Blob }[] = [];
        
        // Sequentially generate to avoid browser lag
        for (const file of completed) {
             const elementId = `pdf-template-${file.id}`;
             const blob = await generatePdfFromElement(elementId, "");
             if (blob) {
                 blobs.push({ 
                     name: `${file.result!.program || 'model'}_${file.id}.pdf`, 
                     blob 
                 });
             }
        }
        
        if (blobs.length > 0) {
            await createZipFromBlobs(blobs);
        }
    } catch (e) {
        console.error("Batch PDF Fail", e);
        alert("Failed to generate batch PDFs");
    } finally {
        setIsGeneratingPdf(false);
    }
  };

  const currentPreviewFile = files.find(f => f.id === previewFileId);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 relative">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
             <div className="bg-indigo-600 text-white p-1.5 rounded-lg shadow-sm">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
             </div>
             <h1 className="text-xl font-bold text-slate-800">Logic Model Refiner <span className="text-xs font-normal text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full ml-2">SDP Edition</span></h1>
          </div>
          <div className="flex space-x-3">
            <button 
                onClick={handleBatchDownloadPdf}
                disabled={isGeneratingPdf || files.filter(f => f.result).length === 0}
                className="bg-white border border-gray-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-2"
            >
                {isGeneratingPdf ? <div className="animate-spin h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full"></div> : null}
                <span>Download All (ZIP)</span>
            </button>
            <button 
                onClick={handleExportCSV}
                className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50"
                disabled={files.length === 0}
            >
                Export CSV
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        <section className="text-center space-y-3 max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-slate-900 leading-tight">Extract & Refine Your Program Data</h2>
            <p className="text-slate-600">
                Upload logic models (PDF, Word, or PowerPoint). 
                AI detects structure and stakeholders. Generate <span className="font-bold text-[#0b315b]">SDP Branded PDFs</span> instantly.
            </p>
        </section>

        <section>
          <FileUpload onFilesSelected={handleFilesSelected} disabled={isProcessing} />
        </section>

        {files.length > 0 && (
          <div className="space-y-12">
            {files.map(file => (
              <div key={file.id} className="space-y-4">
                <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                   <div className="flex items-center space-x-3">
                      <span className="font-bold text-sm text-slate-700">{file.file.name}</span>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                        file.status === 'editing' || file.status === 'completed' ? 'bg-green-100 text-green-700' :
                        file.status === 'error' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {file.status}
                      </span>
                   </div>
                   {file.status === 'editing' && file.result && (
                     <div className="flex space-x-2">
                         <button 
                            onClick={() => setPreviewFileId(file.id)}
                            className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded transition-colors"
                         >
                            Preview PDF
                         </button>
                         <button 
                            onClick={() => handleDownloadSinglePdf(file)}
                            className="text-xs font-bold text-slate-600 hover:text-slate-800 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded transition-colors"
                         >
                            Download PDF
                         </button>
                     </div>
                   )}
                </div>

                {file.status === 'editing' && file.result && (
                  <LogicModelEditor 
                    model={file.result} 
                    onUpdate={(updated) => updateModel(file.id, updated)}
                    onReAnalyze={() => reAnalyzeModel(file.id)}
                    isAnalyzing={false}
                  />
                )}

                {(file.status === 'converting' || file.status === 'extracting' || file.status === 'analyzing') && (
                  <div className="bg-white border rounded-xl p-20 flex flex-col items-center justify-center space-y-4 shadow-sm">
                      <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent"></div>
                      <p className="font-bold text-slate-600">
                        {file.progressMsg || (file.status === 'converting' ? 'Reading Visual Layout...' : 'AI Analysis...')}
                      </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Hidden container for rendering PDFs */}
      <div style={{ position: 'absolute', top: -10000, left: -10000, pointerEvents: 'none' }}>
         {files.filter(f => f.result).map(f => (
             <LogicModelPdfTemplate key={f.id} id={`pdf-template-${f.id}`} model={f.result!} />
         ))}
      </div>

      {/* PDF Preview Modal */}
      {previewFileId && currentPreviewFile && currentPreviewFile.result && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
                <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
                    <h3 className="font-bold text-lg text-slate-800">Print Preview: {currentPreviewFile.result.program}</h3>
                    <div className="flex space-x-2">
                        <button 
                            onClick={() => handleDownloadSinglePdf(currentPreviewFile)}
                            className="bg-[#0b315b] text-white px-4 py-2 rounded font-bold text-sm hover:opacity-90"
                        >
                            Download PDF
                        </button>
                        <button 
                            onClick={() => setPreviewFileId(null)}
                            className="text-gray-500 hover:text-gray-700 px-4 py-2 font-bold text-sm"
                        >
                            Close
                        </button>
                    </div>
                </div>
                <div className="flex-1 overflow-auto bg-gray-200 p-8 flex justify-center">
                    {/* Render the template visible in the modal for preview */}
                    <div className="shadow-lg transform scale-90 origin-top">
                        <LogicModelPdfTemplate model={currentPreviewFile.result} />
                    </div>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default App;