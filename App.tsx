import React, { useState, useEffect, useRef } from 'react';
import { FULL_EXPORT_HEADERS, fullExportRowValues } from './shared/exportColumns';
import { flushSync } from 'react-dom';
import { ProcessingFile, LogicModel, DocumentBundle, bundleImpliesLowLegibility } from './types';
import FileUpload from './components/FileUpload';
import LogicModelEditor from './components/LogicModelEditor';
import SessionFileList from './components/SessionFileList';
import SourceDocumentPane, { type HighlightRegion, type SourceFocus } from './components/SourceDocumentPane';
import { LogicModelPdfTemplate, PDF_PAGE_WIDTH_PX } from './components/LogicModelPdfTemplate';
import { detectLogicModelGroups, extractLogicModel } from './services/geminiService';
import { countCodingExportRows, downloadCodingExportCsv } from './services/codingExport';
import { countExtractionLogRows, downloadExtractionLogCsv } from './services/extractionLogExport';
import { normalizeExtractedLogicModel } from './shared/extractNormalize';
import { buildGranularExportRows } from './shared/domainPresence';
import { sliceDocumentBundle } from './shared/documentBundleSlicing';
import { displayFileName, PROCESSING_STATUS_LABELS } from './shared/processingFileDisplay';
import {
  retainRegressionBundle,
  retainRegressionExtraction,
  type RegressionCaptureGlobals,
  type RetainedExtraction,
} from './shared/regressionCapture';
import { brand } from './config/brand';
import { shouldSuggestMismatch } from './shared/sourceMapping';
import {
  formatHardStopMessage,
  shouldHardStopExtraction,
  shouldSoftGateCodingExport,
} from './shared/extractionFidelity';
import {
  countSessionFiles,
  exportWouldOmitFiles,
  formatSessionStatus,
  isExportReady,
  isPipelineBusy,
  sessionProgressFraction,
} from './shared/sessionQueue';
import {
  clearAll as clearSavedSession,
  deleteFile as deleteSavedFile,
  loadAll as loadSavedFiles,
  saveFile as saveSessionFile,
  type PersistedFileRecord,
} from './services/sessionStore';

function modelForExport(model: LogicModel, warnings?: string[]): LogicModel {
  return normalizeExtractedLogicModel(structuredClone(model), {
    lowLegibility: bundleImpliesLowLegibility({ warnings: warnings ?? [] }),
  });
}

/** Checkpoint-relevant fields only — excludes transient/session-only data (previews, progress text). */
function toPersistedRecord(f: ProcessingFile): PersistedFileRecord {
  return {
    id: f.id,
    file: f.file,
    status:
      f.status === 'converting' || f.status === 'detecting' || f.status === 'extracting'
        ? 'pending'
        : f.status,
    result: f.result,
    warnings: f.warnings,
    extractionBlockers: f.extractionBlockers,
    error: f.error,
    mismatchBannerDismissed: f.mismatchBannerDismissed,
    fidelityBannerDismissed: f.fidelityBannerDismissed,
    codingExportFidelityAck: f.codingExportFidelityAck,
    sourcePaneCollapsed: f.sourcePaneCollapsed,
    sourceDocumentId: f.sourceDocumentId,
    sourcePageRange: f.sourcePageRange,
    splitPartLabel: f.splitPartLabel,
    forceSingleModel: f.forceSingleModel,
    promptVersion: f.promptVersion,
    promptVariant: f.promptVariant,
  };
}

/**
 * Resolve `LogicModel.possiblyMissedRegions` (Gemini's own self-report; see
 * `shared/extractionFidelity.ts`) down to plain fractions for `SourceDocumentPane`. `xStart`/`xEnd`
 * are Gemini's own estimate of the region's horizontal span — a region it couldn't estimate one for
 * has no `xStart`/`xEnd` and is dropped rather than drawn as a full-page box, since that would convey
 * nothing the page-jump chip doesn't already say. (The chip itself still shows for every flagged page
 * regardless.)
 */
function resolveHighlightRegions(file: ProcessingFile): HighlightRegion[] {
  const regions = file.result?.possiblyMissedRegions;
  if (!regions || regions.length === 0) return [];
  return regions
    .filter(region => typeof region.xStart === 'number' && typeof region.xEnd === 'number')
    .map(region => ({
      page: region.page,
      leftFrac: region.xStart!,
      widthFrac: Math.max(0, region.xEnd! - region.xStart!),
      note: region.note,
    }));
}

function hashPersistedRecord(record: PersistedFileRecord): string {
  return JSON.stringify(record, (key, value) => (key === 'file' ? undefined : value));
}

function persistedRecordToProcessingFile(record: PersistedFileRecord): ProcessingFile {
  return {
    id: record.id,
    file: record.file,
    status: record.status,
    result: record.result,
    warnings: record.warnings,
    extractionBlockers: record.extractionBlockers,
    error: record.error,
    mismatchBannerDismissed: record.mismatchBannerDismissed,
    fidelityBannerDismissed: record.fidelityBannerDismissed,
    codingExportFidelityAck: record.codingExportFidelityAck,
    sourcePaneCollapsed: record.sourcePaneCollapsed,
    sourceDocumentId: record.sourceDocumentId,
    sourcePageRange: record.sourcePageRange,
    splitPartLabel: record.splitPartLabel,
    forceSingleModel: record.forceSingleModel,
    promptVersion: record.promptVersion,
    promptVariant: record.promptVariant,
  };
}

// Applies independently to each pipeline stage (extract, detect) via its own counter below — up to
// this many detects AND up to this many extracts can run at once, so total concurrent Gemini calls
// can reach 2x this value, not this value. The name/comments here used to claim a single, batch-wide
// cap of 2 — found via codebase audit (docs/specs/codebase-audit-2026-09-19.md #23). Whether 4
// concurrent Gemini calls is the right ceiling is a product call or not; this fix is renaming/
// documenting reality, not changing it.
/**
 * Dev-only: keep the exact bundle sent to the server, and the extraction that came back, so they
 * can be saved as a Tier-1 regression fixture (`fixtures/regression-set/`). Conversion is
 * browser-only — pdfjs, canvas and html2canvas have no Node equivalent here — so this is the only
 * place a real bundle can be captured, which is why the regression runner replays bundles rather
 * than source files.
 *
 * The extraction is retained for a different reason: building a bundle already costs one Gemini
 * extract call, but the result only reached React state, where `scripts/capture-bundles.mjs`
 * cannot see it — so the script re-extracted the same bundle over HTTP and paid a second call per
 * document, 206 across the corpus where 103 would do. Keyed to match its bundle so the script
 * takes both in one pass. See docs/specs/local-capture-session.md §2.
 *
 * In the browser console:
 *   __lmRegressionBundles                    // names captured this session
 *   __lmRegressionExtractions                // the extraction for each, same names
 *   __lmSaveRegressionBundle('<name>')       // downloads one as JSON
 *   __lmSaveRegressionExtraction('<name>')   // downloads its extraction as JSON
 *
 * Compiled out of production builds: `import.meta.env.DEV` is statically false there, so neither
 * the retained captures nor the globals exist in an `npm start` build.
 */
