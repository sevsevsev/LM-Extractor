import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGranularExportRows, groupedDomainHasContent, stringDomainHasContent } from './domainPresence.ts';
import type { LogicModel } from '../types.ts';

const baseModel = (): LogicModel => ({
  organization: 'Org',
  program: 'Prog',
  mission: { content: '' },
  targetPopulation: { content: 'Students' },
  inputs: { content: [{ name: 'Human', items: [{ text: 'Teacher' }] }] },
  activities: { content: [{ name: 'General', items: [{ text: 'Class' }] }] },
  outputs: { content: [{ name: 'General', items: [{ text: 'Attendance 90%' }] }] },
  shortTermOutcomes: { content: [{ name: 'General', items: [{ text: 'Learn technique' }] }] },
  mediumTermOutcomes: { content: [] },
  longTermOutcomes: { content: [{ name: 'General', items: [{ text: 'Graduate' }] }] },
  impact: { content: [] },
});

test('stringDomainHasContent and groupedDomainHasContent', () => {
  assert.equal(stringDomainHasContent('  '), false);
  assert.equal(stringDomainHasContent('x'), true);
  assert.equal(groupedDomainHasContent([{ name: 'G', items: [{ text: '' }] }]), false);
  assert.equal(groupedDomainHasContent([{ name: 'G', items: [{ text: 'a' }] }]), true);
});

test('buildGranularExportRows omits empty mission and empty grouped domains', () => {
  const rows = buildGranularExportRows([{ model: baseModel(), sourceFilename: 'test.pdf' }]);
  const domains = rows.map(r => r.domain);
  assert.ok(!domains.includes('Mission / Overview'));
  assert.ok(!domains.includes('Medium-Term Outcomes'));
  assert.ok(!domains.includes('Impact'));
  assert.ok(domains.includes('Target Population'));
  assert.ok(domains.includes('Outputs'));
});

test('buildGranularExportRows carries extraction fidelity and mapping fields per row', () => {
  const model: LogicModel = {
    ...baseModel(),
    extractionStatus: 'partial',
    extractionConfidence: 'medium',
    extractionBlockers: ['Some items flagged non-verbatim — verify against source'],
  };
  const rows = buildGranularExportRows([{ model, sourceFilename: 'test.pdf' }]);
  assert.ok(rows.every(r => r.extractionStatus === 'partial'));
  assert.ok(rows.every(r => r.extractionConfidence === 'medium'));
  assert.ok(rows.every(r => r.extractionBlockers.includes('non-verbatim')));
});

test('buildGranularExportRows carries sourceFilename on every row', () => {
  const rows = buildGranularExportRows([
    { model: baseModel(), sourceFilename: '1234_5678_foster-grandparent.pdf' },
  ]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => r.sourceFilename === '1234_5678_foster-grandparent.pdf'));
});

test('buildGranularExportRows carries a QA status matching the session list flag', () => {
  const clean = buildGranularExportRows([{ model: baseModel(), sourceFilename: 'a.pdf' }]);
  assert.ok(clean.every(r => r.qaStatus === 'Successfully Processed'));

  const flagged: LogicModel = {
    ...baseModel(),
    extractionStatus: 'partial',
    extractionConfidence: 'medium',
  };
  const flaggedRows = buildGranularExportRows([{ model: flagged, sourceFilename: 'b.pdf' }]);
  assert.ok(flaggedRows.every(r => r.qaStatus === 'Needs Review'));
});

test('buildGranularExportRows includes generalOutcomes as its own domain when present', () => {
  const model: LogicModel = {
    ...baseModel(),
    generalOutcomes: {
      content: [{ name: 'General', items: [{ text: 'Participants report increased confidence' }] }],
    },
  };
  const rows = buildGranularExportRows([{ model, sourceFilename: 'single-outcomes.pdf' }]);
  const generalOutcomeRows = rows.filter(r => r.domain === 'General Outcomes');
  assert.equal(generalOutcomeRows.length, 1);
  assert.equal(generalOutcomeRows[0].content, 'Participants report increased confidence');
  // Must not also be duplicated into shortTermOutcomes.
  assert.ok(
    !rows.some(r => r.domain === 'Short-Term Outcomes' && r.content === 'Participants report increased confidence')
  );
});

test('buildGranularExportRows carries a document type flag when Gemini flags the source', () => {
  const clean = buildGranularExportRows([{ model: baseModel(), sourceFilename: 'a.pdf' }]);
  assert.ok(clean.every(r => r.documentTypeFlag === ''));

  const flagged: LogicModel = { ...baseModel(), documentTypeAssessment: 'not_logic_model' };
  const flaggedRows = buildGranularExportRows([{ model: flagged, sourceFilename: 'toc.pdf' }]);
  assert.ok(flaggedRows.length > 0);
  // baseModel fills the grid, so no row may claim the document is not a logic model.
  assert.ok(flaggedRows.every(r => /^No column grid in this document —/.test(r.documentTypeFlag)));
  assert.ok(flaggedRows.every(r => !r.documentTypeFlag.includes('Not a logic model')));
});

test('buildGranularExportRows carries an alternate outcome taxonomy through as the group column, not "General"', () => {
  const model: LogicModel = {
    ...baseModel(),
    generalOutcomes: {
      content: [
        { name: 'Attitudes', items: [{ text: 'Volunteers feel more confident' }] },
        { name: 'Behaviors', items: [{ text: 'Volunteers attend more sessions' }] },
      ],
    },
  };
  const rows = buildGranularExportRows([{ model, sourceFilename: 'abc.pdf' }]);
  const generalOutcomeRows = rows.filter(r => r.domain === 'General Outcomes');
  assert.equal(generalOutcomeRows.length, 2);
  assert.ok(generalOutcomeRows.some(r => r.group === 'Attitudes' && r.content.includes('more confident')));
  assert.ok(generalOutcomeRows.some(r => r.group === 'Behaviors' && r.content.includes('more sessions')));
});

test('buildGranularExportRows omits generalOutcomes when absent or empty', () => {
  const withoutField = buildGranularExportRows([{ model: baseModel(), sourceFilename: 'a.pdf' }]);
  assert.ok(!withoutField.some(r => r.domain === 'General Outcomes'));

  const withEmptyField: LogicModel = { ...baseModel(), generalOutcomes: { content: [] } };
  const withEmpty = buildGranularExportRows([{ model: withEmptyField, sourceFilename: 'b.pdf' }]);
  assert.ok(!withEmpty.some(r => r.domain === 'General Outcomes'));
});
