import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADING_SIZE_RATIO,
  groupTextItemsIntoLines,
  renderPdfPageText,
} from './pdfTextTrack.ts';

const run = (str: string, height: number, hasEOL = false) => ({ str, height, hasEOL });

test('runs are joined into a line and flushed on the end-of-line marker', () => {
  const lines = groupTextItemsIntoLines([
    run('Program ', 12),
    run('Outputs', 12, true),
    run('Ninety students', 10, true),
  ]);
  assert.deepEqual(lines, [
    { text: 'Program Outputs', maxHeight: 12 },
    { text: 'Ninety students', maxHeight: 10 },
  ]);
});

test('a trailing line with no end-of-line marker is not lost', () => {
  const lines = groupTextItemsIntoLines([run('first', 10, true), run('last', 10)]);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].text, 'last');
});

test('items with no string — pdfjs marked content — are skipped, and their EOL still flushes', () => {
  const lines = groupTextItemsIntoLines([
    { type: 'beginMarkedContent' },
    run('kept', 10),
    { type: 'endMarkedContent', hasEOL: true },
  ]);
  assert.deepEqual(lines, [{ text: 'kept', maxHeight: 10 }]);
});

test('an empty line is dropped rather than emitted as blank', () => {
  assert.deepEqual(groupTextItemsIntoLines([run('   ', 10, true), run('real', 10, true)]), [
    { text: 'real', maxHeight: 10 },
  ]);
});

test('line height is the tallest run in the line, from the transform when height is absent', () => {
  const lines = groupTextItemsIntoLines([
    { str: 'small ', height: 8 },
    { str: 'BIG', transform: [0, 0, 0, 22, 0, 0], hasEOL: true },
  ]);
  assert.equal(lines[0].maxHeight, 22);
});

test('a negative transform scale is read as its magnitude', () => {
  // Flipped text coordinate systems give a negative d term; the run is not zero-height.
  const lines = groupTextItemsIntoLines([{ str: 'flipped', transform: [0, 0, 0, -14, 0, 0], hasEOL: true }]);
  assert.equal(lines[0].maxHeight, 14);
});

test('a line taller than the median by the ratio becomes a Markdown heading', () => {
  const body = { text: 'an ordinary body line of the document', maxHeight: 10 };
  const heading = { text: 'RESOURCES', maxHeight: 10 * HEADING_SIZE_RATIO };
  assert.equal(renderPdfPageText([body, body, heading, body]).split('\n')[2], '### RESOURCES');
});

test('a long line is never a heading however large it is set', () => {
  const body = { text: 'body', maxHeight: 10 };
  const long = { text: 'x'.repeat(200), maxHeight: 100 };
  assert.equal(renderPdfPageText([body, body, long]).includes('### '), false);
});

test('a page set entirely in one size has no headings', () => {
  const lines = Array.from({ length: 5 }, (_, i) => ({ text: `line ${i}`, maxHeight: 12 }));
  assert.equal(renderPdfPageText(lines).includes('#'), false);
});

test('a page with no measurable heights has no headings', () => {
  assert.equal(renderPdfPageText([{ text: 'a', maxHeight: 0 }, { text: 'b', maxHeight: 0 }]), 'a\nb');
});

test('the threshold is the median, so one huge title cannot suppress the real headings', () => {
  // Mean height here is dragged up by the cover title; the median stays at body size, so the
  // section heading below still clears the bar.
  const lines = [
    { text: 'A VERY LARGE COVER TITLE', maxHeight: 60 },
    { text: 'body one', maxHeight: 10 },
    { text: 'body two', maxHeight: 10 },
    { text: 'body three', maxHeight: 10 },
    { text: 'ACTIVITIES', maxHeight: 14 },
  ];
  const out = renderPdfPageText(lines).split('\n');
  assert.equal(out[0], '### A VERY LARGE COVER TITLE');
  assert.equal(out[4], '### ACTIVITIES');
  assert.equal(out[1], 'body one');
});