type RegressionCaptureWindow = RegressionCaptureGlobals & {
  __lmSaveRegressionBundle?: (name: string) => void;
  __lmSaveRegressionExtraction?: (name: string) => void;
};

/**
 * Installs one of the two `__lmSaveRegression*` download helpers. Both halves download the same
 * way, so the DOM dance lives here once; `read` is a getter rather than the map itself because the
 * helper outlives the call that installed it and must see later captures, not the map as it was on
 * the first document.
 */
function installRegressionSaveHelper(
  w: RegressionCaptureWindow,
  prop: '__lmSaveRegressionBundle' | '__lmSaveRegressionExtraction',
  read: () => Record<string, unknown> | undefined,
  label: 'bundle' | 'extraction',
  fileSuffix: string
): void {
  w[prop] ??= (name: string) => {
    const target = read()?.[name];
    if (!target) {
      console.warn(`No captured ${label} "${name}". Available:`, Object.keys(read() ?? {}));
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(target)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}${fileSuffix}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
}

function captureRegressionBundle(file: ProcessingFile | undefined, bundle: DocumentBundle): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const w = window as unknown as RegressionCaptureWindow;
  retainRegressionBundle(w, file, bundle);
  installRegressionSaveHelper(w, '__lmSaveRegressionBundle', () => w.__lmRegressionBundles, 'bundle', '');
}

/**
 * Retained even when the extraction hard-stops on fidelity: "this source was refused, and here are
 * the blockers" is a result worth auditing, and dropping it would make the capture script wait out
 * its full deadline for a document that is never coming.
 */
function captureRegressionExtraction(
  file: ProcessingFile | undefined,
  bundle: DocumentBundle,
  extraction: RetainedExtraction
): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const w = window as unknown as RegressionCaptureWindow;
  retainRegressionExtraction(w, file, bundle, extraction);
  installRegressionSaveHelper(
    w,
    '__lmSaveRegressionExtraction',
    () => w.__lmRegressionExtractions,
    'extraction',
    '-extraction'
  );
}

const MAX_CONCURRENT_PER_STAGE = 2;
const PERSIST_DEBOUNCE_MS = 1200;

const friendlyError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || 'Something went wrong');
  if (/api key|401|unauthorized/i.test(message)) {
    return "Couldn't reach Gemini — check that GEMINI_API_KEY is set in .env.local.";
  }
  if (/429|rate|quota/i.test(message)) {
    return 'Gemini is rate-limiting requests. Wait a moment, then try again.';
  }
  if (/\b404\b|not found/i.test(message)) {
    return 'The API endpoint was not found. If this is a hosted deployment, confirm the /api functions deployed.';
  }
  if (/\b413\b|payload too large|request entity too large/i.test(message)) {
    return 'This document is too large for the hosted upload limit. Try a shorter PDF or run locally.';
  }
  if (/Failed to convert|Unsupported file format|vision/i.test(message)) {
    return "Couldn't read this document. Try a PDF, or a simpler DOCX/PPTX.";
  }
  return message;
};

const PREVIEW_GUTTER_PX = 32;

