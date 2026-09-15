import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countSessionFiles,
  exportWouldOmitFiles,
  formatSessionStatus,
  sessionProgressFraction,
} from './sessionQueue.ts';

describe('sessionQueue', () => {
  it('counts ready, running, queued, and error files', () => {
    const counts = countSessionFiles([
      { status: 'editing' },
      { status: 'completed' },
      { status: 'extracting' },
      { status: 'pending' },
      { status: 'pending' },
      { status: 'error' },
    ]);
    assert.equal(counts.ready, 2);
    assert.equal(counts.running, 1);
    assert.equal(counts.queued, 2);
    assert.equal(counts.needsAttention, 1);
    assert.equal(counts.total, 6);
    assert.equal(formatSessionStatus(counts), '2 ready · 1 running · 2 queued · 1 needs attention');
    assert.equal(exportWouldOmitFiles(counts), true);
  });

  it('treats a fully ready session as complete for export labels', () => {
    const counts = countSessionFiles([{ status: 'editing' }, { status: 'completed' }]);
    assert.equal(formatSessionStatus(counts), '2 ready');
    assert.equal(exportWouldOmitFiles(counts), false);
  });

  it('computes progress fraction from terminal-state files only', () => {
    const counts = countSessionFiles([
      { status: 'editing' },
      { status: 'error' },
      { status: 'extracting' },
      { status: 'pending' },
    ]);
    assert.equal(sessionProgressFraction(counts), 0.5);
    assert.equal(sessionProgressFraction(countSessionFiles([])), 0);
  });
});
