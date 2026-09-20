import type { ProcessingFile } from '../types';

/**
 * Display/export name for a file — plain `file.name` normally, or `"file.name — Part i of n"`
 * for a multi-logic-model split entry (siblings otherwise share the exact same underlying
 * `File`, so without this they'd be indistinguishable in the session list and both CSV exports
 * until each one's own extraction finishes). See docs/specs/multi-logic-model-pdf-v1.md.
 */
export function displayFileName(file: Pick<ProcessingFile, 'file' | 'splitPartLabel'>): string {
  return file.splitPartLabel ? `${file.file.name} — ${file.splitPartLabel}` : file.file.name;
}

/**
 * Single source of truth for a `ProcessingFile.status` display label — `App.tsx` and
 * `components/SessionFileList.tsx` each kept their own copy of this map, and disagreed for
 * `editing`/`completed` ("Ready to edit" vs "Ready") — found via codebase audit
 * (docs/specs/codebase-audit-2026-09-19.md #26). "Ready to edit" is the value actually visible
 * today (App.tsx's status badge); kept as canonical rather than changed, since this fix is about
 * the two maps disagreeing, not about picking new copy.
 */
export const PROCESSING_STATUS_LABELS: Record<ProcessingFile['status'], string> = {
  pending: 'Queued',
  converting: 'Reading layout',
  detecting: 'Checking for multiple logic models',
  extracting: 'Extracting',
  editing: 'Ready to edit',
  completed: 'Ready to edit',
  error: 'Needs attention',
};
