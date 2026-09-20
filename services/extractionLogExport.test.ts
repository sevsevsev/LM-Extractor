import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTRACTION_LOG_HEADERS,
  buildExtractionLogCsv,
  buildExtractionLogRows,
  countExtractionLogRows,
} from '../services/extractionLogExport.ts';
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
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    impact: { content: [] },
    layoutFamily: 'vertical_columns',
    ...overrides,
  };
}

/**
 * Read a cell by header name rather than by position.
 *
 * This log gains columns as the offline analysis loop matures (prompt_version / prompt_variant
 * were added 2026-09-19), and positional indices made every such addition break a dozen unrelated
 * assertions. Keying on the header also means a test fails when a column is *renamed*, which is
 * the thing that would actually break a saved analysis script.
 */
function cell(row: string[], header: string): string {
  const index = EXTRACTION_LOG_HEADERS.indexOf(header);
  assert.ok(index >= 0, `unknown extraction-log column "${header}"`);
  return row[index];
}

function fakeFile(id: string, overrides: Partial<ProcessingFile> = {}): ProcessingFile {
  return {
    id,
    file: { name: `${id}.pdf` } as File,
    status: 'editing',
    result: sampleModel(),
    ...overrides,
  };
}

test('countExtractionLogRows counts editing/completed/error files only', () => {
  const files: ProcessingFile[] = [
    fakeFile('f1', { status: 'editing' }),
    fakeFile('f2', { status: 'completed' }),
    fakeFile('f3', { status: 'error', result: undefined, extractionBlockers: ['Illegible'] }),
    fakeFile('f4', { status: 'extracting', result: undefined }),
    fakeFile('f5', { status: 'pending', result: undefined }),
  ];
  assert.equal(countExtractionLogRows(files), 3);
});

