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

/**
 * THIS HEADER ROW IS AN INTEGRATION CONTRACT, NOT A STYLE CHOICE.
 *
 * It is the intake format of the Qualitative Outcomes Coder, which rejects uploads whose headers
 * it does not recognise (docs/specs/export-for-coding.md). Every change to this file so far has
 * been APPENDED so existing column positions stay stable.
 *
 * `outcome_text` in particular reads wrongly — it holds the text of every row, including Inputs
 * and Activities, so a coder looking at an Inputs row sees its text under a column called
 * "outcome_text". Renaming it is the obvious cleanup and it would break the downstream tool. The
 * full extract CSV is where plain naming belongs; it calls the same value `Item Text`
 * (shared/exportColumns.ts). Two audiences, two naming rules — do not unify them.
 *
 * If this test fails, the question is not "what is the new header row?" but "did the consumer
 * change?". Do not update the expected string to make it pass.
 */
test('coding export CSV header row matches the coder intake contract', () => {
  const csv = buildCodingExportCsv([fakeFile('f1', sampleModel())]);
  assert.ok(csv);
  const header = csv!.split('\n')[0];
  assert.equal(
    header,
    '"row_id","organization","program","group","domain","outcome_text","color_coding","needs_review","color_legend","source_filename","qa_status","document_type_flag"',
    'The coding CSV header row changed. This is the Qualitative Outcomes Coder intake contract — ' +
      'renaming, reordering or removing a column here breaks that tool. See docs/specs/export-for-coding.md.'
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

test('coding export carries a document type flag when Gemini flags the source', () => {
  const clean = buildCodingExportRows([fakeFile('f1', sampleModel())]);
  assert.ok(clean.every(r => r[11] === ''));

  const flagged = sampleModel({ documentTypeAssessment: 'unclear' });
  const flaggedRows = buildCodingExportRows([fakeFile('f2', flagged)]);
  assert.ok(flaggedRows.every(r => r[11] === 'Unclear Document Type'));
});

test('coding export carries an alternate outcome taxonomy through as the group column, not "General"', () => {
  const model = sampleModel({
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    generalOutcomes: {
      content: [
        { name: 'Attitudes', items: [{ text: 'Volunteers feel more confident' }] },
        { name: 'Conditions', items: [{ text: 'Fewer students falling behind' }] },
      ],
    },
  });
  const rows = buildCodingExportRows([fakeFile('f1', model)]);
  assert.equal(rows.length, 2);
  assert.ok(rows.some(r => r[3] === 'Attitudes' && r[5].includes('more confident'))); // group column
  assert.ok(rows.some(r => r[3] === 'Conditions' && r[5].includes('falling behind')));
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

/**
 * The offline analysis loop (run a batch → export CSVs → diff against source documents) depends on
 * one stable key shared by every artifact for a given item. Without it, matching a scorecard row
 * back to an extraction means fuzzy-matching item text — which is itself the thing under review,
 * and changes between runs whenever the model rewords something.
 */
test('granular and coding exports mint the same row_id for the same outcome item', async () => {
  const { buildGranularExportRows } = await import('../shared/domainPresence.ts');

  const model = sampleModel();
  const file = fakeFile('f1', model);

  const codingIds = new Set(buildCodingExportRows([file]).map(r => r[0]));
  const granularById = new Map(
    buildGranularExportRows([{ model, sourceFilename: 'f1.pdf', fileId: 'f1' }]).map(r => [
      r.rowId,
      r,
    ])
  );

  assert.equal(codingIds.size, 3);
  for (const id of codingIds) {
    const granular = granularById.get(id);
    assert.ok(granular, `coding row_id "${id}" has no matching granular row`);
  }

  // And the matched rows really are the same item, not just a coincidental key collision.
  const shortTermId = 'f1-shortTermOutcomes-0-0';
  assert.ok(codingIds.has(shortTermId));
  assert.equal(granularById.get(shortTermId)!.content, 'Increased awareness of reading');
  assert.equal(granularById.get(shortTermId)!.domain, 'Short-Term Outcomes');
});

test('granular row_id is stable and unique across domains, and blank without a fileId', async () => {
  const { buildGranularExportRows } = await import('../shared/domainPresence.ts');
  const model = sampleModel();

  const rows = buildGranularExportRows([{ model, sourceFilename: 'f1.pdf', fileId: 'f1' }]);
  const ids = rows.map(r => r.rowId);
  assert.equal(new Set(ids).size, ids.length, 'row_ids must be unique within a file');
  assert.ok(ids.includes('f1-mission'), 'string domains get a fileId-field key');
  assert.ok(ids.includes('f1-impact-0-0'));

  // Indices must reflect the real array positions, so a blank item does not shift later keys.
  assert.ok(ids.includes('f1-mediumTermOutcomes-0-0'));

  const withoutId = buildGranularExportRows([{ model, sourceFilename: 'f1.pdf' }]);
  assert.ok(withoutId.every(r => r.rowId === ''));
  assert.equal(withoutId.length, rows.length, 'omitting fileId must not change which rows exist');
});
