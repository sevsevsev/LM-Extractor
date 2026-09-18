import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCodingExportCsv, buildCodingExportRows, countCodingExportRows } from '../services/codingExport.ts';
import type { LogicModel, ProcessingFile } from '../types.ts';

function sampleModel(overrides: Partial<LogicModel> = {}): LogicModel {
  return {
    organization: 'Org A',
    program: 'Prog A',
    mission: { content: 'Mission' },
    targetPopulation: { content: 'Youth' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: {
      content: [{ name: 'Students', items: [{ text: 'Increased awareness of reading' }] }],
    },
    mediumTermOutcomes: {
      content: [{ name: 'Students', items: [{ text: 'Improved reading habits' }, { text: '  ' }] }],
    },
    longTermOutcomes: { content: [{ name: 'General', items: [{ text: 'Higher literacy rates' }] }] },
    impact: { content: [{ name: 'Community', items: [{ text: 'Stronger neighborhoods' }] }] },
    ...overrides,
  };
}

function fakeFile(id: string, model: LogicModel): ProcessingFile {
  return {
    id,
    file: { name: `${id}.pdf` } as File,
    status: 'editing',
    result: model,
  };
}

test('coding export includes only short/medium/long outcome rows with outcome_text', () => {
  const files = [fakeFile('f1', sampleModel())];
  const rows = buildCodingExportRows(files);
  assert.equal(rows.length, 3);
  assert.equal(countCodingExportRows(files), 3);
  assert.ok(rows.every(r => r[5].trim().length > 0));
  assert.ok(rows.some(r => r[5] === 'Increased awareness of reading'));
  assert.ok(!rows.some(r => r[5] === 'Stronger neighborhoods'));
});

test('coding export CSV has coder headers', () => {
  const csv = buildCodingExportCsv([fakeFile('f1', sampleModel())]);
  assert.ok(csv);
  const header = csv!.split('\n')[0];
  assert.equal(
    header,
    '"row_id","organization","program","group","domain","outcome_text","color_coding","needs_review","color_legend","source_filename","qa_status"'
  );
});

test('coding export carries the uploaded filename on every row', () => {
  const rows = buildCodingExportRows([fakeFile('f1', sampleModel())]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r[9] === 'f1.pdf'));
});

test('coding export carries QA status, reusing the same signal as the session list', () => {
  const clean = buildCodingExportRows([fakeFile('f1', sampleModel())]);
  assert.ok(clean.every(r => r[10] === 'Successfully Processed'));

  const flagged = sampleModel({ extractionStatus: 'partial', extractionConfidence: 'medium' });
  const flaggedRows = buildCodingExportRows([fakeFile('f2', flagged)]);
  assert.ok(flaggedRows.every(r => r[10] === 'Needs Review'));
});

test('coding export carries colour coding, needs-review flag, and legend', () => {
  const model = sampleModel({
    colorLegend: 'Orange = students; Purple = families',
    shortTermOutcomes: {
      content: [
        {
          name: 'General',
          items: [
            { text: 'Increased awareness', fillColor: 'orange', borderColor: 'red' },
            { text: 'Clipped item', verbatim: false, sourceNote: 'text appears clipped' },
          ],
        },
      ],
    },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
  });
  const rows = buildCodingExportRows([fakeFile('f1', model)]);
  const colored = rows.find(r => r[5] === 'Increased awareness');
  const flagged = rows.find(r => r[5] === 'Clipped item');
  assert.ok(colored);
  assert.equal(colored![6], 'orange border:red');
  assert.equal(colored![7], '');
  assert.equal(colored![8], 'Orange = students; Purple = families');
  assert.ok(flagged);
  assert.equal(flagged![7], 'Yes');
});

test('coding export includes generalOutcomes rows under the General Outcomes domain', () => {
  const model = sampleModel({
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    generalOutcomes: {
      content: [{ name: 'General', items: [{ text: 'Participants report increased confidence' }] }],
    },
  });
  const rows = buildCodingExportRows([fakeFile('f1', model)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][4], 'General Outcomes'); // domain column
  assert.equal(rows[0][5], 'Participants report increased confidence'); // outcome_text column
});

test('coding export does not crash or drop rows when generalOutcomes is absent (most files)', () => {
  const rows = buildCodingExportRows([fakeFile('f1', sampleModel())]);
  assert.equal(rows.length, 3);
});

test('coding export returns null when no outcome text', () => {
  const empty = sampleModel({
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
  });
  assert.equal(buildCodingExportCsv([fakeFile('f1', empty)]), null);
});
