import React, { useState, useEffect, useRef } from 'react';
import { ProcessingFile, LogicModel } from './types';
import FileUpload from './components/FileUpload';
import LogicModelEditor from './components/LogicModelEditor';
import { LogicModelPdfTemplate } from './components/LogicModelPdfTemplate';
import { extractLogicModel, critiqueLogicModel } from './services/geminiService';
import { countCodingExportRows, downloadCodingExportCsv } from './services/codingExport';
import { normalizeExtractedLogicModel } from './shared/extractNormalize';
import { buildGranularExportRows, sanitizeAbsentDomainCritiques } from './shared/domainPresence';
import { brand } from './config/brand';

function modelForExport(model: LogicModel): LogicModel {
  return sanitizeAbsentDomainCritiques(
    normalizeExtractedLogicModel(structuredClone(model))
  );
}

const STATUS_LABELS: Record<ProcessingFile['status'], string> = {
  pending: 'Queued',
  converting: 'Reading layout',
  extracting: 'Extracting',
  analyzing: 'Reviewing quality',
  editing: 'Ready to edit',
  completed: 'Ready to edit',
  error: 'Needs attention',
};

const friendlyError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || 'Something went wrong');
  if (/api key|401|unauthorized/i.test(message)) {
    return "Couldn't reach Gemini — check that GEMINI_API_KEY is set in .env.local.";
  }
  if (/429|rate|quota/i.test(message)) {
    return 'Gemini is rate-limiting requests. Wait a moment, then try again.';
  }
  if (/Failed to convert|Unsupported file format|vision/i.test(message)) {
    return "Couldn't read this document. Try a PDF, or a simpler DOCX/PPTX.";
  }
  return message;
};

