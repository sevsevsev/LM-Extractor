import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  assertFixture,
  assertPlacement,
  domainContainsSubstring,
} from './extractPlacement.ts';
import type { LogicModel } from '../types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'performance-garage-youthmoves');
const EXPECTED_PATH = path.join(FIXTURE_DIR, 'expected-domains.json');
const SNAPSHOT_PATH = path.join(FIXTURE_DIR, 'extract-snapshot.json');

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

test('extract-snapshot.json passes fixture when present', () => {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.log('skip: no extract-snapshot.json — run live extract and commit snapshot');
    return;
  }
  const model = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as LogicModel;
  const fixture = JSON.parse(fs.readFileSync(EXPECTED_PATH, 'utf8'));
  assert.doesNotThrow(() => assertFixture(model, fixture));
});
