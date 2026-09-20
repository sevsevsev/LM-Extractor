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

test('harvests under "Intended Impact" heading (synonym)', () => {
  const got = harvestImpactStatementFromPlainText(`Intended Impact ${YOUTHMOVES_PROSE} Resources`);
  assert.ok(got?.includes('Through sustained participation'));
});

test('harvests under "Long-Term Impact" heading (synonym, hyphenated)', () => {
  const got = harvestImpactStatementFromPlainText(`Long-Term Impact ${YOUTHMOVES_PROSE} Resources`);
  assert.ok(got?.includes('Through sustained participation'));
});

test('harvests under "Anticipated Impact" heading (synonym)', () => {
  const got = harvestImpactStatementFromPlainText(`Anticipated Impact ${YOUTHMOVES_PROSE} Resources`);
  assert.ok(got?.includes('Through sustained participation'));
});

test('does not treat a bare "Ultimate Goal" mention as a heading (client-side regex stays conservative)', () => {
  // "Ultimate Goal" / "Overall Goal" / "Goal Statement" are recognized in the extraction prompt
  // (Gemini can see whether it's a styled heading vs. an incidental phrase) but deliberately left
  // out of this raw-text regex, which has no such visual context and could false-positive on
  // ordinary body prose like "our ultimate goal is...".
  const got = harvestImpactStatementFromPlainText(
    `Resources Activities. Our ultimate goal is to help every student succeed. Outputs Short-Term`
  );
  assert.equal(got, null);
});

test('returns null when no impact statement present', () => {
  assert.equal(
    harvestImpactStatementFromPlainText('Resources Activities Outputs Short-Term Outcomes'),
    null
  );
});

test('returns null without an explicit heading, even when prose reads like an impact statement', () => {
  // The front-matter fallback (scan for any sentence matching population+change vocabulary when no
  // "impact statement" heading exists) was removed: confirmed live that it duplicated an ordinary
  // Mission sentence into impactStatement on a real document (Imagine That Philly), markdown page
  // marker and all, even though the extraction prompt already correctly left impactStatement empty.
  // Requiring an explicit heading avoids guessing at unlabeled prose Gemini already declined to
  // treat as an impact statement.
  const got = harvestImpactStatementFromPlainText(`Page 1 overview. ${YOUTHMOVES_PROSE}`);
  assert.equal(got, null);
});
