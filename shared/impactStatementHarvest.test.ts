import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harvestImpactStatementFromPlainText } from './impactStatementHarvest.ts';

const YOUTHMOVES_PROSE =
  'Through sustained participation in YouthMoves, student-dancers will experience an affirming environment for creative expression that fosters artistic growth, collaboration, resilience, and self-worth—expanding their educational pathways and long-term career opportunities in the arts and beyond.';

test('harvests Impact Statement after heading with large whitespace gap (PDF text layer style)', () => {
  const pageText = `
## Page 1
The Performance Garage YouthMoves Logic Model
IMPACT STATEMENT


${YOUTHMOVES_PROSE}
## Page 2
Resources Activities Outputs
`;
  const got = harvestImpactStatementFromPlainText(pageText);
  assert.ok(got);
  assert.ok(got!.includes('Through sustained participation'));
  assert.ok(got!.includes('educational pathways'));
});

test('harvests when heading and prose are on one collapsed line', () => {
  const got = harvestImpactStatementFromPlainText(
    `IMPACT STATEMENT ${YOUTHMOVES_PROSE} Resources Human Resources Dance Teacher`
  );
  assert.ok(got?.includes('Through sustained participation'));
  assert.ok(!got?.includes('Dance Teacher'));
});

test('returns null when no impact statement present', () => {
  assert.equal(
    harvestImpactStatementFromPlainText('Resources Activities Outputs Short-Term Outcomes'),
    null
  );
});

test('recovers prose fingerprint without clean heading when signals match', () => {
  const got = harvestImpactStatementFromPlainText(`Page 1 overview. ${YOUTHMOVES_PROSE}`);
  assert.ok(got?.includes('affirming environment'));
});
