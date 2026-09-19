import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  assertFixture,
  assertGroupsGeneralOnly,
  assertNotContainedAnywhere,
  assertPlacement,
  domainContainsSubstring,
} from './extractPlacement.ts';
import type { LogicModel } from '../types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');
const FIXTURE_DIR = path.join(FIXTURES_ROOT, 'performance-garage-youthmoves');
const EXPECTED_PATH = path.join(FIXTURE_DIR, 'expected-domains.json');
const SNAPSHOT_PATH = path.join(FIXTURE_DIR, 'extract-snapshot.json');

const OXFORD_DIR = path.join(FIXTURES_ROOT, 'oxford-circle-carnell-frc');
const OXFORD_EXPECTED = path.join(OXFORD_DIR, 'expected-domains.json');
const OXFORD_SNAPSHOT = path.join(OXFORD_DIR, 'extract-snapshot.json');

const misplacedModel: LogicModel = {
  organization: 'Org',
  program: 'Prog',
  mission: { content: '' },
  targetPopulation: { content: '' },
  inputs: { content: [] },
  activities: { content: [] },
  outputs: { content: [] },
  shortTermOutcomes: {
    content: [{ name: 'Summer Intensive', items: [{ text: 'Attendance maintained at 90%' }] }],
  },
  mediumTermOutcomes: { content: [] },
  longTermOutcomes: { content: [] },
  impact: { content: [] },
};

test('assertPlacement throws when item in wrong domain', () => {
  assert.throws(
    () =>
      assertPlacement(misplacedModel, {
        domain: 'outputs',
        group: 'Summer Intensive',
        contentContains: 'Attendance maintained',
        mustNotBeIn: ['shortTermOutcomes'],
      }),
    /not found|must not appear/
  );
});

test('assertPlacement passes when item correctly placed', () => {
  const good: LogicModel = {
    ...misplacedModel,
    outputs: {
      content: [{ name: 'Summer Intensive', items: [{ text: 'Attendance maintained at 90%' }] }],
    },
    shortTermOutcomes: { content: [] },
  };
  assert.doesNotThrow(() =>
    assertPlacement(good, {
      domain: 'outputs',
      group: 'Summer Intensive',
      contentContains: 'Attendance maintained',
      mustNotBeIn: ['shortTermOutcomes'],
    })
  );
});

test('domainContainsSubstring helper', () => {
  assert.equal(
    domainContainsSubstring(misplacedModel, 'shortTermOutcomes', 'Attendance maintained'),
    true
  );
  assert.equal(domainContainsSubstring(misplacedModel, 'outputs', 'Attendance maintained'), false);
});

test('expected-domains.json loads and has placements', () => {
  const raw = fs.readFileSync(EXPECTED_PATH, 'utf8');
  const fixture = JSON.parse(raw);
  assert.ok(Array.isArray(fixture.placements));
  assert.ok(fixture.placements.length >= 5);
});

test('extract-snapshot.json passes fixture when present', t => {
  // A real `test.skip()` rather than a `console.log` + early return — found via codebase audit
  // (docs/specs/codebase-audit-2026-09-19.md #5): the old form reports SKIPPED as PASSED in the
  // `npm test` summary, so a missing snapshot silently looks like a validated regression guard.
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    t.skip('no extract-snapshot.json — run live extract and commit snapshot (see fixture README)');
    return;
  }
  const model = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as LogicModel;
  const fixture = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
  assert.doesNotThrow(() => assertFixture(model, fixture));
});

test('oxford circle expected-domains.json loads with regression guards', () => {
  const fixture = JSON.parse(fs.readFileSync(OXFORD_EXPECTED, 'utf8'));
  assert.ok(Array.isArray(fixture.placements) && fixture.placements.length >= 4);
  assert.ok(Array.isArray(fixture.mustNotContainAnywhere) && fixture.mustNotContainAnywhere.length >= 3);
  assert.ok(Array.isArray(fixture.groupsMustBeGeneralOnly));
});

test('oxford circle snapshot passes fixture when present', t => {
  if (!fs.existsSync(OXFORD_SNAPSHOT)) {
    t.skip('no oxford-circle extract-snapshot.json — run live extract and commit snapshot (see fixture README)');
    return;
  }
  const model = JSON.parse(fs.readFileSync(OXFORD_SNAPSHOT, 'utf8')) as LogicModel;
  const fixture = JSON.parse(fs.readFileSync(OXFORD_EXPECTED, 'utf8'));
  assert.doesNotThrow(() => assertFixture(model, fixture));
});

test('assertNotContainedAnywhere catches fabricated content', () => {
  const withFabrication: LogicModel = {
    ...misplacedModel,
    inputs: { content: [{ name: 'Partners', items: [{ text: "St. Christopher's Hospital" }] }] },
  };
  assert.throws(() => assertNotContainedAnywhere(withFabrication, "St. Christopher's Hospital"), /Fabrication/);
  assert.doesNotThrow(() => assertNotContainedAnywhere(misplacedModel, "St. Christopher's Hospital"));
});

test('assertGroupsGeneralOnly rejects a copied resource sub-heading', () => {
  const withFalseTrack: LogicModel = {
    ...misplacedModel,
    outputs: { content: [{ name: 'Frontline Staff', items: [{ text: 'No. of students served' }] }] },
  };
  assert.throws(() => assertGroupsGeneralOnly(withFalseTrack, 'outputs'), /Grouping check/);
  const general: LogicModel = {
    ...misplacedModel,
    outputs: { content: [{ name: 'General', items: [{ text: 'No. of students served' }] }] },
  };
  assert.doesNotThrow(() => assertGroupsGeneralOnly(general, 'outputs'));
});
