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

test('promotes Impact Statement prose from mission', () => {
  const m = normalizeExtractedLogicModel(structuredClone(youthMovesMisparse));
  assert.ok(m.impactStatement?.content?.includes('Through sustained participation'));
  assert.equal(m.mission.content, '');
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
