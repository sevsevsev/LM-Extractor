import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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
  const [sourceFilename, pipelineStatus, organization, program, qaStatus, extractionStatus, extractionConfidence] =
    rows[0];
  assert.equal(sourceFilename, 'f1.pdf');
  assert.equal(pipelineStatus, 'editing');
  assert.equal(organization, 'Org A');
  assert.equal(program, 'Prog A');
  assert.equal(qaStatus, 'Successfully Processed');
  assert.equal(extractionStatus, 'ok');
  assert.equal(extractionConfidence, 'high');
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
  const [, , , , qaStatus, extractionStatus, extractionConfidence, extractionBlockers, , , , , , mappingCorrectionsCount, possiblyMissedRegionsCount] =
    rows[0];
  assert.equal(qaStatus, 'Needs Review');
  assert.equal(extractionStatus, 'partial');
  assert.equal(extractionConfidence, 'medium');
  assert.ok(extractionBlockers.includes('Layout/label mismatch'));
  assert.equal(mappingCorrectionsCount, '1');
  assert.equal(possiblyMissedRegionsCount, '1');
});

test('buildExtractionLogRows carries the document type flag when present', () => {
  const model = sampleModel({ documentTypeAssessment: 'not_logic_model' });
  const rows = buildExtractionLogRows([fakeFile('f1', { result: model })]);
  const documentTypeFlagIndex = 8;
  assert.equal(rows[0][documentTypeFlagIndex], 'Possibly Not a Logic Model');
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
  const [sourceFilename, pipelineStatus, organization, program, qaStatus, , , extractionBlockers, , , , , , , , , errorMessage] =
    rows[0];
  assert.equal(sourceFilename, 'f1.pdf');
  assert.equal(pipelineStatus, 'error');
  assert.equal(organization, '');
  assert.equal(program, '');
  assert.equal(qaStatus, 'Error');
  assert.ok(extractionBlockers.includes('Illegible grid'));
  assert.equal(errorMessage, 'Extraction stopped: Illegible grid');
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
  const splitPartLabelIndex = 15;
  assert.equal(rows[0][0], 'f1.pdf — Part 2 of 7'); // source_filename via displayFileName
  assert.equal(rows[0][splitPartLabelIndex], 'Part 2 of 7');
});

test('buildExtractionLogCsv returns null when there is nothing to log yet', () => {
  assert.equal(buildExtractionLogCsv([fakeFile('f1', { status: 'pending', result: undefined })]), null);
});

test('buildExtractionLogCsv has the expected header row', () => {
  const csv = buildExtractionLogCsv([fakeFile('f1')]);
  assert.ok(csv);
  const header = csv!.split('\n')[0];
  assert.equal(
    header,
    '"source_filename","pipeline_status","organization","program","qa_status","extraction_status","extraction_confidence","extraction_blockers","document_type_flag","layout_family","total_items","non_verbatim_items","unmapped_items","mapping_corrections_count","possibly_missed_regions_count","split_part_label","error_message"'
  );
});
