import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGranularExportRows,
  groupedDomainHasContent,
  sanitizeAbsentDomainCritiques,
  shouldDropOverallRationaleBullet,
  stringDomainHasContent,
} from './domainPresence.ts';
import type { LogicModel } from '../types.ts';

const baseModel = (): LogicModel => ({
  organization: 'Org',
  program: 'Prog',
  mission: { content: '', critique: 'Mission entirely missing.', rating: 'Weak' },
  targetPopulation: { content: 'Students' },
  inputs: { content: [{ name: 'Human', items: [{ text: 'Teacher' }] }] },
  activities: { content: [{ name: 'General', items: [{ text: 'Class' }] }] },
  outputs: { content: [{ name: 'General', items: [{ text: 'Attendance 90%' }] }] },
  shortTermOutcomes: { content: [{ name: 'General', items: [{ text: 'Learn technique' }] }] },
  mediumTermOutcomes: { content: [], critique: 'No medium term', rating: 'Weak' },
  longTermOutcomes: { content: [{ name: 'General', items: [{ text: 'Graduate' }] }] },
  impact: { content: [], critique: 'Impact empty', rating: 'Weak' },
  overallQuality: {
    rating: 'Weak',
    rationale: [
      'The mission statement is entirely absent, which is a fundamental flaw for a logic model.',
      'Outputs are strong.',
    ],
  },
});

test('stringDomainHasContent and groupedDomainHasContent', () => {
  assert.equal(stringDomainHasContent('  '), false);
  assert.equal(stringDomainHasContent('x'), true);
  assert.equal(groupedDomainHasContent([{ name: 'G', items: [{ text: '' }] }]), false);
  assert.equal(groupedDomainHasContent([{ name: 'G', items: [{ text: 'a' }] }]), true);
});

test('shouldDropOverallRationaleBullet filters exact mission and impact grid phrases', () => {
  const m = baseModel();
  const missionBullet =
    'The mission statement is entirely absent, which is a fundamental flaw for a logic model.';
  const impactBullet =
    "The 'Impact' section is empty, failing to articulate the ultimate desired changes in status or condition.";
  assert.equal(shouldDropOverallRationaleBullet(missionBullet, m), true);
  assert.equal(shouldDropOverallRationaleBullet(impactBullet, m), true);
  assert.equal(shouldDropOverallRationaleBullet('Outputs are strong.', m), false);
});

test('sanitizeAbsentDomainCritiques removes impact grid empty rationale', () => {
  const m = sanitizeAbsentDomainCritiques({
    ...baseModel(),
    overallQuality: {
      rating: 'Weak',
      rationale: [
        "The 'Impact' section is empty, failing to articulate the ultimate desired changes in status or condition.",
        'Short-term outcomes include misplaced skill items.',
      ],
    },
  });
  assert.ok(
    !m.overallQuality?.rationale.some(r => /impact.*section.*empty/i.test(r))
  );
  assert.ok(m.overallQuality?.rationale.some(r => /short-term outcomes/i.test(r)));
});

test('sanitizeAbsentDomainCritiques clears mission and optional grouped critiques', () => {
  const m = sanitizeAbsentDomainCritiques(baseModel());
  assert.equal(m.mission.rating, undefined);
  assert.equal(m.mission.critique, '');
  assert.equal(m.mediumTermOutcomes.rating, undefined);
  assert.equal(m.impact.rating, undefined);
  assert.ok(!m.overallQuality?.rationale.some(r => /mission.*absent/i.test(r)));
  assert.ok((m.overallQuality?.rationale.length ?? 0) >= 2);
});

test('sanitizeAbsentDomainCritiques clears empty unmapped Weak ratings', () => {
  const m = sanitizeAbsentDomainCritiques({
    ...baseModel(),
    unmapped: {
      content: [],
      critique: 'No specific suggestions for this section.',
      rating: 'Weak',
    },
  });
  assert.equal(m.unmapped?.rating, undefined);
  assert.equal(m.unmapped?.critique, '');
});

test('sanitizeAbsentDomainCritiques keeps unmapped critique when items exist', () => {
  const m = sanitizeAbsentDomainCritiques({
    ...baseModel(),
    unmapped: {
      content: [{ name: 'Assumptions', items: [{ text: 'Funding uncertain' }] }],
      critique: 'Assign these headers to domains.',
      rating: 'Adequate',
    },
  });
  assert.equal(m.unmapped?.rating, 'Adequate');
  assert.match(m.unmapped?.critique || '', /Assign/);
});

test('buildGranularExportRows omits empty mission and empty grouped domains', () => {
  const rows = buildGranularExportRows([baseModel()]);
  const domains = rows.map(r => r.domain);
  assert.ok(!domains.includes('Mission / Overview'));
  assert.ok(!domains.includes('Medium-Term Outcomes'));
  assert.ok(!domains.includes('Impact'));
  assert.ok(domains.includes('Target Population'));
  assert.ok(domains.includes('Outputs'));
});
