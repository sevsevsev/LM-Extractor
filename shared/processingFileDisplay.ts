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
