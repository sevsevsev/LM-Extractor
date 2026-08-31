import React from 'react';
import type { ProcessingFile } from '../types';
import { shouldShowFidelityBanner } from '../shared/extractionFidelity';
import { isExportReady, isPipelineBusy } from '../shared/sessionQueue';

const STATUS_LABELS: Record<ProcessingFile['status'], string> = {
  pending: 'Queued',
  converting: 'Reading layout',
  extracting: 'Extracting',
  analyzing: 'Reviewing quality',
  editing: 'Ready',
  completed: 'Ready',
  error: 'Needs attention',
};

const statusClass = (status: ProcessingFile['status']) => {
  if (isExportReady(status)) return 'bg-green-100 text-green-700';
  if (status === 'error') return 'bg-red-100 text-red-700';
  return 'bg-blue-100 text-blue-700';
};

interface SessionFileListProps {
  files: ProcessingFile[];
  selectedFileId: string | null;
  onSelect: (fileId: string) => void;
}

const SessionFileList: React.FC<SessionFileListProps> = ({ files, selectedFileId, onSelect }) => {
  if (files.length === 0) return null;

  return (
    <nav aria-label="Files in this session">
      <ul
        className="max-h-[min(24rem,50vh)] overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm"
        role="listbox"
        aria-label="Session files"
      >
        {files.map(file => {
          const selected = file.id === selectedFileId;
          const program = file.result?.program?.trim();
          const fidelity = file.result && shouldShowFidelityBanner(file.result);
          const busy = isPipelineBusy(file.status);
          return (
            <li key={file.id} role="option" aria-selected={selected}>
              <button
                type="button"
                onClick={() => onSelect(file.id)}
                className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                  selected ? 'bg-indigo-50 ring-inset ring-2 ring-indigo-400' : 'hover:bg-slate-50'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-sm text-slate-800 truncate">
                    {program || file.file.name}
                  </span>
                  {program ? (
                    <span className="block text-xs text-slate-500 truncate">{file.file.name}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {fidelity && (
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded"
                      title="Extraction fidelity needs a check"
                    >
                      Fidelity
                    </span>
                  )}
                  {busy && (
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />
                  )}
                  <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${statusClass(file.status)}`}>
                    {file.progressMsg && busy ? file.progressMsg : STATUS_LABELS[file.status]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default SessionFileList;
