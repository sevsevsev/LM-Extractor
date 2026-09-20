import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  columnIndexFromRef,
  countMarkdownSheets,
  gridToMarkdownTable,
  parseSharedStrings,
  parseSheetGrid,
  parseSheetNames,
  sheetsToMarkdown,
  trimGrid,
} from './xlsxGrid.ts';

test('columnIndexFromRef handles single and multi-letter columns', () => {
  assert.equal(columnIndexFromRef('A1'), 0);
  assert.equal(columnIndexFromRef('D7'), 3);
  assert.equal(columnIndexFromRef('Z1'), 25);
  assert.equal(columnIndexFromRef('AA1'), 26);
  assert.equal(columnIndexFromRef('BC12'), 54);
  assert.equal(columnIndexFromRef('12'), -1);
});

test('parseSharedStrings reads plain and rich-text entries', () => {
  const xml = `<sst count="3"><si><t>WELLNESS</t></si><si><r><t>Home</t></r><r><t>work</t></r></si><si/></sst>`;
  assert.deepEqual(parseSharedStrings(xml), ['WELLNESS', 'Homework', '']);
});

test('parseSharedStrings decodes entities without double-decoding', () => {
  const xml = `<sst><si><t>Math &amp; reading</t></si><si><t>&amp;lt;not a tag&amp;gt;</t></si></sst>`;
  assert.deepEqual(parseSharedStrings(xml), ['Math & reading', '&lt;not a tag&gt;']);
});

/**
 * The property everything else depends on: a sparse row must keep its column positions. A logic
 * model in a spreadsheet is a grid, and which column a value sits in is the whole signal — if a
 * gap collapses, every item after it shifts into the wrong column.
 */
test('parseSheetGrid preserves column position across gaps', () => {
  const shared = ['WELLNESS', 'CULTURAL', 'ACADEMIC'];
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="E1" t="s"><v>0</v></c><c r="G1" t="s"><v>1</v></c><c r="I1" t="s"><v>2</v></c></row>
  </sheetData></worksheet>`;
  const grid = parseSheetGrid(sheet, shared);
  assert.equal(grid.length, 1);
  assert.equal(grid[0][4], 'WELLNESS');
  assert.equal(grid[0][6], 'CULTURAL');
  assert.equal(grid[0][8], 'ACADEMIC');
  assert.equal(grid[0][5], '');
});

test('parseSheetGrid reads inline strings, numbers, booleans and formula results', () => {
  const sheet = `<worksheet><sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Inline</t></is></c>
      <c r="B1"><v>42</v></c>
      <c r="C1" t="b"><v>1</v></c>
      <c r="D1" t="str"><f>CONCAT(A1,B1)</f><v>Inline42</v></c>
      <c r="E1"/>
    </row>
  </sheetData></worksheet>`;
  assert.deepEqual(parseSheetGrid(sheet, []), [['Inline', '42', 'TRUE', 'Inline42', '']]);
});

test('parseSheetGrid yields an empty cell for an out-of-range shared-string index', () => {
  const sheet = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>9</v></c></row></sheetData></worksheet>`;
  assert.deepEqual(parseSheetGrid(sheet, ['only']), [['']]);
});

test('trimGrid drops trailing blank rows and columns but keeps interior gaps', () => {
  const grid = [
    ['A', '', 'C', '', ''],
    ['', '', '', '', ''],
    ['D', '', '', '', ''],
    ['', '', '', '', ''],
  ];
  assert.deepEqual(trimGrid(grid), [
    ['A', '', 'C'],
    ['', '', ''],
    ['D', '', ''],
  ]);
  assert.deepEqual(trimGrid([['', ''], ['']]), []);
});

test('gridToMarkdownTable uses the first populated row as the header and skips spacer rows', () => {
  const md = gridToMarkdownTable([
    ['', ''],
    ['WELLNESS', 'ACADEMIC'],
    ['', ''],
    ['Dance activities', 'Homework assistance'],
  ]);
  assert.equal(
    md,
    ['| WELLNESS | ACADEMIC |', '| --- | --- |', '| Dance activities | Homework assistance |'].join('\n')
  );
});

