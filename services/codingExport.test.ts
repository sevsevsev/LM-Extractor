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
  assert.equal(header, '"row_id","organization","program","group","domain","outcome_text"');
});

test('coding export returns null when no outcome text', () => {
  const empty = sampleModel({
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
  });
  assert.equal(buildCodingExportCsv([fakeFile('f1', empty)]), null);
});
