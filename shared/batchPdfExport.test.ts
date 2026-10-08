import assert from 'node:assert/strict';
import test from 'node:test';

import { describeBatchPdfOutcome } from './batchPdfExport.ts';

test('says nothing when every file made it into the ZIP', () => {
  assert.equal(describeBatchPdfOutcome({ total: 251, empty: [], failed: [] }), null);
});

test('reports an extraction with nothing to put in a PDF without losing the ZIP', () => {
  assert.equal(
    describeBatchPdfOutcome({ total: 251, empty: ["ballet-report.pdf"], failed: [] }),
    'Downloaded 250 of 251 PDFs. 1 file had nothing to put in a PDF: ballet-report.pdf.'
  );
});

test('reports a document that could not be drawn separately from an empty one', () => {
  assert.equal(
    describeBatchPdfOutcome({ total: 10, empty: ['a.pdf'], failed: ['b.pdf'] }),
    "Downloaded 8 of 10 PDFs. 1 file had nothing to put in a PDF: a.pdf. 1 file couldn't be drawn: b.pdf."
  );
});

test('falls back to a count once the list of names would run long', () => {
  const empty = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(
    describeBatchPdfOutcome({ total: 251, empty, failed: [] }),
    'Downloaded 244 of 251 PDFs. 7 files had nothing to put in a PDF: a, b, c, d, e and 2 more.'
  );
});

test('says there is no ZIP when nothing at all could be drawn', () => {
  assert.equal(
    describeBatchPdfOutcome({ total: 2, empty: ['a.pdf', 'b.pdf'], failed: [] }),
    "Couldn't create the batch ZIP. 2 files had nothing to put in a PDF: a.pdf, b.pdf."
  );
});
