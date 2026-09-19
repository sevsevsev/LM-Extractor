import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeExtractedLogicModel,
  isOutputLikeText,
  looksLikeImpactStatementProse,
} from './extractNormalize.ts';
import type { LogicModel } from '../types.ts';

const youthMovesMisparse: LogicModel = {
  organization: 'The Performance Garage',
  program: 'YouthMoves',
  mission: {
    content:
      'Through sustained participation in YouthMoves, student-dancers will experience an affirming environment for creative expression that fosters artistic growth, collaboration, resilience, and self-worth—expanding their educational pathways and long-term career opportunities in the arts and beyond.',
  },
  targetPopulation: { content: 'student-dancers' },
  inputs: { content: [] },
  activities: { content: [{ name: 'Summer Intensive', items: [{ text: 'Pilates' }] }] },
  outputs: {
    content: [
      {
        name: 'General',
        items: [
          { text: 'Attendance at 90%' },
          { text: 'Implementation 5 of Curriculum units' },
        ],
      },
    ],
  },
  shortTermOutcomes: { content: [] },
  mediumTermOutcomes: {
    content: [
      {
        name: 'General',
        items: [
          { text: 'Attendance is maintained at 90%' },
          { text: 'Implementation 2 of Curriculum units' },
          { text: 'Interaction with master teachers' },
        ],
      },
    ],
  },
  longTermOutcomes: {
    content: [
      {
        name: 'General',
        items: [
          { text: 'Student choreography driven by selected research topics' },
          { text: 'Implementation of FLC Dance & Youth Moves Curriculum Units' },
        ],
      },
    ],
  },
  impact: {
    content: [
      {
        name: 'General',
        items: [{ text: 'Sustain careers in creative industries, apply creative thinking skills in diverse prof fields' }],
      },
    ],
  },
};

test('no longer relabels mission prose as Impact Statement (heuristic removed in favor of prompt guidance)', () => {
  // promoteImpactStatementFromMission was removed: `looksLikeImpactStatementProse` (population word +
  // change verb, 80-600 chars) matches most ordinary mission-statement prose too — confirmed against a
  // real document's verbatim mission text ("Imagine That Philly provides resources that encourage
  // children to learn... so we can organically foster... growth") during a real-batch audit. The
  // prompt's CONTEXT & OVERVIEW section now carries this distinction instead (decide by heading, not
  // by wording) since Gemini can see the actual document, a regex over generic vocabulary can't.
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesMisparse));
  assert.ok(m.mission.content.includes('Through sustained participation'));
  assert.equal(m.impactStatement?.content ?? '', '');
});

test('normalizeExtractedLogicModel initializes generalOutcomes even when Gemini omitted it', () => {
  // youthMovesMisparse (and virtually every fixture in this file) never sets generalOutcomes —
  // it's optional on the raw Gemini JSON. Every helper in the normalize pipeline runs before
  // this the field exists, so this guards against the exact "Cannot read properties of
  // undefined" crash that shipped once before this test was added.
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesMisparse));
  assert.deepEqual(m.generalOutcomes?.content, []);
});

test('a single combined outcomes column lands in generalOutcomes, not shortTermOutcomes', () => {
  const singleOutcomesColumn: LogicModel = {
    ...structuredClone(youthMovesMisparse),
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    generalOutcomes: {
      content: [
        { name: 'Outcomes', items: [{ text: 'Dancers report greater confidence on stage' }] },
      ],
    },
  };
  const m = normalizeExtractedLogicModel(singleOutcomesColumn);
  assert.ok(
    m.generalOutcomes?.content.some(g => g.items.some(i => /greater confidence/.test(i.text)))
  );
  assert.ok(
    !m.shortTermOutcomes.content.some(g => g.items.some(i => /greater confidence/.test(i.text)))
  );
});

test('does not force rebucket Summer-shaped text from medium-term (spatial trust)', () => {
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesMisparse));
  assert.ok(
    m.mediumTermOutcomes.content.some(g => g.items.some(i => /Attendance is maintained/.test(i.text)))
  );
});

test('does not force rebucket Concert-shaped text from long-term (spatial trust)', () => {
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesMisparse));
  assert.ok(
    m.longTermOutcomes.content.some(g => g.items.some(i => /Student choreography/.test(i.text)))
  );
});

test('preserves Impact column items (does not consolidate into long-term)', () => {
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesMisparse));
  assert.ok(m.impact.content.some(g => g.items.some(i => /Sustain careers/.test(i.text))));
});

test('isOutputLikeText helper', () => {
  assert.equal(isOutputLikeText('Attendance is maintained at 90%'), true);
  assert.equal(isOutputLikeText('Master dance technique'), false);
});

