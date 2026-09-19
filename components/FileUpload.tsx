import React, { useCallback, useState } from 'react';

import {
  SUPPORTED_UPLOAD_LABEL,
  UPLOAD_ACCEPT_ATTRIBUTE,
  isSupportedUploadName,
} from '../shared/uploadFormats';

const isAccepted = (file: File): boolean => isSupportedUploadName(file.name);

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  /** Compact control once a session already has files. */
  compact?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, disabled, compact }) => {
  const [rejected, setRejected] = useState<string[]>([]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;

      const all = Array.from<File>(e.dataTransfer.files);
      const droppedFiles = all.filter(isAccepted);
      // Say so when files are turned away. This used to filter silently and then no-op on an empty
      // result, so dropping a folder of unsupported files (the partner corpus has PNG and XLSX
      // logic models) looked exactly like the drop not registering at all.
      setRejected(all.filter(f => !isAccepted(f)).map(f => f.name));

      if (droppedFiles.length > 0) {
        onFilesSelected(droppedFiles);
      }
    },
    [disabled, onFilesSelected]
  );

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || !e.target.files) return;
    const all = Array.from<File>(e.target.files);
    // Filter here too. The picker's `accept` attribute is a hint a user can override ("All files"),
    // and an unsupported file used to queue and then fail deep in conversion with a generic error.
    const selectedFiles = all.filter(isAccepted);
    setRejected(all.filter(f => !isAccepted(f)).map(f => f.name));
    if (selectedFiles.length > 0) onFilesSelected(selectedFiles);
    e.target.value = '';
  };

  const rejectedNotice =
    rejected.length > 0 ? (
      <p className="mt-2 text-xs text-amber-800" role="status">
        {rejected.length === 1
          ? `Skipped "${rejected[0]}" — unsupported format.`
          : `Skipped ${rejected.length} files — unsupported format.`}{' '}
        Accepts {SUPPORTED_UPLOAD_LABEL}.
      </p>
    ) : null;

  const input = (
    <input
      type="file"
      multiple
      accept={UPLOAD_ACCEPT_ATTRIBUTE}
      onChange={handleInputChange}
      disabled={disabled}
      className="hidden"
      id="file-upload"
    />
  );

  if (compact) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className={`border border-dashed rounded-md px-3 py-2 transition-colors ${
          disabled
            ? 'border-gray-300 bg-white cursor-not-allowed opacity-60'
            : 'border-brand-blue bg-white hover:border-brand-navy hover:bg-brand-muted'
        }`}
      >
        {input}
        <label
          htmlFor="file-upload"
          className={`flex items-center gap-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-sm font-bold text-brand-navy">Add files</span>
          <span className="text-xs text-brand-gray">PDF, Word, PowerPoint, Excel, or image — or drop them here</span>
        </label>
        {rejectedNotice}
      </div>
    );
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={`border border-dashed rounded-md p-10 text-center transition-colors
        ${
          disabled
            ? 'border-gray-300 bg-white cursor-not-allowed opacity-60'
            : 'border-brand-blue bg-white hover:border-brand-navy hover:bg-brand-muted cursor-pointer'
        }`}
    >
      {input}
      <label htmlFor="file-upload" className={disabled ? 'cursor-not-allowed' : 'cursor-pointer'}>
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="p-3 bg-brand-muted rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-brand-navy">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m3.75 9v6m3-3H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <div className="text-brand-navy">
            <span className="font-bold">Click to upload</span>
            <span className="text-brand-gray"> or drag and drop</span>
          </div>
          <p className="text-sm text-brand-gray">
            PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), or an image (.png/.jpg).
            PDF usually preserves layout best.
          </p>
        </div>
      </label>
      {rejectedNotice}
    </div>
  );
};

export default FileUpload;
