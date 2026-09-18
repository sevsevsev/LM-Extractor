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