test('gridToMarkdownTable neutralises pipes and newlines that would break the table', () => {
  const md = gridToMarkdownTable([['Goal | Purpose'], ['Line one\nLine two']]);
  assert.ok(md.includes('Goal \\| Purpose'), md);
  assert.ok(md.includes('Line one — Line two'), md);
  assert.equal(md.split('\n').length, 3, 'an embedded newline must not create an extra row');
});

test('sheetsToMarkdown labels each sheet and drops empty ones', () => {
  const out = sheetsToMarkdown([
    { name: 'Framework', grid: [['GOAL'], ['Empower youth']] },
    { name: 'Blank', grid: [['', ''], ['']] },
    { name: 'Indicators', grid: [['Indicator'], ['Attendance']] },
  ]);
  assert.ok(out.includes('## Sheet: Framework'));
  assert.ok(out.includes('## Sheet: Indicators'));
  assert.ok(!out.includes('Blank'), 'an empty sheet must not appear as a real but contentless section');
});

test('parseSheetNames reads workbook order', () => {
  const xml = `<workbook><sheets><sheet name="Framework" sheetId="1" r:id="rId1"/><sheet name="Notes &amp; Risks" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  assert.deepEqual(parseSheetNames(xml), ['Framework', 'Notes & Risks']);
});

/**
 * End-to-end against the real shape of a partner workbook: Puentes de Salud's "Results Framework"
 * puts GOAL/PURPOSE prose in one column band and three outcome columns (WELLNESS / CULTURAL /
 * ACADEMIC) further right, with wide empty gaps between them. Drive's own flat text rendering of
 * this file collapses those columns into one comma run; the table must not.
 */
test('a Results-Framework-shaped sheet keeps its outcome columns aligned', () => {
  const shared = [
    'WELLNESS',
    'CULTURAL',
    'ACADEMIC',
    'Organize culturally rooted, joyful, and movement-based activities',
    'Create a supportive space where students can engage in cultural activities',
    'Homework Assistance',
  ];
  const sheet = `<worksheet><sheetData>
    <row r="1"><c r="E1" t="s"><v>0</v></c><c r="G1" t="s"><v>1</v></c><c r="I1" t="s"><v>2</v></c></row>
    <row r="2"><c r="E2" t="s"><v>3</v></c><c r="G2" t="s"><v>4</v></c><c r="I2" t="s"><v>5</v></c></row>
  </sheetData></worksheet>`;
  const grid = parseSheetGrid(sheet, shared);
  const md = gridToMarkdownTable(grid);
  const [headerLine, , dataLine] = md.split('\n');

  const headerCells = headerLine.split('|').map(s => s.trim());
  const dataCells = dataLine.split('|').map(s => s.trim());
  assert.equal(headerCells.indexOf('WELLNESS'), dataCells.indexOf('Organize culturally rooted, joyful, and movement-based activities'));
  assert.equal(headerCells.indexOf('CULTURAL'), dataCells.indexOf('Create a supportive space where students can engage in cultural activities'));
  assert.equal(headerCells.indexOf('ACADEMIC'), dataCells.indexOf('Homework Assistance'));
});

test('countMarkdownSheets counts the sheet blocks sheetsToMarkdown emits', () => {
  const md = sheetsToMarkdown([
    { name: 'TOC overview', grid: [['Inputs', 'Activities'], ['Staff', 'Tours']] },
    { name: 'Animal Academy', grid: [['Inputs', 'Activities'], ['Animals', 'Academy']] },
  ]);
  assert.equal(countMarkdownSheets(md), 2);
});

/**
 * The counter reads the marker `sheetsToMarkdown` writes, and they live in one file so a change to
 * either is read beside the other — a reader and a writer of the same format in separate files is
 * how `bundleImpliesLowLegibility` came to silently never fire (see types.ts).
 */
test('countMarkdownSheets stays in step with the emitter when a blank sheet is dropped', () => {
  const md = sheetsToMarkdown([
    { name: 'Real', grid: [['Inputs'], ['Staff']] },
    { name: 'Blank', grid: [] },
  ]);
  assert.equal(countMarkdownSheets(md), 1, 'a dropped blank sheet must not be counted');
});

test('countMarkdownSheets is 0 with no sheets and 1 for a single-sheet workbook', () => {
  assert.equal(countMarkdownSheets('## Page 1\n\nsome text'), 0);
  assert.equal(countMarkdownSheets(sheetsToMarkdown([{ name: 'Only', grid: [['A'], ['B']] }])), 1);
});
