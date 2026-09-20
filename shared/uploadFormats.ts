import type { DocumentBundle } from '../types';

/**
 * Which file formats the app ingests, and how a filename maps to a `sourceFormat`.
 *
 * Deliberately dependency-free so every surface can share one definition: the upload control, the
 * conversion dispatch, and the extraction-log export all need this, but `services/fileService.ts`
 * pulls in pdfjs/mammoth/jszip and is lazily imported, so importing *it* would drag that graph into
 * the initial bundle (and make these rules untestable in Node). Three copies of this list had
 * already drifted apart before it was extracted here.
 */
export const SUPPORTED_UPLOAD_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
] as const;

/** `accept` attribute for a file input — extensions plus the matching MIME types. */
export const UPLOAD_ACCEPT_ATTRIBUTE = [
  ...SUPPORTED_UPLOAD_EXTENSIONS,
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
].join(',');

/** Human-readable list for upload copy. Keep in step with `SUPPORTED_UPLOAD_EXTENSIONS`. */
export const SUPPORTED_UPLOAD_LABEL = 'PDF, Word, PowerPoint, Excel, PNG and JPEG';

export function isImageFileName(fileName: string): boolean {
  return /\.(png|jpe?g)$/i.test(fileName.trim());
}

export function isSupportedUploadName(fileName: string): boolean {
  const name = fileName.trim().toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some(ext => name.endsWith(ext));
}

/**
 * Filename -> `DocumentBundle.sourceFormat`.
 *
 * Unsupported names fall through to `'pdf'`, matching the previous behaviour of every copy of this
 * function; callers are expected to have already filtered with `isSupportedUploadName`.
 */
export function sourceFormatFromFileName(fileName: string): DocumentBundle['sourceFormat'] {
  const name = fileName.trim().toLowerCase();
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (isImageFileName(name)) return 'image';
  return 'pdf';
}
