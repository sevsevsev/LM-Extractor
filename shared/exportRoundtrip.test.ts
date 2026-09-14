import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup } from '../types';
import { checkExportRoundtrip, diffReconstitution, reconstituteFromExportRows } from './exportRoundtrip.js';
import { buildGranularExportRows } from './domainPresence.js';

function groups(entries: [string, string[]][]): LogicModelGroup[] {
  return entries.map(([name, items]) => ({ name, items: items.map(text => ({ text })) }));
}

function fullModel(overrides: Partial<LogicModel> = {}): LogicModel {
  return {
    organization: 'Mayor\'s Office of Education',
    program: 'Foster Grandparent Program',
    impactStatement: { content: 'Every older adult and child thrives.' },
    mission: { content: '' },
    targetPopulation: { content: 'Low-income seniors and elementary students.' },
    inputs: { content: groups([['Human', ['Program staff', 'Volunteers']], ['Financial', ['AmeriCorps grant']]]) },
    activities: { content: groups([['General', ['Tabling events', 'Community outreach']]]) },
    outputs: { content: groups([['General', ['# of recruitment events per quarter']]]) },
    shortTermOutcomes: { content: groups([['General', ["Increase volunteers' understanding of early literacy"]]]) },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: groups([['General', ['Improve quality of life of senior volunteers']]]) },
    impact: { content: [] },
    layoutFamily: 'vertical_columns',
    ...overrides,
  };
}

test('a full model round-trips through export with zero discrepancies', () => {
  const model = fullModel();
  const [{ issues }] = checkExportRoundtrip([model]);
  assert.deepEqual(issues, []);
});

test('absent optional domains (empty mission, no medium-term, no impact) produce no false discrepancies', () => {
  const model = fullModel(); // mission empty, mediumTermOutcomes/impact already []
  const rows = buildGranularExportRows([model]);
  assert.ok(!rows.some(r => r.domain === 'Mission / Overview'), 'empty mission should not produce a row');
  assert.ok(!rows.some(r => r.domain === 'Medium-Term Outcomes'), 'empty medium-term should not produce a row');
  const [{ issues }] = checkExportRoundtrip([model]);
  assert.deepEqual(issues, []);
});

test('multiple distinct models in one batch export round-trip independently', () => {
  const a = fullModel({ organization: 'Org A', program: 'Program A' });
  const b = fullModel({
    organization: 'Org B',
    program: 'Program B',
    inputs: { content: groups([['Human', ['Different staff entirely']]]) },
  });
  const results = checkExportRoundtrip([a, b]);
  assert.equal(results.length, 2);
  for (const { issues } of results) assert.deepEqual(issues, []);
});

test('diffReconstitution catches a dropped item', () => {
  const model = fullModel();
  const rows = buildGranularExportRows([model]);
  const dropped = rows.filter(r => r.content !== 'Community outreach'); // simulate a lost row
  const reconstituted = reconstituteFromExportRows(dropped);
  const issues = diffReconstitution(model, reconstituted.get(`${model.organization}::${model.program}`));
  assert.ok(issues.some(i => i.includes('Community outreach') && i.includes('1x in the model but 0x')));
});

test('diffReconstitution catches an item moved to the wrong domain', () => {
  const model = fullModel();
  const rows = buildGranularExportRows([model]);
  const moved = rows.map(r =>
    r.content === 'Tabling events' ? { ...r, domain: 'Outputs' } : r
  );
  const reconstituted = reconstituteFromExportRows(moved);
  const issues = diffReconstitution(model, reconstituted.get(`${model.organization}::${model.program}`));
  assert.ok(issues.some(i => i.includes('Activities') && i.includes('Tabling events')));
  assert.ok(issues.some(i => i.includes('Outputs') && i.includes('Tabling events')));
});

test('diffReconstitution catches an invented item not present in the source model', () => {
  const model = fullModel();
  const rows = buildGranularExportRows([model]);
  const invented = [...rows, { ...rows[0], domain: 'Outputs', group: 'General', content: 'Fabricated deliverable' }];
  const reconstituted = reconstituteFromExportRows(invented);
  const issues = diffReconstitution(model, reconstituted.get(`${model.organization}::${model.program}`));
  assert.ok(issues.some(i => i.includes('Fabricated deliverable')));
});

test('KNOWN LIMITATION: two files sharing identical organization+program in one batch cannot be told apart', () => {
  // The granular CSV has no stable per-file id (unlike the coding export's row_id), so reconstitution
  // groups purely by organization::program. Two genuinely different documents that happen to share
  // that text collide into one reconstituted model. This test documents current behavior, not a goal.
  const a = fullModel({ organization: 'Same Org', program: 'Same Program' });
  const b = fullModel({
    organization: 'Same Org',
    program: 'Same Program',
    inputs: { content: groups([['Human', ['A totally different staffing list']]]) },
  });
  const rows = buildGranularExportRows([a, b]);
  const reconstituted = reconstituteFromExportRows(rows);
  assert.equal(reconstituted.size, 1, 'both files collapse into a single reconstituted key');
});