const createFileId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [reAnalyzingId, setReAnalyzingId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const processingRef = useRef(false);

  const filesWithResults = files.filter(f => !!f.result);
  const exportReadyFiles = filesWithResults.filter(
    f => f.status === 'editing' || f.status === 'completed'
  );
  const exportReadyCount = exportReadyFiles.length;
  const codingExportRowCount = countCodingExportRows(exportReadyFiles);

  const handleFilesSelected = (newFiles: File[]) => {
    const newProcessingFiles: ProcessingFile[] = newFiles.map(file => ({
      id: createFileId(),
      file,
      status: 'pending',
    }));
    setFiles(prev => [...prev, ...newProcessingFiles]);
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    if (previewFileId === fileId) setPreviewFileId(null);
    if (reAnalyzingId === fileId) setReAnalyzingId(null);
  };

  const retryFile = (fileId: string) => {
    setFiles(prev =>
      prev.map(f =>
        f.id === fileId
          ? { ...f, status: 'pending', error: undefined, progressMsg: undefined }
          : f
      )
    );
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
        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'converting', error: undefined, progressMsg: 'Reading visual layout...' }
              : f
          )
        );

        let inputForGemini: string | string[];
        let textHint: string | undefined;
        const fileName = pendingFile.file.name.toLowerCase();

        try {
          const {
            convertPdfToImages,
            convertDocxToImages,
            convertPptxToImages,
            extractPdfFrontMatterText,
          } = await import('./services/fileService');

          if (fileName.endsWith('.pdf')) {
            const [images, frontMatter] = await Promise.all([
              convertPdfToImages(pendingFile.file),
              extractPdfFrontMatterText(pendingFile.file, 2),
            ]);
            inputForGemini = images;
            textHint = frontMatter || undefined;
          } else if (fileName.endsWith('.docx')) {
            inputForGemini = await convertDocxToImages(pendingFile.file);
          } else if (fileName.endsWith('.pptx')) {
            inputForGemini = await convertPptxToImages(pendingFile.file);
          } else {
            throw new Error('Unsupported format for vision');
          }
        } catch (visionError) {
          console.warn('Vision processing failed, falling back to text extraction:', visionError);
          const { convertFileToMarkdown } = await import('./services/fileService');
          inputForGemini = await convertFileToMarkdown(pendingFile.file);
          textHint = typeof inputForGemini === 'string' ? inputForGemini : undefined;
        }

        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'extracting', progressMsg: 'Extracting logic model structure...' }
              : f
          )
        );
        const extractedResult = normalizeExtractedLogicModel(
          await extractLogicModel(inputForGemini, { textHint }),
          { sourceText: textHint }
        );

        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'analyzing', progressMsg: 'Reviewing quality against guidance...' }
              : f
          )
        );
        const finalResult = sanitizeAbsentDomainCritiques(
          await critiqueLogicModel(extractedResult)
        );

        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'editing', result: finalResult, progressMsg: undefined, error: undefined }
              : f
          )
        );
      } catch (error: unknown) {
        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'error', error: friendlyError(error), progressMsg: undefined }
              : f
          )
        );
      } finally {
        processingRef.current = false;
        setIsProcessing(false);
      }
    };
    processQueue();
  }, [files, isProcessing]);

  const updateModel = (fileId: string, updatedModel: LogicModel) => {
    setFiles(prev => prev.map(f => (f.id === fileId ? { ...f, result: updatedModel } : f)));
  };

  const reAnalyzeModel = async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    if (!file || !file.result || reAnalyzingId) return;

    setReAnalyzingId(fileId);
    setFiles(prev =>
      prev.map(f =>
        f.id === fileId
          ? { ...f, status: 'editing', error: undefined, progressMsg: 'Re-evaluating your edits...' }
          : f
      )
    );

    try {
      const result = sanitizeAbsentDomainCritiques(await critiqueLogicModel(file.result));
      setFiles(prev =>
        prev.map(f =>
          f.id === fileId
            ? { ...f, status: 'editing', result, progressMsg: undefined, error: undefined }
            : f
        )
      );
    } catch (e: unknown) {
      setFiles(prev =>
        prev.map(f =>
          f.id === fileId
            ? {
                ...f,
                status: 'editing',
                error: friendlyError(e),
                progressMsg: undefined,
              }
            : f
        )
      );
    } finally {
      setReAnalyzingId(null);
    }
  };

  const handleExportCSV = () => {
    const completed = files.filter(f => (f.status === 'editing' || f.status === 'completed') && f.result);
    if (completed.length === 0) return;

    const headers = [
      'Organization',
      'Program',
      'Domain',
      'Group',
      'Content',
      'Domain Critique',
      'Domain Rating',
      'Item Critique',
      'Item Rating',
      'Overall Rating',
      'Overall Rationale',
    ];

    const exportRows = buildGranularExportRows(
      completed.map(f => modelForExport(f.result!))
    );
    const rows = exportRows.map(r => [
      r.organization,
      r.program,
      r.domain,
      r.group,
      r.content,
      r.domainCritique,
      r.domainRating,
      r.itemCritique,
      r.itemRating,
      r.overallRating,
      r.overallRationale,
    ]);

    const csvContent = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `logic_models_granular_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportForCoding = () => {
    const result = downloadCodingExportCsv(files);
    if (result.ok === false) {
      alert(result.reason);
    }
  };

  const handleDownloadSinglePdf = async (file: ProcessingFile) => {
    if (!file.result) return;
    setIsGeneratingPdf(true);
    try {
      const { generatePdfFromElement } = await import('./services/pdfService');
      const elementId = `pdf-template-${file.id}`;
      const blob = await generatePdfFromElement(elementId, `${file.result.program}.pdf`);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${file.result.program || 'logic_model'}_${brand.pdfFilenameSuffix}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        alert("Couldn't create the PDF — try Preview first, then download again.");
      }
    } catch (e) {
      console.error('PDF generation failed', e);
      alert("Couldn't create the PDF — try Preview first, then download again.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleBatchDownloadPdf = async () => {
    const completed = files.filter(f => (f.status === 'editing' || f.status === 'completed') && f.result);
    if (completed.length === 0) return;

    setIsGeneratingPdf(true);
    try {
      const { generatePdfFromElement, createZipFromBlobs } = await import('./services/pdfService');
      const blobs: { name: string; blob: Blob }[] = [];

      for (const file of completed) {
        const elementId = `pdf-template-${file.id}`;
        const blob = await generatePdfFromElement(elementId, '');
        if (blob) {
          blobs.push({
            name: `${file.result!.program || 'model'}_${file.id}.pdf`,
            blob,
          });
        }
      }

      if (blobs.length > 0) {
        await createZipFromBlobs(blobs);
      } else {
        alert("Couldn't create the ZIP — open Preview for each file, then try again.");
      }
    } catch (e) {
      console.error('Batch PDF failed', e);
      alert("Couldn't create the batch ZIP. Try downloading files one at a time.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  useEffect(() => {
    if (!previewFileId) return;

    const dialog = document.getElementById('pdf-preview-dialog');
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const closeButton = document.getElementById('pdf-preview-close');
    closeButton?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewFileId(null);
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(el => !el.hasAttribute('disabled') && el.tabIndex !== -1);

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [previewFileId]);

  const currentPreviewFile = files.find(f => f.id === previewFileId);
  const isPipelineBusy = (status: ProcessingFile['status']) =>
    status === 'converting' || status === 'extracting' || status === 'analyzing';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-20 relative">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 text-white p-1.5 rounded-lg shadow-sm">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800">
              {brand.productName}{' '}
              <span className="text-xs font-normal text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full ml-2">
                {brand.editionLabel}
              </span>
            </h1>
          </div>
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={handleBatchDownloadPdf}
              disabled={isGeneratingPdf || exportReadyCount === 0}
              className="bg-white border border-gray-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 flex items-center space-x-2"
            >
              {isGeneratingPdf ? (
                <div className="animate-spin h-3 w-3 border-2 border-slate-400 border-t-transparent rounded-full" aria-hidden="true" />
              ) : null}
              <span>Download All (ZIP)</span>
            </button>
            <button
              type="button"
              onClick={handleExportForCoding}
              className="bg-white border border-indigo-300 text-indigo-800 px-4 py-2 rounded-lg text-sm font-bold hover:bg-indigo-50 transition-colors shadow-sm disabled:opacity-50"
              disabled={codingExportRowCount === 0}
              title={
                codingExportRowCount === 0
                  ? 'Needs short-, medium-, or long-term outcome rows'
                  : `Export ${codingExportRowCount} outcome row(s) for Qualitative Outcomes Coder`
              }
            >
              Export for coding
            </button>
            <button
              type="button"
              onClick={handleExportCSV}
              className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50"
              disabled={exportReadyCount === 0}
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
            Upload logic models (PDF, Word, or PowerPoint). AI detects structure and stakeholders. Generate{' '}
            <span className="font-bold" style={{ color: brand.colors.primary }}>
              {brand.shortName} branded PDFs
            </span>{' '}
            instantly.
          </p>
        </section>

        <section>
          <FileUpload onFilesSelected={handleFilesSelected} />
        </section>

        {files.length > 0 && (
          <div className="space-y-12">
            {files.map(file => {
              const showEditor = !!file.result && (file.status === 'editing' || file.status === 'completed');
              const showPipelineSpinner = isPipelineBusy(file.status) && !file.result;

              return (
                <div key={file.id} className="space-y-4">
                  <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-lg border border-gray-200 shadow-sm">
                    <div className="flex items-center space-x-3 min-w-0">
                      <span className="font-bold text-sm text-slate-700 truncate">{file.file.name}</span>
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded shrink-0 ${
                          file.status === 'editing' || file.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : file.status === 'error'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {STATUS_LABELS[file.status]}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0">
                      {showEditor && (
                        <>
                          <button
                            type="button"
                            onClick={() => setPreviewFileId(file.id)}
                            className="text-xs font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded transition-colors"
                          >
                            Preview PDF
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadSinglePdf(file)}
                            className="text-xs font-bold text-slate-600 hover:text-slate-800 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded transition-colors"
                          >
                            Download PDF
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => removeFile(file.id)}
                        className="text-xs font-bold text-slate-500 hover:text-red-600 px-2 py-1.5"
                        aria-label={`Remove ${file.file.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {file.error && (
                    <div
                      className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                      role="alert"
                    >
                      <p className="text-sm font-medium">{file.error}</p>
                      <div className="flex space-x-2">
                        {(file.status === 'error' || !file.result) && (
                          <button
                            type="button"
                            onClick={() => retryFile(file.id)}
                            className="text-xs font-bold bg-red-700 text-white px-3 py-1.5 rounded hover:bg-red-800"
                          >
                            Retry
                          </button>
                        )}
                        {file.result && file.status === 'editing' && (
                          <button
                            type="button"
                            onClick={() => reAnalyzeModel(file.id)}
                            className="text-xs font-bold bg-red-700 text-white px-3 py-1.5 rounded hover:bg-red-800"
                          >
                            Retry critique
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(file.id)}
                          className="text-xs font-bold border border-red-300 text-red-800 px-3 py-1.5 rounded hover:bg-red-100"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}

                  {showEditor && file.result && (
                    <LogicModelEditor
                      model={file.result}
                      onUpdate={updated => updateModel(file.id, updated)}
                      onReAnalyze={() => reAnalyzeModel(file.id)}
                      isAnalyzing={reAnalyzingId === file.id}
                    />
                  )}

                  {showPipelineSpinner && (
                    <div className="bg-white border rounded-xl p-20 flex flex-col items-center justify-center space-y-4 shadow-sm" aria-live="polite">
                      <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-500 border-t-transparent" aria-hidden="true" />
                      <p className="font-bold text-slate-600">
                        {file.progressMsg || STATUS_LABELS[file.status]}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      <div style={{ position: 'absolute', top: -10000, left: -10000, pointerEvents: 'none' }} aria-hidden="true">
        {filesWithResults.map(f => (
          <LogicModelPdfTemplate key={f.id} id={`pdf-template-${f.id}`} model={modelForExport(f.result!)} />
        ))}
      </div>

      {previewFileId && currentPreviewFile && currentPreviewFile.result && (
        <div
          id="pdf-preview-dialog"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pdf-preview-title"
          onClick={e => {
            if (e.target === e.currentTarget) setPreviewFileId(null);
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
              <h3 id="pdf-preview-title" className="font-bold text-lg text-slate-800">
                Print Preview: {currentPreviewFile.result.program}
              </h3>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => handleDownloadSinglePdf(currentPreviewFile)}
                  className="text-white px-4 py-2 rounded font-bold text-sm hover:opacity-90"
                  style={{ backgroundColor: brand.colors.primary }}
                >
                  Download PDF
                </button>
                <button
                  id="pdf-preview-close"
                  type="button"
                  onClick={() => setPreviewFileId(null)}
                  className="text-gray-500 hover:text-gray-700 px-4 py-2 font-bold text-sm"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-200 p-8 flex justify-center">
              <div className="shadow-lg transform scale-90 origin-top">
                <LogicModelPdfTemplate model={modelForExport(currentPreviewFile.result)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
