import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completeRegressionCaptures,
  regressionCaptureKey,
  retainRegressionBundle,
  retainRegressionExtraction,
  type RegressionCaptureGlobals,
  type RetainedExtraction,
} from './regressionCapture.ts';
import type { DocumentBundle, LogicModel, ProcessingFile } from '../types.ts';

const bundle = (overrides: Partial<DocumentBundle> = {}): DocumentBundle =>
  ({ sourceFormat: 'pdf', textTrack: 'Track A', images: [], ...overrides }) as DocumentBundle;

const processingFile = (name: string, splitPartLabel?: string) =>
  ({ file: { name } as File, splitPartLabel }) as Pick<ProcessingFile, 'file' | 'splitPartLabel'>;

const extraction = (program: string): RetainedExtraction => ({
  model: { organization: 'Org', program } as LogicModel,
  promptVersion: '2026-09-20.6',
  promptVariant: 'fused',
});

test('bundle and extraction for the same file land under the same key', () => {
  const globals: RegressionCaptureGlobals = {};
  const file = processingFile('org-programs.pdf');
  retainRegressionBundle(globals, file, bundle());
  retainRegressionExtraction(globals, file, bundle(), extraction('After School'));

  assert.deepEqual(Object.keys(globals.__lmRegressionBundles ?? {}), ['org-programs.pdf']);
  assert.deepEqual(Object.keys(globals.__lmRegressionExtractions ?? {}), ['org-programs.pdf']);
  assert.deepEqual(completeRegressionCaptures(globals), ['org-programs.pdf']);
});

test('split siblings key apart instead of overwriting each other', () => {
  // Both parts share one underlying `File`; keyed on `file.name` alone part 2 would clobber part 1
  // and the capture script would write one bundle for a document that holds two logic models.
  const globals: RegressionCaptureGlobals = {};
  const partOne = processingFile('org-programs.pdf', 'Part 1 of 2');
  const partTwo = processingFile('org-programs.pdf', 'Part 2 of 2');
  retainRegressionBundle(globals, partOne, bundle());
  retainRegressionExtraction(globals, partOne, bundle(), extraction('After School'));
  retainRegressionBundle(globals, partTwo, bundle());
  retainRegressionExtraction(globals, partTwo, bundle(), extraction('Summer Camp'));

  assert.deepEqual(completeRegressionCaptures(globals), [
    'org-programs.pdf — Part 1 of 2',
    'org-programs.pdf — Part 2 of 2',
  ]);
  assert.equal(
    globals.__lmRegressionExtractions?.['org-programs.pdf — Part 1 of 2'].model.program,
    'After School'
  );
});

test('an unknown file falls back to the bundle format, on both halves alike', () => {
  const globals: RegressionCaptureGlobals = {};
  retainRegressionBundle(globals, undefined, bundle({ sourceFormat: 'pptx' }));
  retainRegressionExtraction(globals, undefined, bundle({ sourceFormat: 'pptx' }), extraction('X'));

  assert.equal(regressionCaptureKey(undefined, 'pptx'), 'pptx');
  assert.deepEqual(completeRegressionCaptures(globals), ['pptx']);
});

test('a bundle whose extraction is still in flight is not complete', () => {
  // The whole point of the readiness check: the bundle lands first and the extract call it feeds
  // takes minutes. Polling on bundles alone reports the batch done and loses every extraction.
  const globals: RegressionCaptureGlobals = {};
  retainRegressionBundle(globals, processingFile('a.pdf'), bundle());
  retainRegressionBundle(globals, processingFile('b.pdf'), bundle());
  retainRegressionExtraction(globals, processingFile('a.pdf'), bundle(), extraction('A'));

  assert.deepEqual(completeRegressionCaptures(globals), ['a.pdf']);
});

test('the retained extraction carries the prompt that produced it', () => {
  // Without these an extraction cannot be attributed to an exact prompt, and two runs under
  // different prompts compare as if they were the same experiment.
  const globals: RegressionCaptureGlobals = {};
  retainRegressionExtraction(globals, processingFile('a.pdf'), bundle(), extraction('A'));

  const retained = globals.__lmRegressionExtractions?.['a.pdf'];
  assert.equal(retained?.promptVersion, '2026-09-20.6');
  assert.equal(retained?.promptVariant, 'fused');
});

test('retaining does not disturb captures already held', () => {
  const globals: RegressionCaptureGlobals = {};
  retainRegressionBundle(globals, processingFile('a.pdf'), bundle({ sourceFormat: 'pdf' }));
  retainRegressionBundle(globals, processingFile('b.pdf'), bundle({ sourceFormat: 'docx' }));

  assert.equal(globals.__lmRegressionBundles?.['a.pdf'].sourceFormat, 'pdf');
  assert.equal(globals.__lmRegressionBundles?.['b.pdf'].sourceFormat, 'docx');
});