test('buildExtractionLogRows carries fidelity fields for a clean file', () => {
  const model = sampleModel({
    extractionStatus: 'ok',
    extractionConfidence: 'high',
  });
  const rows = buildExtractionLogRows([fakeFile('f1', { result: model })]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(cell(row, 'source_filename'), 'f1.pdf');
  assert.equal(cell(row, 'pipeline_status'), 'editing');
  assert.equal(cell(row, 'organization'), 'Org A');
  assert.equal(cell(row, 'program'), 'Prog A');
  assert.equal(cell(row, 'qa_status'), 'Successfully Processed');
  assert.equal(cell(row, 'extraction_status'), 'ok');
  assert.equal(cell(row, 'extraction_confidence'), 'high');
});

test('buildExtractionLogRows records which prompt version and variant produced the row', () => {
  const rows = buildExtractionLogRows([
    fakeFile('f1', { promptVersion: '2026-09-19.1', promptVariant: 'vision+text+lowleg' }),
  ]);
  assert.equal(cell(rows[0], 'prompt_version'), '2026-09-19.1');
  assert.equal(cell(rows[0], 'prompt_variant'), 'vision+text+lowleg');
});

test('buildExtractionLogRows leaves prompt columns blank for a file extracted before they existed', () => {
  // Resumed sessions checkpointed before this shipped carry no prompt provenance; blank is the
  // honest answer, and analysis must be able to tell "unknown" from a real variant.
  const rows = buildExtractionLogRows([fakeFile('f1')]);
  assert.equal(cell(rows[0], 'prompt_version'), '');
  assert.equal(cell(rows[0], 'prompt_variant'), '');
});

test('buildExtractionLogRows carries blockers, counts, and a Needs Review status for a flagged file', () => {
  const model = sampleModel({
    extractionStatus: 'partial',
    extractionConfidence: 'medium',
    extractionBlockers: ['Layout/label mismatch — review unmapped items'],
    mappingCorrections: [
      {
        at: '2026-01-01T00:00:00Z',
        fileId: 'f1',
        action: 'assign_domain',
        itemKey: 'k1',
        itemText: 'x',
        fromDomain: null,
        toDomain: 'inputs',
      },
    ],
    possiblyMissedRegions: [{ page: 2, note: 'maybe missed' }],
  });
  const rows = buildExtractionLogRows([fakeFile('f1', { result: model })]);
  const row = rows[0];
  assert.equal(cell(row, 'qa_status'), 'Needs Review');
  assert.equal(cell(row, 'extraction_status'), 'partial');
  assert.equal(cell(row, 'extraction_confidence'), 'medium');
  assert.ok(cell(row, 'extraction_blockers').includes('Layout/label mismatch'));
  assert.equal(cell(row, 'mapping_corrections_count'), '1');
  assert.equal(cell(row, 'possibly_missed_regions_count'), '1');
});

test('buildExtractionLogRows carries the document type flag when present', () => {
  const model = sampleModel({ documentTypeAssessment: 'not_logic_model' });
  const rows = buildExtractionLogRows([fakeFile('f1', { result: model })]);
  assert.match(cell(rows[0], 'document_type_flag'), /^Not a logic model —/);
});

test('buildExtractionLogRows includes a hard-stopped (error) file using its own blockers', () => {
  const rows = buildExtractionLogRows([
    fakeFile('f1', {
      status: 'error',
      result: undefined,
      error: 'Extraction stopped: Illegible grid',
      extractionBlockers: ['Illegible grid'],
    }),
  ]);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(cell(row, 'source_filename'), 'f1.pdf');
  assert.equal(cell(row, 'pipeline_status'), 'error');
  assert.equal(cell(row, 'organization'), '');
  assert.equal(cell(row, 'program'), '');
  assert.equal(cell(row, 'qa_status'), 'Error');
  assert.ok(cell(row, 'extraction_blockers').includes('Illegible grid'));
  assert.equal(cell(row, 'error_message'), 'Extraction stopped: Illegible grid');
});

test('buildExtractionLogRows skips files still mid-pipeline', () => {
  const rows = buildExtractionLogRows([
    fakeFile('f1', { status: 'pending', result: undefined }),
    fakeFile('f2', { status: 'converting', result: undefined }),
    fakeFile('f3', { status: 'detecting', result: undefined }),
    fakeFile('f4', { status: 'extracting', result: undefined }),
  ]);
  assert.equal(rows.length, 0);
});

test('buildExtractionLogRows carries the split part label when present', () => {
  const rows = buildExtractionLogRows([fakeFile('f1', { splitPartLabel: 'Part 2 of 7' })]);
  assert.equal(cell(rows[0], 'source_filename'), 'f1.pdf — Part 2 of 7'); // via displayFileName
  assert.equal(cell(rows[0], 'split_part_label'), 'Part 2 of 7');
});

test('buildExtractionLogCsv returns null when there is nothing to log yet', () => {
  assert.equal(buildExtractionLogCsv([fakeFile('f1', { status: 'pending', result: undefined })]), null);
});

test('buildExtractionLogCsv has the expected header row', () => {
  const csv = buildExtractionLogCsv([fakeFile('f1')]);
  assert.ok(csv);
  const header = csv!.split('\n')[0];
  assert.equal(header, EXTRACTION_LOG_HEADERS.map(h => `"${h}"`).join(','));
  // Spot-check that the columns an offline analysis script keys on are actually present.
  for (const required of [
    'source_filename',
    'prompt_version',
    'prompt_variant',
    'qa_status',
    'extraction_status',
    'extraction_confidence',
  ]) {
    assert.ok(EXTRACTION_LOG_HEADERS.includes(required), `missing column ${required}`);
  }
});

test('buildExtractionLogRows derives source_format from the filename extension', () => {
  const pdfRow = buildExtractionLogRows([fakeFile('a', { file: { name: 'a.pdf' } as File })])[0];
  const docxRow = buildExtractionLogRows([fakeFile('b', { file: { name: 'b.DOCX' } as File })])[0];
  const pptxRow = buildExtractionLogRows([fakeFile('c', { file: { name: 'c.pptx' } as File })])[0];
  assert.equal(cell(pdfRow, 'source_format'), 'pdf');
  assert.equal(cell(docxRow, 'source_format'), 'docx');
  assert.equal(cell(pptxRow, 'source_format'), 'pptx');
});

test('buildExtractionLogRows carries warnings (e.g. text-only fallback) and pages processed', () => {
  const rows = buildExtractionLogRows([
    fakeFile('f1', {
      warnings: ["Couldn't read this document as images, so it was analyzed as plain text."],
      sourcePreviewImages: ['img1', 'img2', 'img3'],
    }),
  ]);
  assert.ok(cell(rows[0], 'warnings').includes('analyzed as plain text'));
  assert.equal(cell(rows[0], 'pages_processed'), '3');
});

test('buildExtractionLogRows leaves pages_processed blank rather than 0 when previews are unavailable', () => {
  const rows = buildExtractionLogRows([fakeFile('f1')]);
  assert.equal(cell(rows[0], 'pages_processed'), '');
});

test('buildExtractionLogRows carries the full mappingCorrections and possiblyMissedRegions as JSON', () => {
  const model = sampleModel({
    mappingCorrections: [
      {
        at: '2026-01-01T00:00:00Z',
        fileId: 'f1',
        action: 'assign_domain',
        itemKey: 'k1',
        itemText: 'Volunteers feel more confident',
        fromDomain: null,
        toDomain: 'shortTermOutcomes',
        sourceHeader: 'Outcomes',
      },
    ],
    possiblyMissedRegions: [{ page: 2, xStart: 0.1, xEnd: 0.4, note: 'left column looks cut off' }],
  });
  const rows = buildExtractionLogRows([fakeFile('f1', { result: model })]);
  const parsedCorrections = JSON.parse(cell(rows[0], 'mapping_corrections_json'));
  const parsedRegions = JSON.parse(cell(rows[0], 'possibly_missed_regions_json'));
  assert.equal(parsedCorrections[0].sourceHeader, 'Outcomes');
  assert.equal(parsedRegions[0].note, 'left column looks cut off');
});
