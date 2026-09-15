import React from 'react';
import type { ProcessingFile } from '../types';
import { countExtractionItems, shouldShowFidelityBanner } from '../shared/extractionFidelity';
import { shouldSuggestMismatch } from '../shared/sourceMapping';
import { isExportReady, isPipelineBusy } from '../shared/sessionQueue';

const PROCESSING_LABELS: Record<ProcessingFile['status'], string> = {
  pending: 'Queued',
  converting: 'Reading layout',
  extracting: 'Extracting',
  editing: 'Ready',
  completed: 'Ready',
  error: 'Needs attention',
};

function isFlagged(file: ProcessingFile): boolean {
  if (file.status === 'error') return true;
  if (!file.result || !isExportReady(file.status)) return false;
  return shouldShowFidelityBanner(file.result) || shouldSuggestMismatch(file.result);
}

function flagReason(file: ProcessingFile): string {
  if (file.status === 'error') {
    return file.extractionBlockers?.[0] || file.error || 'Needs attention';
  }
  const result = file.result;
  if (!result) return 'Needs attention';
  if (shouldSuggestMismatch(result)) {
    return 'Layout or label mismatch — review unmapped items';
  }
  const blocker = result.extractionBlockers?.[0];
  if (blocker) return blocker;
  const bits = [
    result.extractionStatus && result.extractionStatus !== 'ok' ? result.extractionStatus : '',
    result.extractionConfidence ? `${result.extractionConfidence} confidence` : '',
  ].filter(Boolean);
  return bits.length ? `Extraction ${bits.join(' · ')}` : 'Extraction fidelity needs a check';
}

function readySummary(file: ProcessingFile): string {
  if (!file.result) return '';
  const { total } = countExtractionItems(file.result);
  const confidence = file.result.extractionConfidence || 'high';
  return `${total} item${total === 1 ? '' : 's'} · ${confidence} confidence`;
}

interface FileRowProps {
  file: ProcessingFile;
  selected: boolean;
  onSelect: (fileId: string) => void;
  variant: 'flagged' | 'ready' | 'busy';
}

const FileRow: React.FC<FileRowProps> = ({ file, selected, onSelect, variant }) => {
  const program = file.result?.program?.trim();
  const busy = isPipelineBusy(file.status);

  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={() => onSelect(file.id)}
        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
          selected ? 'bg-brand-sky/20 ring-inset ring-2 ring-brand-navy' : 'hover:bg-brand-muted'
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-sm text-brand-navy truncate">
            {program || file.file.name}
          </span>
          {variant === 'flagged' && (
            <span className="block text-xs text-amber-800 truncate">{flagReason(file)}</span>
          )}
          {variant === 'ready' && (
            <span className="block text-xs text-brand-gray truncate">{readySummary(file)}</span>
          )}
          {variant === 'busy' && (
            <span className="block text-xs text-brand-gray truncate">
              {file.progressMsg || PROCESSING_LABELS[file.status]}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {busy && (
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-brand-accent animate-pulse" aria-hidden="true" />
          )}
          {variant === 'flagged' && (
            <span className="text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1 rounded-md transition-colors">
              Review
            </span>
          )}
          {variant === 'ready' && (
            <span className="text-xs font-bold text-brand-navy underline decoration-transparent hover:decoration-inherit">
              View
            </span>
          )}
        </span>
      </button>
    </li>
  );
};

interface SessionGroupProps {
  title: string;
  files: ProcessingFile[];
  selectedFileId: string | null;
  onSelect: (fileId: string) => void;
  variant: 'flagged' | 'ready' | 'busy';
  tone: 'amber' | 'neutral';
}

const SessionGroup: React.FC<SessionGroupProps> = ({
  title,
  files,
  selectedFileId,
  onSelect,
  variant,
  tone,
}) => {
  if (files.length === 0) return null;
  return (
    <div>
      <p
        className={`text-[10px] font-bold uppercase tracking-wider mb-1.5 px-0.5 ${
          tone === 'amber' ? 'text-amber-700' : 'text-brand-gray'
        }`}
      >
        {title} ({files.length})
      </p>
      <ul
        className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white overflow-hidden"
        role="listbox"
        aria-label={title}
      >
        {files.map(file => (
          <FileRow
            key={file.id}
            file={file}
            selected={file.id === selectedFileId}
            onSelect={onSelect}
            variant={variant}
          />
        ))}
      </ul>
    </div>
  );
};

interface SessionFileListProps {
  files: ProcessingFile[];
  selectedFileId: string | null;
  onSelect: (fileId: string) => void;
}

const SessionFileList: React.FC<SessionFileListProps> = ({ files, selectedFileId, onSelect }) => {
  if (files.length === 0) return null;

  const flagged = files.filter(isFlagged);
  const flaggedIds = new Set(flagged.map(f => f.id));
  const ready = files.filter(f => !flaggedIds.has(f.id) && isExportReady(f.status) && f.result);
  const busy = files.filter(f => !flaggedIds.has(f.id) && isPipelineBusy(f.status));
  const queued = files.filter(f => !flaggedIds.has(f.id) && f.status === 'pending');

  return (
    <nav aria-label="Files in this session" className="space-y-4">
      <SessionGroup
        title="Needs review"
        files={flagged}
        selectedFileId={selectedFileId}
        onSelect={onSelect}
        variant="flagged"
        tone="amber"
      />
      <SessionGroup
        title="Ready to export"
        files={ready}
        selectedFileId={selectedFileId}
        onSelect={onSelect}
        variant="ready"
        tone="neutral"
      />
      <SessionGroup
        title="Processing"
        files={busy}
        selectedFileId={selectedFileId}
        onSelect={onSelect}
        variant="busy"
        tone="neutral"
      />
      <SessionGroup
        title="Queued"
        files={queued}
        selectedFileId={selectedFileId}
        onSelect={onSelect}
        variant="busy"
        tone="neutral"
      />
    </nav>
  );
};

export default SessionFileList;
