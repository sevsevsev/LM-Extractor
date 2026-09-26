import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPersistedRecord,
  modelForExport,
  persistedRecordToProcessingFile,
  resolveHighlightRegions,
  toPersistedRecord,
} from './sessionRecord.ts';
import type { PersistedFileRecord } from '../services/sessionStore.ts';
import type { LogicModel, ProcessingFile } from '../types.ts';

const file = new File(['x'], 'model.pdf', { type: 'application/pdf' });

function emptyModel(): LogicModel {
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    impact: { content: [] },
  } as LogicModel;
}

/** Every checkpoint field set to a distinguishable value, so a dropped one is visible. */
function fullRecord(): PersistedFileRecord {
  return {
    id: 'file-1',
    file,
    status: 'completed',
    result: emptyModel(),
    warnings: ['a warning'],
    extractionBlockers: ['a blocker'],
    error: 'an error',
    mismatchBannerDismissed: true,
    fidelityBannerDismissed: true,
    codingExportFidelityAck: true,
    sourcePaneCollapsed: true,
    sourceDocumentId: 'doc-9',
    sourcePageRange: { start: 2, end: 4 },
    splitPartLabel: 'Part 2',
    forceSingleModel: true,
    promptVersion: '2026-09-20.6',
    promptVariant: 'vision+text',
    modelId: 'gemini-flash-latest',
  };
}

/**
 * The test this file exists for. `toPersistedRecord` and `persistedRecordToProcessingFile` are two
 * hand-written field lists that have to stay in step; miss a field in either and a resumed session
 * comes back subtly wrong with nothing failing. A round trip catches that mechanically.
 */
test('a full checkpoint survives the round trip with every field intact', () => {
  const record = fullRecord();
  const restored = toPersistedRecord(persistedRecordToProcessingFile(record));
  assert.deepEqual(restored, record);
});

test('the round trip covers every field of the persisted record, not just the ones listed here', () => {
  // Guards the guard: if someone adds a field to PersistedFileRecord and to only one of the two
  // functions, fullRecord() above must grow too or this test says nothing.
  const record = fullRecord();
  const restored = toPersistedRecord(persistedRecordToProcessingFile(record));
  assert.deepEqual(Object.keys(restored).sort(), Object.keys(record).sort());
});

test('an in-flight status is checkpointed as pending, not as mid-conversion', () => {
  // A reload cannot resume a conversion that was running, so the checkpoint must not claim it was.
  for (const status of ['converting', 'detecting', 'extracting'] as const) {
    const f = { id: 'x', file, status } as ProcessingFile;
    assert.equal(toPersistedRecord(f).status, 'pending', status);
  }
});

test('a settled status is checkpointed as itself', () => {
  for (const status of ['pending', 'editing', 'completed', 'error'] as const) {
    const f = { id: 'x', file, status } as ProcessingFile;
    assert.equal(toPersistedRecord(f).status, status);
  }
});

test('the checkpoint hash ignores the File, which does not serialise', () => {
  const a = { ...fullRecord(), file };
  const b = { ...fullRecord(), file: new File(['different bytes entirely'], 'other.pdf') };
  assert.equal(hashPersistedRecord(a), hashPersistedRecord(b));
});

test('the checkpoint hash changes when a checkpointed field changes', () => {
  const a = fullRecord();
  const b = { ...fullRecord(), splitPartLabel: 'Part 3' };
  assert.notEqual(hashPersistedRecord(a), hashPersistedRecord(b));
});

test('a self-reported region without a horizontal span is dropped, not drawn full width', () => {
  // A full-page box would convey nothing the page-jump chip already says.
  const regions = resolveHighlightRegions({
    result: {
      possiblyMissedRegions: [
        { page: 1, xStart: 0.25, xEnd: 0.6, note: 'right column' },
        { page: 2 },
        { page: 3, xStart: 0.1 },
      ],
    },
  } as ProcessingFile);
  assert.deepEqual(regions, [{ page: 1, leftFrac: 0.25, widthFrac: 0.35, note: 'right column' }]);
});

test('an inverted span yields a zero width rather than a negative one', () => {
  const regions = resolveHighlightRegions({
    result: { possiblyMissedRegions: [{ page: 1, xStart: 0.8, xEnd: 0.2 }] },
  } as ProcessingFile);
  assert.equal(regions[0].widthFrac, 0);
});

test('no self-report means no highlights', () => {
  assert.deepEqual(resolveHighlightRegions({} as ProcessingFile), []);
  assert.deepEqual(resolveHighlightRegions({ result: { possiblyMissedRegions: [] } } as ProcessingFile), []);
});

test('exporting normalizes a copy and leaves the session model untouched', () => {
  const model = emptyModel();
  const exported = modelForExport(model, []);
  assert.notEqual(exported, model);
  assert.equal(model.generalOutcomes, undefined, 'the session model must not be mutated');
});

test('a low-legibility warning reaches the exported model fidelity', () => {
  const clean = modelForExport(emptyModel(), []);
  const flagged = modelForExport(emptyModel(), ['This page rendered at low resolution and small print may be unreadable.']);
  assert.notDeepEqual(clean.extractionBlockers ?? [], flagged.extractionBlockers ?? []);
});
