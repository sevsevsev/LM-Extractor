import React, { useCallback } from 'react';

interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  /** Compact control once a session already has files. */
  compact?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesSelected, disabled, compact }) => {
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (disabled) return;

      const droppedFiles = Array.from<File>(e.dataTransfer.files).filter(
        file =>
          file.type === 'application/pdf' ||
          file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
          file.name.endsWith('.pdf') ||
          file.name.endsWith('.docx') ||
          file.name.endsWith('.pptx')
      );

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
    const selectedFiles = Array.from<File>(e.target.files);
    onFilesSelected(selectedFiles);
    e.target.value = '';
  };

  const input = (
    <input
      type="file"
      multiple
      accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
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
          <span className="text-xs text-brand-gray">PDF, Word, or PowerPoint — or drop them here</span>
        </label>
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
            PDF, Word (.docx), or PowerPoint (.pptx). PDF usually preserves layout best.
          </p>
        </div>
      </label>
    </div>
  );
};

export default FileUpload;
