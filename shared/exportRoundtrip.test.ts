import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { LogicModel, LogicModelGroup } from '../types';
import { checkExportRoundtrip, diffReconstitution, reconstituteFromExportRows } from './exportRoundtrip.js';
import { buildGranularExportRows, type GranularExportEntry } from './domainPresence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OXFORD_SNAPSHOT = path.join(
  __dirname,
  '..',
  'fixtures',
  'oxford-circle-carnell-frc',
  'extract-snapshot.json'
);

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

function entry(model: LogicModel, sourceFilename = 'test.pdf'): GranularExportEntry {
  return { model, sourceFilename };
}

test('a full model round-trips through export with zero discrepancies', () => {
  const model = fullModel();
  const [{ issues }] = checkExportRoundtrip([entry(model)]);
  assert.deepEqual(issues, []);
});

test('absent optional domains (empty mission, no medium-term, no impact) produce no false discrepancies', () => {
  const model = fullModel(); // mission empty, mediumTermOutcomes/impact already []
  const rows = buildGranularExportRows([entry(model)]);
  assert.ok(!rows.some(r => r.domain === 'Mission / Overview'), 'empty mission should not produce a row');
  assert.ok(!rows.some(r => r.domain === 'Medium-Term Outcomes'), 'empty medium-term should not produce a row');
  const [{ issues }] = checkExportRoundtrip([entry(model)]);
  assert.deepEqual(issues, []);
});

test('multiple distinct models in one batch export round-trip independently', () => {
  const a = fullModel({ organization: 'Org A', program: 'Program A' });
  const b = fullModel({
    organization: 'Org B',
    program: 'Program B',
    inputs: { content: groups([['Human', ['Different staff entirely']]]) },
  });
  const results = checkExportRoundtrip([entry(a, 'a.pdf'), entry(b, 'b.pdf')]);
  assert.equal(results.length, 2);
  for (const { issues } of results) assert.deepEqual(issues, []);
});

test('diffReconstitution catches a dropped item', () => {
  const model = fullModel();
  const rows = buildGranularExportRows([entry(model)]);
  const dropped = rows.filter(r => r.content !== 'Community outreach'); // simulate a lost row
  const reconstituted = reconstituteFromExportRows(dropped);
  const issues = diffReconstitution(model, reconstituted.get('test.pdf'));
  assert.ok(issues.some(i => i.includes('Community outreach') && i.includes('1x in the model but 0x')));
});

test('diffReconstitution catches an item moved to the wrong domain', () => {
  const model = fullModel();
  const rows = buildGranularExportRows([entry(model)]);
  const moved = rows.map(r =>
    r.content === 'Tabling events' ? { ...r, domain: 'Outputs' } : r
  );
  const reconstituted = reconstituteFromExportRows(moved);
  const issues = diffReconstitution(model, reconstituted.get('test.pdf'));
  assert.ok(issues.some(i => i.includes('Activities') && i.includes('Tabling events')));
  assert.ok(issues.some(i => i.includes('Outputs') && i.includes('Tabling events')));
});

test('diffReconstitution catches an invented item not present in the source model', () => {
  const model = fullModel();
  const rows = buildGranularExportRows([entry(model)]);
  const invented = [...rows, { ...rows[0], domain: 'Outputs', group: 'General', content: 'Fabricated deliverable' }];
  const reconstituted = reconstituteFromExportRows(invented);
  const issues = diffReconstitution(model, reconstituted.get('test.pdf'));
  assert.ok(issues.some(i => i.includes('Fabricated deliverable')));
});

test('two files sharing identical organization+program are told apart by source filename', () => {
  // Previously a known limitation (reconstitution grouped by organization::program alone, so two
  // genuinely different files with matching org+program text collided into one). Fixed by keying
  // on sourceFilename instead — see shared/domainPresence.ts's GranularExportRow.
  const a = fullModel({ organization: 'Same Org', program: 'Same Program' });
  const b = fullModel({
    organization: 'Same Org',
    program: 'Same Program',
    inputs: { content: groups([['Human', ['A totally different staffing list']]]) },
  });
  const rows = buildGranularExportRows([entry(a, 'a.pdf'), entry(b, 'b.pdf')]);
  const reconstituted = reconstituteFromExportRows(rows);
  assert.equal(reconstituted.size, 2, 'files with distinct filenames reconstitute separately');
  assert.deepEqual(diffReconstitution(a, reconstituted.get('a.pdf')), []);
  assert.deepEqual(diffReconstitution(b, reconstituted.get('b.pdf')), []);
});

test('a real extracted model (Oxford Circle gold fixture) round-trips through export with zero discrepancies', t => {
  // Every other test here uses hand-built synthetic models — this is the one case that runs the
  // checker against the real granular CSV export path fed by an actual Gemini extraction (colors,
  // sourceNote, mappedBy, multi-group domains, and all), which is what the module's own docstring
  // claims it validates. Found via codebase audit (docs/specs/codebase-audit-2026-09-19.md #14) that
  // this never actually happened. Depends on the committed gold snapshot from finding #5.
  if (!fs.existsSync(OXFORD_SNAPSHOT)) {
    t.skip('no oxford-circle extract-snapshot.json — see fixtures/oxford-circle-carnell-frc/README.md');
    return;
  }
  const model = JSON.parse(fs.readFileSync(OXFORD_SNAPSHOT, 'utf8')) as LogicModel;
  const [{ issues }] = checkExportRoundtrip([entry(model, 'oxford-circle.pdf')]);
  assert.deepEqual(issues, []);
});

test('two files sharing both organization+program AND filename still collide (filename is the id)', () => {
  const a = fullModel({ organization: 'Same Org', program: 'Same Program' });
  const b = fullModel({
    organization: 'Same Org',
    program: 'Same Program',
    inputs: { content: groups([['Human', ['A totally different staffing list']]]) },
  });
  const rows = buildGranularExportRows([entry(a, 'same-name.pdf'), entry(b, 'same-name.pdf')]);
  const reconstituted = reconstituteFromExportRows(rows);
  assert.equal(reconstituted.size, 1, 'a duplicate filename is still the one thing that cannot be disambiguated');
});
