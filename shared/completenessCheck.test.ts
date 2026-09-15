import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateCompleteness } from './completenessCheck.js';

test('flags a gross mismatch: many candidate bullet lines, few extracted items', () => {
  const lines = Array.from({ length: 20 }, (_, i) => `- Bullet item number ${i}`);
  const sourceText = lines.join('\n');
  const result = estimateCompleteness(sourceText, 3);
  assert.equal(result.candidateSourceLines, 20);
  assert.equal(result.possiblyIncomplete, true);
});

test('does not flag when extraction roughly matches candidate line count', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `- Bullet item number ${i}`);
  const sourceText = lines.join('\n');
  const result = estimateCompleteness(sourceText, 9);
  assert.equal(result.possiblyIncomplete, false);
});

test('ignores small absolute gaps even if the ratio looks large', () => {
  // 4 candidate lines vs 1 extracted item: ratio is 4x, but the absolute gap (3) is below
  // MIN_GAP_TO_FLAG — small documents shouldn't trip this on noise.
  const sourceText = '- one\n- two\n- three\n- four';
  const result = estimateCompleteness(sourceText, 1);
  assert.equal(result.possiblyIncomplete, false);
});

test('does not flag when nothing was extracted at all (that case is handled elsewhere as noContent)', () => {
  const sourceText = Array.from({ length: 20 }, (_, i) => `- Bullet item number ${i}`).join('\n');
  const result = estimateCompleteness(sourceText, 0);
  assert.equal(result.possiblyIncomplete, false);
});

test('excludes markdown headings from the candidate count', () => {
  const sourceText = '# Organization Name\n## Page 1\n### INPUTS\n- Program staff\n- Volunteers';
  const result = estimateCompleteness(sourceText, 2);
  assert.equal(result.candidateSourceLines, 2);
});

test('excludes long prose lines (an Impact Statement paragraph) from the candidate count', () => {
  const longProse =
    'Through this program, youth and families in the community will experience improved outcomes as participants build skills, strengthen relationships, and achieve lasting educational and social gains that support long-term wellbeing across the region.';
  const sourceText = `${longProse}\n- Program staff\n- Volunteers`;
  const result = estimateCompleteness(sourceText, 2);
  assert.equal(result.candidateSourceLines, 2);
});

test('counts numbered-list lines as candidates too', () => {
  const sourceText = '1. First item\n2. Second item\n3. Third item';
  const result = estimateCompleteness(sourceText, 3);
  assert.equal(result.candidateSourceLines, 3);
  assert.equal(result.possiblyIncomplete, false);
});

test('empty source text yields zero candidates and never flags', () => {
  const result = estimateCompleteness(undefined, 5);
  assert.equal(result.candidateSourceLines, 0);
  assert.equal(result.possiblyIncomplete, false);
});

test('suspectPages points at the page with the largest candidate/extracted gap', () => {
  const page1 = Array.from({ length: 3 }, (_, i) => `- Page 1 bullet ${i}`).join('\n');
  const page2 = Array.from({ length: 10 }, (_, i) => `- Page 2 bullet ${i}`).join('\n');
  const sourceText = `## Page 1\n\n${page1}\n\n## Page 2\n\n${page2}`;
  const itemsByPage = new Map([[1, 2]]); // page 2 has no extracted items at all
  const result = estimateCompleteness(sourceText, 2, itemsByPage);
  assert.equal(result.possiblyIncomplete, true);
  assert.deepEqual(result.suspectPages, [2]);
});

test('suspectPages is omitted without itemsByPage even when possiblyIncomplete fires', () => {
  const sourceText = `## Page 1\n\n${Array.from({ length: 20 }, (_, i) => `- Bullet ${i}`).join('\n')}`;
  const result = estimateCompleteness(sourceText, 2);
  assert.equal(result.possiblyIncomplete, true);
  assert.equal(result.suspectPages, undefined);
});

test('suspectPages is omitted when the text has no page/slide markers (e.g. DOCX)', () => {
  const sourceText = Array.from({ length: 20 }, (_, i) => `- Bullet ${i}`).join('\n');
  const itemsByPage = new Map([[1, 2]]);
  const result = estimateCompleteness(sourceText, 2, itemsByPage);
  assert.equal(result.possiblyIncomplete, true);
  assert.equal(result.suspectPages, undefined);
});

test('recognizes ## Slide N markers (PPTX Track A) the same way as ## Page N', () => {
  const slide1 = Array.from({ length: 2 }, (_, i) => `- Slide 1 bullet ${i}`).join('\n');
  const slide2 = Array.from({ length: 9 }, (_, i) => `- Slide 2 bullet ${i}`).join('\n');
  const sourceText = `## Slide 1\n\n${slide1}\n\n## Slide 2\n\n${slide2}`;
  const itemsByPage = new Map([[1, 2]]);
  const result = estimateCompleteness(sourceText, 2, itemsByPage);
  assert.equal(result.possiblyIncomplete, true);
  assert.deepEqual(result.suspectPages, [2]);
});