const youthMovesFourthTryMisparse: LogicModel = {
  organization: 'The Performance Garage',
  program: 'YouthMoves',
  mission: { content: '' },
  targetPopulation: { content: 'Student-dancers' },
  inputs: { content: [] },
  activities: { content: [] },
  outputs: {
    content: [
      {
        name: 'Summer Intensive',
        items: [{ text: 'Attendance is maintained at 90%' }],
      },
    ],
  },
  shortTermOutcomes: { content: [] },
  mediumTermOutcomes: { content: [] },
  longTermOutcomes: {
    content: [
      {
        name: 'General',
        items: [
          {
            text: 'Through sustained participation in YouthMoves, student-dancers will experience an affirming environment for creative expression that fosters artistic growth, collaboration, resilience, and self-worth—expanding their educational pathways and long-term career opportunities in the arts and beyond.',
          },
          { text: 'Educational attainment, career advancement, overall life stability' },
        ],
      },
    ],
  },
  impact: { content: [] },
};

test('promotes Impact Statement prose from long-term outcomes item', () => {
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesFourthTryMisparse));
  assert.ok(m.impactStatement?.content?.includes('Through sustained participation'));
  const ltTexts = m.longTermOutcomes.content.flatMap(g => g.items.map(i => i.text));
  assert.ok(!ltTexts.some(t => t.includes('Through sustained participation')));
  assert.ok(ltTexts.some(t => t.includes('Educational attainment')));
});

test('does not steal a legitimate outcome item when outcomes are richly itemized (Eureka regression)', () => {
  // Real document: "Eureka! College Readiness" has no separate Impact section at all — just
  // Inputs/Activities/Outputs/Outcomes(Short/Medium/Long), each richly itemized. The first
  // Medium-Term Outcomes item happens to read like ordinary overview prose (population word +
  // change verb), but with 9 total outcome items across all three tiers, this should never be
  // mistaken for a dropped impact statement.
  const eurekaShaped: LogicModel = {
    organization: 'Girls Inc.',
    program: 'Eureka! College Readiness',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: {
      content: [
        {
          name: 'General',
          items: [
            { text: 'Increase in awareness of different career pathways and industries' },
            { text: 'Gain basic understanding of post-secondary options' },
            {
              text: 'Enhanced understanding of the education and skillsets needed for STEM and nontraditional STEM careers',
            },
          ],
        },
      ],
    },
    mediumTermOutcomes: {
      content: [
        {
          name: 'General',
          items: [
            {
              text: 'Increase in the number of participants in post-secondary education and planning future college visits',
            },
            { text: 'Increase academic motivation tied to post-secondary and career goals' },
            {
              text: 'Participate in Girls Inc. college and career workshops or experiences related to post-secondary goals',
            },
          ],
        },
      ],
    },
    longTermOutcomes: {
      content: [
        {
          name: 'General',
          items: [
            { text: 'Graduation from college and secure job or internship training opportunities' },
            { text: 'Growth of representation of women in STEM and nontraditional STEM fields' },
            { text: 'Demonstrate economic mobility and career advancement potential' },
          ],
        },
      ],
    },
    impact: { content: [] },
  };

  const m = normalizeExtractedLogicModel(structuredClone(eurekaShaped));
  assert.equal(m.impactStatement?.content ?? '', '');
  const mtTexts = m.mediumTermOutcomes.content.flatMap(g => g.items.map(i => i.text));
  assert.equal(mtTexts.length, 3);
  assert.ok(mtTexts.some(t => t.includes('Increase in the number of participants')));
});

test('looksLikeImpactStatementProse helper', () => {
  assert.equal(
    looksLikeImpactStatementProse(
      'Through sustained participation in YouthMoves, student-dancers will experience an affirming environment for creative expression that fosters artistic growth, collaboration, resilience, and self-worth—expanding their educational pathways and long-term career opportunities in the arts and beyond.'
    ),
    true
  );
  assert.equal(looksLikeImpactStatementProse('Short mission.'), false);
});

test('fills Impact Statement from source text when vision omitted it', () => {
  const emptyOverview: LogicModel = {
    organization: 'The Performance Garage',
    program: 'YouthMoves',
    mission: { content: '' },
    targetPopulation: { content: 'Student-dancers' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: {
      content: [{ name: 'General', items: [{ text: 'Educational attainment' }] }],
    },
    impact: { content: [] },
  };
  const sourceText = `## Page 1\nIMPACT STATEMENT\n\n\nThrough sustained participation in YouthMoves, student-dancers will experience an affirming environment for creative expression that fosters artistic growth, collaboration, resilience, and self-worth—expanding their educational pathways and long-term career opportunities in the arts and beyond.\n## Page 2\nResources`;
  const m = normalizeExtractedLogicModel(structuredClone(emptyOverview), { sourceText });
  assert.ok(m.impactStatement?.content?.includes('Through sustained participation'));
});
