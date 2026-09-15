import type { ProcessingFile } from '../types';

export type SessionFileCounts = {
  ready: number;
  running: number;
  queued: number;
  needsAttention: number;
  total: number;
};

export function isPipelineBusy(status: ProcessingFile['status']): boolean {
  return status === 'converting' || status === 'extracting';
}

export function isExportReady(status: ProcessingFile['status']): boolean {
  return status === 'editing' || status === 'completed';
}

export function countSessionFiles(files: Pick<ProcessingFile, 'status'>[]): SessionFileCounts {
  const counts: SessionFileCounts = {
    ready: 0,
    running: 0,
    queued: 0,
    needsAttention: 0,
    total: files.length,
  };
  for (const file of files) {
    if (isExportReady(file.status)) counts.ready += 1;
    else if (isPipelineBusy(file.status)) counts.running += 1;
    else if (file.status === 'pending') counts.queued += 1;
    else if (file.status === 'error') counts.needsAttention += 1;
  }
  return counts;
}

export function formatSessionStatus(counts: SessionFileCounts): string {
  if (counts.total === 0) return '';
  const parts: string[] = [];
  parts.push(`${counts.ready} ready`);
  if (counts.running) parts.push(`${counts.running} running`);
  if (counts.queued) parts.push(`${counts.queued} queued`);
  if (counts.needsAttention) parts.push(`${counts.needsAttention} needs attention`);
  return parts.join(' · ');
}

export function exportWouldOmitFiles(counts: SessionFileCounts): boolean {
  return counts.total > 0 && counts.ready < counts.total;
}

/** Fraction [0,1] of files that have reached a terminal state (ready or needs attention). */
export function sessionProgressFraction(counts: SessionFileCounts): number {
  if (counts.total === 0) return 0;
  return (counts.ready + counts.needsAttention) / counts.total;
}