const createFileId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const App: React.FC = () => {
  const [files, setFiles] = useState<ProcessingFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [pdfCaptureFileId, setPdfCaptureFileId] = useState<string | null>(null);
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const previewViewportRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);
  /** Per-file source pane focus (page jump from item select). */
  const [sourceFocusByFileId, setSourceFocusByFileId] = useState<Record<string, SourceFocus | null>>(
    {}
  );

  // Batch processing pipeline coordination — see docs/specs for the pipelined-concurrency design.
  const convertingRef = useRef(false);
  const extractingCountRef = useRef(0);
  const dispatchedExtractIds = useRef<Set<string>>(new Set());
  const pendingBundles = useRef<Record<string, DocumentBundle>>({});
  const regeneratingPreviewsRef = useRef<Set<string>>(new Set());
  /**
   * Resumed split siblings (same `sourceDocumentId`) each re-convert the shared source PDF/DOCX
   * independently in `ensurePreviewImages` below — opening the source pane on each of N split parts
   * re-ran the full conversion N times. `multi-logic-model-pdf-v1.md` §4 always specified a
   * sourceDocumentId-keyed dedupe for exactly this; it existed for the IndexedDB blob but not for
   * this in-memory reconversion path — found via codebase audit
   * (docs/specs/codebase-audit-2026-09-19.md #22). Keyed by sourceDocumentId, holding the
   * *unsliced* bundle so each sibling can still re-slice to its own pageRange.
   */
  const sourceDocumentPreviewCache = useRef<Map<string, DocumentBundle>>(new Map());
  // Multi-logic-model detection — see docs/specs/multi-logic-model-pdf-v1.md.
  const detectingCountRef = useRef(0);
  const dispatchedDetectIds = useRef<Set<string>>(new Set());

  // Session checkpoint/resume — see docs/specs for the persistence design.
  const [resumeState, setResumeState] = useState<'checking' | 'prompt' | 'none'>('checking');
  const [pendingResumeRecords, setPendingResumeRecords] = useState<PersistedFileRecord[] | null>(
    null
  );
  const persistTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const lastPersistedHash = useRef<Map<string, string>>(new Map());
  /** Session-only: a checkpoint write failed (e.g. storage quota) — surfaced once, non-blocking. */
  const [persistWarning, setPersistWarning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const records = await loadSavedFiles();
      if (cancelled) return;
      if (records.length > 0) {
        setPendingResumeRecords(records);
        setResumeState('prompt');
      } else {
        setResumeState('none');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResumeSession = () => {
    if (!pendingResumeRecords) return;
    const restored = pendingResumeRecords.map(persistedRecordToProcessingFile);
    for (const record of pendingResumeRecords) {
      lastPersistedHash.current.set(record.id, hashPersistedRecord(record));
    }
    setFiles(restored);
    setPendingResumeRecords(null);
    setResumeState('none');
  };

  const handleDiscardSession = async () => {
    await clearSavedSession();
    setPendingResumeRecords(null);
    setResumeState('none');
  };

  // Debounced checkpoint: persists any file not mid-flight (converting/extracting resolve to
  // 'pending' on reload anyway, so there's nothing useful to checkpoint mid-transition).
  useEffect(() => {
    if (resumeState !== 'none') return;
    for (const f of files) {
      if (f.status === 'converting' || f.status === 'detecting' || f.status === 'extracting') continue;
      const record = toPersistedRecord(f);
      const hash = hashPersistedRecord(record);
      if (lastPersistedHash.current.get(f.id) === hash) continue;

      const existing = persistTimers.current.get(f.id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        lastPersistedHash.current.set(f.id, hash);
        persistTimers.current.delete(f.id);
        saveSessionFile(record).catch(err => {
          console.error('Failed to save file for session resume:', err);
          setPersistWarning(true);
        });
      }, PERSIST_DEBOUNCE_MS);
      persistTimers.current.set(f.id, timer);
    }
  }, [files, resumeState]);

  const sessionCounts = countSessionFiles(files);
  const exportReadyFiles = files.filter(f => isExportReady(f.status) && f.result);
  const exportReadyCount = exportReadyFiles.length;
  const codingExportRowCount = countCodingExportRows(exportReadyFiles);
  const extractionLogRowCount = countExtractionLogRows(files);
  const selectedFile = files.find(f => f.id === selectedFileId) ?? null;
  const pdfCaptureFile =
    files.find(f => f.id === pdfCaptureFileId && f.result) ??
    (selectedFile?.result ? selectedFile : null);

  const handleFilesSelected = (newFiles: File[]) => {
    const newProcessingFiles: ProcessingFile[] = newFiles.map(file => ({
      id: createFileId(),
      file,
      status: 'pending',
    }));
    setFiles(prev => [...prev, ...newProcessingFiles]);
  };

  const removeFile = (fileId: string) => {
    const removed = files.find(f => f.id === fileId);
    setFiles(prev => prev.filter(f => f.id !== fileId));
    if (selectedFileId === fileId) setSelectedFileId(null);
    if (previewFileId === fileId) setPreviewFileId(null);
    setSourceFocusByFileId(prev => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
    const timer = persistTimers.current.get(fileId);
    if (timer) clearTimeout(timer);
    persistTimers.current.delete(fileId);
    lastPersistedHash.current.delete(fileId);
    void deleteSavedFile(fileId);
    // Drop the shared preview cache once no split sibling for this source document is left.
    const cacheKey = removed?.sourceDocumentId;
    if (cacheKey && !files.some(f => f.id !== fileId && f.sourceDocumentId === cacheKey)) {
      sourceDocumentPreviewCache.current.delete(cacheKey);
    }
  };

  /**
   * Cheap escape hatch for a wrong multi-logic-model split (see
   * docs/specs/multi-logic-model-pdf-v1.md Design §7): remove every sibling split from the same
   * upload and re-queue one fresh entry with `forceSingleModel` set, so it skips detection
   * entirely and is extracted exactly like the pipeline behaved before this feature existed.
   */
  const treatAsSingleModel = (fileId: string) => {
    setFiles(prev => {
      const target = prev.find(f => f.id === fileId);
      if (!target) return prev;
      const groupId = target.sourceDocumentId ?? fileId;
      const isSibling = (f: ProcessingFile) => (f.sourceDocumentId ?? f.id) === groupId;
      sourceDocumentPreviewCache.current.delete(groupId);
      for (const sibling of prev.filter(isSibling)) {
        if (selectedFileId === sibling.id) setSelectedFileId(null);
        if (previewFileId === sibling.id) setPreviewFileId(null);
        setSourceFocusByFileId(sfPrev => {
          const next = { ...sfPrev };
          delete next[sibling.id];
          return next;
        });
        const timer = persistTimers.current.get(sibling.id);
        if (timer) clearTimeout(timer);
        persistTimers.current.delete(sibling.id);
        lastPersistedHash.current.delete(sibling.id);
        void deleteSavedFile(sibling.id);
      }
      const rebuilt: ProcessingFile = {
        id: createFileId(),
        file: target.file,
        status: 'pending',
        forceSingleModel: true,
      };
      const firstIndex = prev.findIndex(isSibling);
      const kept = prev.filter(f => !isSibling(f));
      const insertAt = prev.slice(0, firstIndex).filter(f => !isSibling(f)).length;
      return [...kept.slice(0, insertAt), rebuilt, ...kept.slice(insertAt)];
    });
  };

  const retryFile = (fileId: string) => {
    setFiles(prev =>
      prev.map(f =>
        f.id === fileId
          ? {
              ...f,
              status: 'pending',
              error: undefined,
              progressMsg: undefined,
              sourcePreviewImages: undefined,
              sourcePaneCollapsed: undefined,
              extractionBlockers: undefined,
              fidelityBannerDismissed: undefined,
              codingExportFidelityAck: undefined,
              mismatchBannerDismissed: undefined,
            }
          : f
      )
    );
    setSourceFocusByFileId(prev => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  };

  // Pipelined batch processing: conversion (CPU-heavy canvas rendering) stays strictly serial —
  // running several concurrently would just contend for the same resources — but a file's extract
  // call (mostly network wait) no longer blocks the next file's conversion from starting. Extract
  // calls overlap in the background, bounded by MAX_CONCURRENT_PER_STAGE so the batch doesn't
  // hammer Gemini; existing per-call retry/backoff absorbs any rate-limit hiccups this surfaces.
  useEffect(() => {
    const startConversion = async () => {
      if (convertingRef.current) return;
      const pendingFile = files.find(f => f.status === 'pending');
      if (!pendingFile) return;

      convertingRef.current = true;
      const fileId = pendingFile.id;

      try {
        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? { ...f, status: 'converting', error: undefined, progressMsg: 'Reading visual layout...' }
              : f
          )
        );

        let bundle: DocumentBundle;
        const fileName = pendingFile.file.name.toLowerCase();

        try {
          const {
            convertPdfToImages,
            convertDocxToImages,
            convertPptxToImages,
            convertImageToBundle,
            convertXlsxToBundle,
          } = await import('./services/fileService');

          if (fileName.endsWith('.pdf')) {
            bundle = await convertPdfToImages(pendingFile.file);
          } else if (fileName.endsWith('.docx')) {
            bundle = await convertDocxToImages(pendingFile.file);
          } else if (fileName.endsWith('.pptx')) {
            bundle = await convertPptxToImages(pendingFile.file);
          } else if (/\.(png|jpe?g)$/.test(fileName)) {
            // A logic model uploaded as a picture: one raster, no text layer (vision-only variant).
            bundle = await convertImageToBundle(pendingFile.file);
          } else if (fileName.endsWith('.xlsx')) {
            // A workbook has no pages to rasterise; its grid becomes Markdown tables (text-only).
            bundle = await convertXlsxToBundle(pendingFile.file);
          } else {
            throw new Error('Unsupported format for vision');
          }
        } catch (visionError) {
          console.warn('Vision processing failed, falling back to text extraction:', visionError);
          const {
            convertFileToMarkdown,
            sourceFormatFromFileName,
            textOnlyDocumentBundle,
          } = await import('./services/fileService');
          const textTrack = await convertFileToMarkdown(pendingFile.file);
          bundle = textOnlyDocumentBundle(
            textTrack,
            sourceFormatFromFileName(pendingFile.file.name),
            [
              "Couldn't read this document as images, so it was analyzed as plain text. Layout-based grouping may be less accurate — verify the results.",
            ]
          );
        }

        // A re-queued split part (Retry) already knows its own page range within the shared
        // original document — slice down to it now, once, rather than re-detecting or extracting
        // the whole document again. See docs/specs/multi-logic-model-pdf-v1.md.
        if (pendingFile.sourcePageRange) {
          bundle = sliceDocumentBundle(bundle, pendingFile.sourcePageRange);
        }

        const pageCount = bundle.previewImages?.length ?? 0;
        const skipDetection =
          Boolean(pendingFile.sourcePageRange) || Boolean(pendingFile.forceSingleModel) || pageCount < 2;

        pendingBundles.current[fileId] = bundle;
        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? {
                  ...f,
                  status: skipDetection ? 'extracting' : 'detecting',
                  progressMsg: skipDetection
                    ? 'Extracting logic model structure...'
                    : 'Checking for multiple logic models...',
                  warnings: bundle.warnings.length ? bundle.warnings : undefined,
                  // Keep page previews for side-by-side review; do not upload them to Gemini.
                  sourcePreviewImages:
                    bundle.previewImages && bundle.previewImages.length > 0
                      ? bundle.previewImages
                      : undefined,
                  // Editor-primary: source stays hidden until mismatch/fidelity or explicit show.
                  sourcePaneCollapsed: true,
                }
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
        convertingRef.current = false;
      }
    };

    const runExtraction = async (fileId: string, bundle: DocumentBundle) => {
      try {
        const extractBundle: DocumentBundle = { ...bundle, previewImages: undefined };
        captureRegressionBundle(files.find(f => f.id === fileId), extractBundle);
        // `extractLogicModel` always calls the server (`/api/gemini/extract`), which already runs
        // `normalizeExtractedLogicModel` on the raw Gemini response (server/geminiLogicModel.ts)
        // before returning it — using the same `bundleImpliesLowLegibility`/`bundleUsedTextOnlyFallback`
        // functions on the same bundle fields this file sent over the wire. Re-normalizing here was a
        // pure duplicate: same computation, same inputs, on an already-normalized model — safe today
        // only because normalize happens to be idempotent, not because it does anything new. Removed
        // rather than kept "just in case" — found via codebase audit
        // (docs/specs/codebase-audit-2026-09-19.md #11); see that finding for the fragility this
        // avoids (a second pass re-reading derived blockers as if Gemini-reported, and a sourceText
        // trim mismatch between the two call sites).
        //
        // The server also reports which prompt it used, so the extraction log can attribute a
        // result to an exact PROMPT_VERSION + variant rather than pooling unlike documents.
        const { model: extractedResult, promptVersion, promptVariant } =
          await extractLogicModel(extractBundle);
        captureRegressionExtraction(files.find(f => f.id === fileId), extractBundle, {
          model: extractedResult,
          promptVersion,
          promptVariant,
        });

        if (shouldHardStopExtraction(extractedResult)) {
          const blockers = extractedResult.extractionBlockers ?? [];
          setFiles(prev =>
            prev.map(f =>
              f.id === fileId
                ? {
                    ...f,
                    status: 'error',
                    error: formatHardStopMessage(blockers),
                    extractionBlockers: blockers.length
                      ? blockers
                      : ['Source could not be read reliably enough to continue'],
                    result: undefined,
                    progressMsg: undefined,
                  }
                : f
            )
          );
          return;
        }

        // Same "partial or medium" rule as the coding-export gate — reuse it so the banner, the
        // export gate, and this auto-open behavior can't drift apart (codebase-audit-2026-09-19.md #7).
        const fidelityNeedsReview = shouldSoftGateCodingExport(extractedResult);

        setFiles(prev =>
          prev.map(f =>
            f.id === fileId
              ? {
                  ...f,
                  status: 'editing',
                  result: extractedResult,
                  promptVersion,
                  promptVariant,
                  progressMsg: undefined,
                  error: undefined,
                  extractionBlockers: undefined,
                  // Auto-open source when mismatch or medium fidelity.
                  sourcePaneCollapsed:
                    shouldSuggestMismatch(extractedResult) || fidelityNeedsReview
                      ? false
                      : f.sourcePaneCollapsed,
                }
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
        delete pendingBundles.current[fileId];
        dispatchedExtractIds.current.delete(fileId);
        extractingCountRef.current -= 1;
      }
    };

    const startExtractions = () => {
      for (const f of files) {
        if (f.status !== 'extracting') continue;
        if (dispatchedExtractIds.current.has(f.id)) continue;
        if (extractingCountRef.current >= MAX_CONCURRENT_PER_STAGE) break;
        const bundle = pendingBundles.current[f.id];
        if (!bundle) continue; // conversion result not yet stashed on this pass
        dispatchedExtractIds.current.add(f.id);
        extractingCountRef.current += 1;
        void runExtraction(f.id, bundle);
      }
    };

    // Cheap pre-pass: decide whether a converted, multi-page bundle actually holds one logic
    // model or several before running the real extraction — see
    // docs/specs/multi-logic-model-pdf-v1.md. Biased hard toward "still one" both in the prompt
    // and here: any detection failure (network error, malformed response) falls back to treating
    // the document as a single logic model, exactly like the pipeline behaved before this existed.
    const runDetection = async (fileId: string, bundle: DocumentBundle) => {
      try {
        const pageCount = bundle.previewImages?.length ?? 0;
        let groups = [{ startPage: 1, endPage: Math.max(1, pageCount) }];
        if (pageCount >= 2 && bundle.previewImages) {
          try {
            groups = await detectLogicModelGroups({
              previewImages: bundle.previewImages,
              textTrack: bundle.textTrack,
              sourceFormat: bundle.sourceFormat,
            });
          } catch (detectError) {
            console.warn(
              'Multi-logic-model detection failed; treating as a single logic model:',
              detectError
            );
          }
        }

        if (groups.length <= 1) {
          setFiles(prev =>
            prev.map(f =>
              f.id === fileId
                ? { ...f, status: 'extracting', progressMsg: 'Extracting logic model structure...' }
                : f
            )
          );
          return;
        }

        // Multiple logic models — replace the single pending entry with N independent ones, each
        // carrying its own renumbered slice of the already-converted bundle (no re-conversion, no
        // new PDF-splitting dependency — see the spec doc's Design §2).
        setFiles(prev => {
          const original = prev.find(f => f.id === fileId);
          if (!original) return prev;
          const total = groups.length;
          const sourceDocumentId = original.sourceDocumentId ?? fileId;
          const splitEntries: ProcessingFile[] = groups.map((group, i) => {
            const newId = createFileId();
            const subBundle = sliceDocumentBundle(bundle, { start: group.startPage, end: group.endPage });
            pendingBundles.current[newId] = subBundle;
            return {
              id: newId,
              file: original.file,
              status: 'extracting',
              progressMsg: 'Extracting logic model structure...',
              warnings: subBundle.warnings.length ? subBundle.warnings : undefined,
              sourcePreviewImages:
                subBundle.previewImages && subBundle.previewImages.length > 0
                  ? subBundle.previewImages
                  : undefined,
              sourcePaneCollapsed: true,
              sourceDocumentId,
              sourcePageRange: { start: group.startPage, end: group.endPage },
              splitPartLabel: `Part ${i + 1} of ${total}`,
            };
          });
          return prev.flatMap(f => (f.id === fileId ? splitEntries : f));
        });
        // Only reached on an actual split — the original id no longer has an entry in `files`, so
        // its stashed bundle would otherwise leak. The single-group case returns above without
        // reaching here, deliberately leaving pendingBundles.current[fileId] in place for
        // startExtractions() to pick up next.
        delete pendingBundles.current[fileId];
      } finally {
        dispatchedDetectIds.current.delete(fileId);
        detectingCountRef.current -= 1;
      }
    };

    const startDetections = () => {
      for (const f of files) {
        if (f.status !== 'detecting') continue;
        if (dispatchedDetectIds.current.has(f.id)) continue;
        if (detectingCountRef.current >= MAX_CONCURRENT_PER_STAGE) break;
        const bundle = pendingBundles.current[f.id];
        if (!bundle) continue; // conversion result not yet stashed on this pass
        dispatchedDetectIds.current.add(f.id);
        detectingCountRef.current += 1;
        void runDetection(f.id, bundle);
      }
    };

    startConversion();
    startDetections();
    startExtractions();
  }, [files]);

  const updateModel = (fileId: string, updatedModel: LogicModel) => {
    setFiles(prev => prev.map(f => (f.id === fileId ? { ...f, result: updatedModel } : f)));
  };

  /**
   * Resumed files don't carry cached source previews (only the original File is checkpointed —
   * see services/sessionStore.ts). Regenerate them lazily, only when the source pane is actually
   * opened for that file, rather than eagerly reconverting every resumed file upfront.
   */
  const ensurePreviewImages = async (fileId: string) => {
    const target = files.find(f => f.id === fileId);
    if (!target || (target.sourcePreviewImages && target.sourcePreviewImages.length > 0)) return;
    if (regeneratingPreviewsRef.current.has(fileId)) return;
    regeneratingPreviewsRef.current.add(fileId);
    try {
      const cacheKey = target.sourceDocumentId;
      let bundle: DocumentBundle | undefined = cacheKey
        ? sourceDocumentPreviewCache.current.get(cacheKey)
        : undefined;
      if (!bundle) {
        const { convertPdfToImages, convertDocxToImages, convertPptxToImages } = await import(
          './services/fileService'
        );
        const fileName = target.file.name.toLowerCase();
        if (fileName.endsWith('.pdf')) bundle = await convertPdfToImages(target.file);
        else if (fileName.endsWith('.docx')) bundle = await convertDocxToImages(target.file);
        else if (fileName.endsWith('.pptx')) bundle = await convertPptxToImages(target.file);
        else return;
        // Cache the unsliced bundle for any other split sibling sharing this source document,
        // so re-opening N split parts' source panes converts the shared PDF/DOCX once, not N times.
        if (cacheKey) sourceDocumentPreviewCache.current.set(cacheKey, bundle);
      }
      // A resumed split entry only knows its own page range within the shared original file —
      // slice back down to it (same as the live pipeline does on first conversion).
      if (target.sourcePageRange) bundle = sliceDocumentBundle(bundle, target.sourcePageRange);
      if (bundle.previewImages && bundle.previewImages.length > 0) {
        const previews = bundle.previewImages;
        setFiles(prev =>
          prev.map(f => (f.id === fileId ? { ...f, sourcePreviewImages: previews } : f))
        );
      }
    } catch (e) {
      console.warn('Failed to regenerate source previews for resumed file', e);
    } finally {
      regeneratingPreviewsRef.current.delete(fileId);
    }
  };

  const confirmIncompleteExport = (kind: string): boolean => {
    if (!exportWouldOmitFiles(sessionCounts)) return true;
    const omitted = sessionCounts.total - sessionCounts.ready;
    return window.confirm(
      `${kind} includes ${sessionCounts.ready} of ${sessionCounts.total} files. ${omitted} ${
        omitted === 1 ? 'is' : 'are'
      } still queued, running, or need attention. Continue?`
    );
  };

  const mountPdfTemplate = (fileId: string) => {
    flushSync(() => setPdfCaptureFileId(fileId));
  };

  const handleExportCSV = () => {
    const completed = files.filter(f => isExportReady(f.status) && f.result);
    if (completed.length === 0) return;
    if (!confirmIncompleteExport('CSV export')) return;

    // Column headers and their row fields live together in `shared/exportColumns.ts`. They used
    // to be two parallel arrays here, which is how a removed column silently shifts every column
    // to its right. Do not reintroduce a second list.
    const headers = FULL_EXPORT_HEADERS;

    const exportRows = buildGranularExportRows(
      completed.map(f => ({
        model: modelForExport(f.result!, f.warnings),
        sourceFilename: displayFileName(f),
        fileId: f.id,
      }))
    );
    const rows = exportRows.map(fullExportRowValues);

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
    if (!confirmIncompleteExport('Export for coding')) return;
    const gated = exportReadyFiles.filter(
      f => f.result && shouldSoftGateCodingExport(f.result) && !f.codingExportFidelityAck
    );
    if (gated.length > 0) {
      const confirmed = window.confirm(
        gated.length === 1
          ? 'Extraction fidelity is partial — export for coding anyway?'
          : `Extraction fidelity is partial for ${gated.length} files. Export for coding anyway?`
      );
      if (!confirmed) return;
      const gatedIds = new Set(gated.map(g => g.id));
      setFiles(prev =>
        prev.map(f => (gatedIds.has(f.id) ? { ...f, codingExportFidelityAck: true } : f))
      );
    }
    const result = downloadCodingExportCsv(files);
    if (result.ok === false) {
      alert(result.reason);
    }
  };

  /**
   * Not partner-facing — a per-document QA log (one row per file: fidelity status, blockers,
   * counts) for diagnosing extraction quality across a batch. See
   * docs/specs/extraction-log-export-v1.md.
   */
  const handleExportExtractionLog = () => {
    const result = downloadExtractionLogCsv(files);
    if (result.ok === false) {
      alert(result.reason);
    }
  };

  const handleDownloadSinglePdf = async (file: ProcessingFile) => {
    if (!file.result) return;
    setIsGeneratingPdf(true);
    try {
      mountPdfTemplate(file.id);
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
        alert("Couldn't create the PDF. Try again.");
      }
    } catch (e) {
      console.error('PDF generation failed', e);
      alert("Couldn't create the PDF. Try again.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleBatchDownloadPdf = async () => {
    const completed = files.filter(f => isExportReady(f.status) && f.result);
    if (completed.length === 0) return;
    if (!confirmIncompleteExport('This ZIP')) return;

    setIsGeneratingPdf(true);
    try {
      const { generatePdfFromElement, createZipFromBlobs } = await import('./services/pdfService');
      const blobs: { name: string; blob: Blob }[] = [];

      for (const file of completed) {
        mountPdfTemplate(file.id);
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
        alert("Couldn't create the ZIP. Try downloading files one at a time.");
      }
    } catch (e) {
      console.error('Batch PDF failed', e);
      alert("Couldn't create the batch ZIP. Try downloading files one at a time.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // The template is a fixed 1400px wide, so scale it down to whatever the modal allows.
  // Without this the page overflows a centred flex container and clips on both sides.
  useEffect(() => {
    if (!previewFileId) return;
    const viewport = previewViewportRef.current;
    if (!viewport) return;

    const updateScale = () => {
      const available = viewport.clientWidth - PREVIEW_GUTTER_PX * 2;
      if (available <= 0) return;
      setPreviewScale(Math.min(1, available / PDF_PAGE_WIDTH_PX));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [previewFileId]);

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
  const zipLabel =
    exportReadyCount === 0
      ? 'Download PDFs (ZIP)'
      : exportReadyCount === sessionCounts.total
        ? 'Download all PDFs (ZIP)'
        : `Download ${exportReadyCount} PDF${exportReadyCount === 1 ? '' : 's'} (ZIP)`;
  const csvLabel = `Export CSV (${exportReadyCount})`;
  const file = selectedFile;
  const showEditor = !!file?.result && isExportReady(file.status);
  const showPipelineSpinner = !!file && isPipelineBusy(file.status) && !file.result;

  if (resumeState === 'checking') {
    return (
      <div className="min-h-screen bg-brand-muted flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-brand-blue border-t-transparent" aria-hidden="true" />
      </div>
    );
  }

  if (resumeState === 'prompt' && pendingResumeRecords) {
    const resumeReadyCount = pendingResumeRecords.filter(
      r => r.status === 'editing' || r.status === 'completed'
    ).length;
    return (
      <div className="min-h-screen bg-brand-muted flex items-center justify-center p-4">
        <div className="bg-white rounded-md border border-gray-200 p-6 max-w-md w-full space-y-4 shadow-lg">
          <img src={brand.logoSrc} alt={brand.logoAlt} className="h-10 w-auto object-contain" />
          <div>
            <h2 className="headline text-sm text-brand-navy mb-1">Resume previous session?</h2>
            <p className="text-sm text-brand-gray">
              {pendingResumeRecords.length} file{pendingResumeRecords.length === 1 ? '' : 's'} from
              your last session {pendingResumeRecords.length === 1 ? 'is' : 'are'} saved on this
              device — {resumeReadyCount} ready to export. Files still mid-processing when the
              session ended will pick back up automatically.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleResumeSession}
              className="bg-brand-navy text-white px-4 py-2 rounded-md text-sm font-bold hover:bg-brand-blue transition-colors"
            >
              Resume session
            </button>
            <button
              type="button"
              onClick={handleDiscardSession}
              className="border border-gray-300 text-brand-navy px-4 py-2 rounded-md text-sm font-bold hover:bg-brand-muted transition-colors"
            >
              Start fresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-muted text-brand-navy pb-20 relative">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="h-0.5 bg-brand-accent" aria-hidden="true" />
        <div className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={brand.logoSrc}
              alt={brand.logoAlt}
              className="h-12 w-auto object-contain shrink-0"
            />
            <div className="hidden sm:block w-px h-9 bg-gray-200 shrink-0" aria-hidden="true" />
            <h1 className="headline text-[13px] text-brand-navy leading-snug">
              {brand.productName}
            </h1>
          </div>
          {files.length > 0 && (
            <div className="flex items-center gap-2 min-w-0" aria-live="polite">
              <p className="text-xs font-bold text-brand-gray flex items-center gap-2 shrink-0">
                {sessionCounts.running > 0 && (
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-accent animate-pulse" aria-hidden="true" />
                )}
                <span>{formatSessionStatus(sessionCounts)}</span>
              </p>
              {sessionCounts.total > 1 && (
                <div
                  className="w-24 h-1.5 rounded-full bg-gray-200 overflow-hidden shrink-0"
                  role="progressbar"
                  aria-valuenow={Math.round(sessionProgressFraction(sessionCounts) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Batch progress"
                >
                  <div
                    className="h-full bg-brand-accent transition-all"
                    style={{ width: `${sessionProgressFraction(sessionCounts) * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleExportExtractionLog}
              className="border border-gray-300 text-slate-500 px-3 py-2 rounded-md text-sm font-bold hover:bg-brand-muted hover:text-brand-navy transition-colors disabled:opacity-50"
              disabled={extractionLogRowCount === 0}
              title={
                extractionLogRowCount === 0
                  ? 'Needs at least one processed file'
                  : `Per-file QA log (fidelity status, blockers, counts) for ${extractionLogRowCount} file(s) — not for partners`
              }
            >
              Export extraction log
            </button>
            <button
              type="button"
              onClick={handleBatchDownloadPdf}
              disabled={isGeneratingPdf || exportReadyCount === 0}
              className="border border-brand-navy text-brand-navy px-3 py-2 rounded-md text-sm font-bold hover:bg-brand-muted transition-colors disabled:opacity-50 flex items-center space-x-2"
            >
              {isGeneratingPdf ? (
                <div className="animate-spin h-3 w-3 border-2 border-brand-navy/40 border-t-brand-navy rounded-full" aria-hidden="true" />
              ) : null}
              <span>{zipLabel}</span>
            </button>
            <button
              type="button"
              onClick={handleExportForCoding}
              className="border border-brand-blue text-brand-navy px-3 py-2 rounded-md text-sm font-bold hover:bg-brand-muted transition-colors disabled:opacity-50"
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
              className="bg-brand-navy text-white px-3 py-2 rounded-md text-sm font-bold hover:bg-brand-blue transition-colors disabled:opacity-50"
              disabled={exportReadyCount === 0}
            >
              {csvLabel}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[90rem] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {files.length === 0 && (
          <section className="text-center max-w-2xl mx-auto">
            <p className="text-brand-gray text-[15px]">
              Upload PDF, Word, or PowerPoint. We'll flag anything that needs a second look —
              everything else exports straight to CSV or PDF.
            </p>
          </section>
        )}

        <section>
          <FileUpload onFilesSelected={handleFilesSelected} compact={files.length > 0} />
        </section>

        {persistWarning && (
          <div
            className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 flex flex-wrap items-start justify-between gap-3"
            role="status"
          >
            <p className="text-sm">
              Couldn't save one or more files for session resume — your browser's local storage may
              be full for a batch this large. Processing will continue normally; a refresh may just
              not be able to restore everything. Uploading in smaller batches avoids this.
            </p>
            <button
              type="button"
              className="text-xs font-bold text-amber-700 hover:text-amber-950 shrink-0"
              onClick={() => setPersistWarning(false)}
            >
              Dismiss
            </button>
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-4">
            {!file && (
              <SessionFileList files={files} selectedFileId={selectedFileId} onSelect={setSelectedFileId} />
            )}

            {file && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-md border border-gray-200">
                  <div className="flex items-center space-x-3 min-w-0">
                    <span className="font-bold text-sm text-brand-navy truncate">
                      {file.result?.program?.trim() || displayFileName(file)}
                    </span>
                    {/* displayFileName already appends the part label when there's no program
                        name yet — only add this separate chip once a program name has replaced it. */}
                    {file.result?.program?.trim() && file.splitPartLabel && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0 bg-slate-100 text-slate-600">
                        {file.splitPartLabel}
                      </span>
                    )}
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded shrink-0 ${
                        isExportReady(file.status)
                          ? 'bg-brand-muted text-brand-navy'
                          : file.status === 'error'
                            ? 'bg-red-50 text-brand-red'
                            : 'bg-brand-sky/30 text-brand-navy'
                      }`}
                    >
                      {PROCESSING_STATUS_LABELS[file.status]}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 shrink-0">
                    {showEditor && (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewFileId(file.id)}
                          className="text-xs font-bold text-brand-navy bg-brand-sky/25 hover:bg-brand-sky/40 px-3 py-1.5 rounded-md transition-colors"
                        >
                          Preview branded PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadSinglePdf(file)}
                          disabled={isGeneratingPdf}
                          className="text-xs font-bold text-brand-navy bg-brand-muted hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors disabled:opacity-50"
                        >
                          Download PDF
                        </button>
                      </>
                    )}
                    {file.splitPartLabel && (
                      <button
                        type="button"
                        onClick={() => treatAsSingleModel(file.id)}
                        className="text-xs font-bold text-brand-navy hover:underline px-2 py-1.5"
                        title="Undo the automatic split and re-process this upload as one logic model."
                      >
                        ↩ Treat as one logic model
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedFileId(null)}
                      className="text-xs font-bold text-brand-navy hover:underline px-2 py-1.5"
                    >
                      ← All files
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFile(file.id)}
                      className="text-xs font-bold text-slate-500 hover:text-red-600 px-2 py-1.5"
                      aria-label={`Remove ${displayFileName(file)}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {file.warnings && file.warnings.length > 0 && (
                  <div
                    className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3"
                    role="status"
                  >
                    <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">
                      Fidelity notice
                    </p>
                    <ul className="text-sm space-y-1 list-disc pl-5">
                      {file.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {file.error && (
                  <div
                    className="bg-red-50 border border-red-200 text-red-900 rounded-lg p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3"
                    role="alert"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{file.error}</p>
                      {file.extractionBlockers && file.extractionBlockers.length > 0 && (
                        <ul className="mt-2 text-sm list-disc pl-5 space-y-1 text-red-800">
                          {file.extractionBlockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex space-x-2 shrink-0">
                      {(file.status === 'error' || !file.result) && (
                        <button
                          type="button"
                          onClick={() => retryFile(file.id)}
                          className="text-xs font-bold bg-brand-red text-white px-3 py-1.5 rounded-md hover:opacity-90"
                        >
                          Retry
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

                {file.status === 'pending' && (
                  <div className="bg-white border border-gray-200 rounded-md px-4 py-6 text-sm text-brand-gray" aria-live="polite">
                    Queued — files process one at a time.
                  </div>
                )}

                {showEditor && file.result && (
                  <div
                    className={`grid gap-4 ${
                      file.sourcePaneCollapsed !== false
                        ? 'grid-cols-1'
                        : /* Side-by-side only above ~1536px: the board needs ~1050-1200px on its
                             own, so anything narrower (a normal 13-15" laptop) docks the source
                             pane full-width above the board instead of squeezing both into half
                             the screen. Above that, give the source pane a CAPPED width (300-352px
                             — legible via its own zoom control, doesn't need to grow further) and
                             let the board take the rest via 1fr — a proportional 50/50 split still
                             clips the board to 4-5 of 6 columns even at 1920px, which is one of the
                             most common external-monitor widths; empirically checked at 1920px. */
                          'grid-cols-1 2xl:grid-cols-[minmax(300px,22rem)_minmax(0,1fr)]'
                    }`}
                  >
                    <div
                      className={
                        file.sourcePaneCollapsed !== false
                          ? ''
                          : 'order-2 2xl:order-1 2xl:self-start'
                      }
                    >
                      <SourceDocumentPane
                        images={file.sourcePreviewImages ?? []}
                        textOnly={!file.sourcePreviewImages?.length}
                        collapsed={file.sourcePaneCollapsed !== false}
                        focus={sourceFocusByFileId[file.id]}
                        highlightRegions={resolveHighlightRegions(file)}
                        onCollapsedChange={collapsed => {
                          setFiles(prev =>
                            prev.map(f =>
                              f.id === file.id ? { ...f, sourcePaneCollapsed: collapsed } : f
                            )
                          );
                          if (!collapsed) void ensurePreviewImages(file.id);
                        }}
                      />
                    </div>
                    <div
                      className={
                        file.sourcePaneCollapsed !== false
                          ? 'min-w-0'
                          : 'order-1 2xl:order-2 min-w-0'
                      }
                    >
                      <LogicModelEditor
                        model={file.result}
                        onUpdate={updated => updateModel(file.id, updated)}
                        mismatchBannerDismissed={file.mismatchBannerDismissed}
                        onDismissMismatchBanner={() =>
                          setFiles(prev =>
                            prev.map(f =>
                              f.id === file.id ? { ...f, mismatchBannerDismissed: true } : f
                            )
                          )
                        }
                        fidelityBannerDismissed={file.fidelityBannerDismissed}
                        onDismissFidelityBanner={() =>
                          setFiles(prev =>
                            prev.map(f =>
                              f.id === file.id ? { ...f, fidelityBannerDismissed: true } : f
                            )
                          )
                        }
                        onOpenSourceForFidelity={() => {
                          setFiles(prev =>
                            prev.map(f =>
                              f.id === file.id ? { ...f, sourcePaneCollapsed: false } : f
                            )
                          );
                          void ensurePreviewImages(file.id);
                        }}
                        onFocusSource={(anchor, options) => {
                          const wantOpen = options?.open === true;
                          const alreadyOpen = file.sourcePaneCollapsed === false;
                          if (!wantOpen && !alreadyOpen) return;

                          const preserveEl =
                            wantOpen && document.activeElement instanceof HTMLElement
                              ? document.activeElement
                              : null;

                          if (wantOpen && !alreadyOpen) {
                            setFiles(prev =>
                              prev.map(f =>
                                f.id === file.id ? { ...f, sourcePaneCollapsed: false } : f
                              )
                            );
                            void ensurePreviewImages(file.id);
                          }

                          const pageCount = file.sourcePreviewImages?.length ?? 0;
                          if (
                            typeof anchor.sourcePage === 'number' &&
                            anchor.sourcePage >= 1 &&
                            (pageCount === 0 || anchor.sourcePage <= pageCount)
                          ) {
                            setSourceFocusByFileId(prev => ({
                              ...prev,
                              [file.id]: {
                                page: Math.round(anchor.sourcePage!),
                                column:
                                  typeof anchor.sourceColumn === 'number'
                                    ? Math.round(anchor.sourceColumn)
                                    : undefined,
                                note: anchor.note ?? (anchor.needsReview ? 'Verify against source' : undefined),
                              },
                            }));
                          } else {
                            setSourceFocusByFileId(prev => ({
                              ...prev,
                              [file.id]: {
                                page: sourceFocusByFileId[file.id]?.page ?? 1,
                                note: 'Page unknown — browse source manually',
                              },
                            }));
                          }

                          if (preserveEl) {
                            requestAnimationFrame(() => {
                              requestAnimationFrame(() => {
                                preserveEl.scrollIntoView({
                                  block: 'nearest',
                                  inline: 'nearest',
                                });
                              });
                            });
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                {showPipelineSpinner && (
                  <div className="bg-white border border-gray-200 rounded-md px-4 py-10 flex flex-col items-center justify-center space-y-3" aria-live="polite">
                    <div className="animate-spin rounded-full h-10 w-10 border-4 border-brand-blue border-t-transparent" aria-hidden="true" />
                    <p className="font-bold text-brand-navy">
                      {file.progressMsg || PROCESSING_STATUS_LABELS[file.status]}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <div style={{ position: 'absolute', top: -10000, left: -10000, pointerEvents: 'none' }} aria-hidden="true">
        {pdfCaptureFile?.result && (
          <LogicModelPdfTemplate
            id={`pdf-template-${pdfCaptureFile.id}`}
            model={modelForExport(pdfCaptureFile.result, pdfCaptureFile.warnings)}
          />
        )}
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
          <div className="bg-white rounded-md shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-brand-navy text-white">
              <h3 id="pdf-preview-title" className="headline text-sm text-white">
                PDF preview: {currentPreviewFile.result.program}
              </h3>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => handleDownloadSinglePdf(currentPreviewFile)}
                  className="bg-brand-accent text-brand-navy px-4 py-2 rounded-md font-bold text-sm hover:bg-brand-sky"
                >
                  Download PDF
                </button>
                <button
                  id="pdf-preview-close"
                  type="button"
                  onClick={() => setPreviewFileId(null)}
                  className="text-white/80 hover:text-white px-4 py-2 font-bold text-sm"
                >
                  Close
                </button>
              </div>
            </div>
            <div
              ref={previewViewportRef}
              className="flex-1 overflow-auto bg-gray-200"
              style={{ padding: PREVIEW_GUTTER_PX }}
            >
              {/* zoom (unlike transform) shrinks the layout box, so the page stays scrollable. */}
              <div className="mx-auto w-fit shadow-lg" style={{ zoom: previewScale }}>
                <LogicModelPdfTemplate model={modelForExport(currentPreviewFile.result, currentPreviewFile.warnings)} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
