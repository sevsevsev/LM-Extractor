import type { ProcessingFile } from '../types';
import { countExtractionItems, documentTypeFlagLabel } from '../shared/extractionFidelity.js';
import { countMappedItems } from '../shared/sourceMapping.js';
import { qaStatusLabel } from '../shared/qaStatus.js';
import { displayFileName } from '../shared/processingFileDisplay.js';
import { isExportReady } from '../shared/sessionQueue.js';

/**
 * Per-document QA log — one row per processed file, not per content item (unlike the granular
 * and coding exports). For diagnosing extraction quality across a batch: which files/layouts
 * triggered which fidelity signals, so a sample can be pulled and handed over for root-causing.
 * Not partner-facing — see docs/specs/extraction-log-export-v1.md.
 */
export const EXTRACTION_LOG_HEADERS = [
  'source_filename',
  'pipeline_status',
  // Which prompt actually produced this row. A batch routinely spans several prompt variants
  // (a text-only fallback and a low-legibility vision document get materially different text),
  // so any aggregate error rate must be grouped by these before it means anything.
  'prompt_version',
  'prompt_variant',
  'organization',
  'program',
  'qa_status',
  'extraction_status',
  'extraction_confidence',
  'extraction_blockers',
  'document_type_flag',
  'layout_family',
  'total_items',
  'non_verbatim_items',
  'unmapped_items',
  'mapping_corrections_count',
  'possibly_missed_regions_count',
  'split_part_label',
  'error_message',
  'source_format',
  'warnings',
  'pages_processed',
  'mapping_corrections_json',
  'possibly_missed_regions_json',
];

/** Small local check, not services/fileService.ts's version — that module pulls in pdfjs/mammoth/
 * jszip eagerly, and this file is a static (non-lazy) import in App.tsx, so importing it here
 * would defeat the existing lazy-loading of that dependency graph.
 *
 * Named for what it must be called with, not what it does: takes the real filename
 * (`file.file.name`), never `displayFileName(f)` — a split entry's display name ends in
 * `"— Part 2 of 7"` and would silently fall through to the `'pdf'` default. Previously named
 * `sourceFormatFromDisplayName`, which invited exactly that mistake — found via codebase audit
 * (docs/specs/codebase-audit-2026-09-19.md #28). */
function sourceFormatFromRawFileName(name: string): 'pdf' | 'docx' | 'pptx' {
  const n = name.toLowerCase();
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.pptx')) return 'pptx';
  return 'pdf';
}

export function countExtractionLogRows(files: ProcessingFile[]): number {
  return files.filter(f => isExportReady(f.status) || f.status === 'error').length;
}

export function buildExtractionLogRows(files: ProcessingFile[]): string[][] {
  const rows: string[][] = [];

  for (const f of files) {
    if (!isExportReady(f.status) && f.status !== 'error') continue; // skip files still mid-pipeline
    const m = f.result;
    const counts = m ? countExtractionItems(m) : { total: 0, nonVerbatim: 0 };
    const mapped = m ? countMappedItems(m) : { total: 0, unmapped: 0 };
    const blockers = m?.extractionBlockers ?? f.extractionBlockers ?? [];

    rows.push([
      displayFileName(f),
      f.status,
      f.promptVersion || '',
      f.promptVariant || '',
      m?.organization || '',
      m?.program || '',
      m ? qaStatusLabel(m) : 'Error',
      m?.extractionStatus || '',
      m?.extractionConfidence || '',
      blockers.join(' | '),
      m ? documentTypeFlagLabel(m) : '',
      m?.layoutFamily || '',
      String(counts.total),
      String(counts.nonVerbatim),
      String(mapped.unmapped),
      String(m?.mappingCorrections?.length ?? 0),
      String(m?.possiblyMissedRegions?.length ?? 0),
      f.splitPartLabel || '',
      f.error || '',
      sourceFormatFromRawFileName(f.file.name),
      // Whether this file fell back to text-only extraction (vision/canvas rendering failed) or
      // hit a low-resolution flag — the single biggest predictor of poor extraction quality, and
      // otherwise invisible in this log.
      (f.warnings ?? []).join(' | '),
      // Session-only (not persisted across a resume) — blank rather than a misleading 0 when
      // unknown, since 0 would look like a real zero-page result.
      f.sourcePreviewImages?.length ? String(f.sourcePreviewImages.length) : '',
      m?.mappingCorrections?.length ? JSON.stringify(m.mappingCorrections) : '',
      m?.possiblyMissedRegions?.length ? JSON.stringify(m.possiblyMissedRegions) : '',
    ]);
  }

  return rows;
}

export function buildExtractionLogCsv(files: ProcessingFile[]): string | null {
  const rows = buildExtractionLogRows(files);
  if (rows.length === 0) return null;
  const escape = (c: string) => `"${String(c).replace(/"/g, '""')}"`;
  return [EXTRACTION_LOG_HEADERS.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n');
}

export function downloadExtractionLogCsv(
  files: ProcessingFile[]
): { ok: true } | { ok: false; reason: string } {
  const csv = buildExtractionLogCsv(files);
  if (!csv) {
    return { ok: false, reason: 'No files have finished processing yet.' };
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `extraction-log_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  return { ok: true };
}
