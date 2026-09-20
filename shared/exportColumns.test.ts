import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FULL_EXPORT_COLUMNS,
  FULL_EXPORT_HEADERS,
  INTENTIONALLY_UNEXPORTED,
  fullExportRowValues,
} from './exportColumns.ts';
import type { GranularExportRow } from './domainPresence.ts';

/**
 * Every field set to its own name, so a misrouted column surfaces as the wrong field name.
 *
 * Typed as `Record<keyof GranularExportRow, string>` rather than cast: that makes TypeScript
 * enforce exhaustiveness, so adding a field to `GranularExportRow` fails the BUILD here until
 * someone decides whether it belongs in the CSV. That compile error is the point of this fixture.
 */
const PROBE_ROW: Record<keyof GranularExportRow, string> = {
  rowId: 'rowId',
  organization: 'organization',
  program: 'program',
  domain: 'domain',
  group: 'group',
  content: 'content',
  needsReview: 'needsReview',
  sourceNote: 'sourceNote',
  fillColor: 'fillColor',
  borderColor: 'borderColor',
  colorLegend: 'colorLegend',
  sourceHeader: 'sourceHeader',
  mappedBy: 'mappedBy',
  mappingConfidence: 'mappingConfidence',
  mappingNote: 'mappingNote',
  extractionStatus: 'extractionStatus',
  extractionConfidence: 'extractionConfidence',
  extractionBlockers: 'extractionBlockers',
  mappingCorrectionsJson: 'mappingCorrectionsJson',
  sourceFilename: 'sourceFilename',
  qaStatus: 'qaStatus',
  documentTypeFlag: 'documentTypeFlag',
};

describe('full export columns', () => {
  it('emits one value per header, in header order', () => {
    const values = fullExportRowValues(PROBE_ROW);
    assert.equal(
      values.length,
      FULL_EXPORT_HEADERS.length,
      'header count and row value count must match or every column right of the gap shifts'
    );
    values.forEach((value, i) => {
      assert.equal(value, FULL_EXPORT_COLUMNS[i].field, `column ${i} ("${FULL_EXPORT_HEADERS[i]}") read the wrong field`);
    });
  });

  it('has no duplicate headers or duplicate fields', () => {
    assert.equal(new Set(FULL_EXPORT_HEADERS).size, FULL_EXPORT_HEADERS.length, 'duplicate header text');
    const fields = FULL_EXPORT_COLUMNS.map(c => c.field);
    assert.equal(new Set(fields).size, fields.length, 'the same row field is exported twice');
  });

  /**
   * Adding a field to `GranularExportRow` and forgetting to export it is invisible — the CSV just
   * quietly lacks it. This forces the choice to be made and written down.
   */
  it('accounts for every row field: exported, or listed as intentionally unexported', () => {
    const exported = new Set<string>(FULL_EXPORT_COLUMNS.map(c => c.field));
    const excused = new Set(Object.keys(INTENTIONALLY_UNEXPORTED));
    const unaccounted = Object.keys(PROBE_ROW).filter(k => !exported.has(k) && !excused.has(k));
    assert.deepEqual(
      unaccounted,
      [],
      `add these to FULL_EXPORT_COLUMNS, or to INTENTIONALLY_UNEXPORTED with a reason: ${unaccounted.join(', ')}`
    );
  });

  /**
   * This file has no downstream consumer, so its headers exist to be read by a person. Keep them
   * out of schema/NLP vocabulary — see the plain-language pass in friction-log session 13.
   */
  it('uses plain-language headers, not schema or NLP vocabulary', () => {
    const banned = [
      'domain', 'verbatim', 'schema', 'enum', 'blocker', 'fidelity', 'nlp', 'token',
      'prompt', 'model', 'legibility', 'mapped by', 'mapping',
    ];
    for (const header of FULL_EXPORT_HEADERS) {
      // "logic model" is the domain term the readers of this file use every day; the banned
      // "model" is the machine-learning sense ("Model Confidence"). Strip the domain phrase
      // before checking so the guard stays precise instead of being weakened.
      const probe = header.toLowerCase().replace(/logic model/g, '');
      for (const word of banned) {
        assert.ok(
          !probe.includes(word),
          `full-CSV header "${header}" contains "${word}" — this file is read by a person, not a program`
        );
      }
      assert.ok(!/_/.test(header), `full-CSV header "${header}" is snake_case; use Title Case words`);
    }
  });
});
