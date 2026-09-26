import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_THRESHOLD,
  appearsInSource,
  flattenScoredItems,
  formatScoreRow,
  normalizeForMatch,
  scoreExtraction,
  similarity,
  totalScores,
  type GoldenAnswer,
} from './extractionScore.ts';
import type { LogicModel, LogicModelGroup } from '../types.ts';

function groups(...items: string[]): { content: LogicModelGroup[] } {
  return { content: [{ name: 'General', items: items.map(text => ({ text })) }] };
}

function model(partial: Partial<LogicModel>): LogicModel {
  return {
    organization: '',
    program: '',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    impact: { content: [] },
    ...partial,
  } as LogicModel;
}

const golden: GoldenAnswer = {
  id: 'test',
  label: 'Test',
  covers: 'unit test',
  items: {
    activities: ['Weekly mentoring sessions for enrolled students', 'Monthly family engagement nights'],
    outputs: ['150 students served each year'],
  },
};

test('a perfect extraction scores 1 on every axis', () => {
  const s = scoreExtraction(
    golden,
    model({
      activities: groups('Weekly mentoring sessions for enrolled students', 'Monthly family engagement nights'),
      outputs: groups('150 students served each year'),
    })
  );
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
  assert.equal(s.placement, 1);
  assert.deepEqual(s.misses, []);
  assert.deepEqual(s.misplacements, []);
});

test('a dropped item is a miss and costs recall, not placement', () => {
  const s = scoreExtraction(
    golden,
    model({
      activities: groups('Weekly mentoring sessions for enrolled students'),
      outputs: groups('150 students served each year'),
    })
  );
  assert.equal(s.recall, 2 / 3);
  assert.equal(s.placement, 1);
  assert.deepEqual(s.misses, [{ expected: 'Monthly family engagement nights', domain: 'activities' }]);
});

test('an item in the wrong column costs placement, not recall', () => {
  const s = scoreExtraction(
    golden,
    model({
      activities: groups('Weekly mentoring sessions for enrolled students', 'Monthly family engagement nights'),
      inputs: groups('150 students served each year'),
    })
  );
  assert.equal(s.recall, 1);
  assert.equal(s.placement, 2 / 3);
  assert.equal(s.misplacements[0].expectedDomain, 'outputs');
  assert.equal(s.misplacements[0].actualDomain, 'inputs');
});

test('a promoted category label still matches the item it prefixes', () => {
  const s = scoreExtraction(
    { ...golden, items: { outputs: ['Improved reading comprehension among participating students'] } },
    model({ outputs: groups('Academic Skills: Improved reading comprehension among participating students') })
  );
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
});

test('an extra item counts as surplus and costs precision', () => {
  const s = scoreExtraction(
    { ...golden, items: { outputs: ['150 students served each year'] } },
    model({ outputs: groups('150 students served each year', 'A quarterly newsletter nobody asked for') })
  );
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 0.5);
  assert.equal(s.surplus.length, 1);
});

test('a tolerated item is neither a miss nor surplus', () => {
  const s = scoreExtraction(
    { ...golden, items: { outputs: ['150 students served each year'] }, tolerated: ['PROGRAM OUTPUTS'] },
    model({ outputs: groups('150 students served each year', 'PROGRAM OUTPUTS') })
  );
  assert.equal(s.precision, 1);
  assert.deepEqual(s.surplus, []);
});

test('pairing is global, so near-identical bullets do not steal each others matches', () => {
  // First-fit would let the first expected item claim the second extracted item, inventing both a
  // miss and a surplus out of an extraction that is exactly right.
  const s = scoreExtraction(
    {
      ...golden,
      items: { outputs: ['Ninety students completed the fall cohort', 'Ninety students completed the spring cohort'] },
    },
    model({ outputs: groups('Ninety students completed the spring cohort', 'Ninety students completed the fall cohort') })
  );
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
});

test('the match threshold separates a prefixed item from a different bullet', () => {
  assert.ok(
    similarity(
      'Academic Skills: Improved reading comprehension among participating students',
      'Improved reading comprehension among participating students'
    ) >= MATCH_THRESHOLD
  );
  assert.ok(similarity('Academic Skills: reading gains', 'reading gains') >= MATCH_THRESHOLD);
  assert.ok(
    similarity(
      'Increase in the number of participants enrolling in post-secondary education',
      'Increase in the number of participants completing a summer internship'
    ) < MATCH_THRESHOLD
  );
  assert.ok(
    similarity(
      'Students report greater confidence in public speaking',
      'Students report improved attendance at school'
    ) < MATCH_THRESHOLD
  );
});

test('normalisation survives markdown emphasis, hyphen breaks and curly quotes', () => {
  assert.equal(similarity('**150+ students** engaged annually', '150+ students engaged annually'), 1);
  assert.equal(similarity('socio-\nemotional learning workshops', 'socio-emotional learning workshops'), 1);
  assert.equal(normalizeForMatch('the school’s “core” cohort'), `the school's "core" cohort`);
});

test('source presence tolerates markup and a promoted label prefix', () => {
  const source = normalizeForMatch('## Outputs\n\n- **150+ students** engaged annually\n- reading gains recorded termly');
  assert.ok(appearsInSource('150+ students engaged annually', source));
  assert.ok(appearsInSource('Academic Skills: reading gains recorded termly', source));
  assert.ok(!appearsInSource('A quarterly newsletter nobody asked for', source));
});

test('unsourced is null without a source text and a rate with one', () => {
  const extraction = model({ outputs: groups('150 students served each year', 'invented from nowhere at all') });
  assert.equal(scoreExtraction(golden, extraction).unsourced, null);
  const s = scoreExtraction(golden, extraction, { sourceText: '- 150 students served each year' });
  assert.equal(s.unsourced, 0.5);
});

test('a document-type disagreement is reported', () => {
  const s = scoreExtraction(
    { ...golden, items: {}, documentTypeAssessment: 'not_logic_model' },
    model({ documentTypeAssessment: 'logic_model' })
  );
  assert.deepEqual(s.documentTypeMismatch, { expected: 'not_logic_model', actual: 'logic_model' });
});

test('an empty extraction of an empty expectation is not a failure', () => {
  const s = scoreExtraction({ ...golden, items: {} }, model({}));
  assert.equal(s.recall, 1);
  assert.equal(s.precision, 1);
  assert.equal(s.placement, 1);
});

test('flattening walks every scored domain including unmapped', () => {
  const flat = flattenScoredItems(
    model({ inputs: groups('a'), unmapped: groups('b'), generalOutcomes: groups('c') })
  );
  assert.deepEqual(flat.map(f => f.domain).sort(), ['generalOutcomes', 'inputs', 'unmapped']);
});

test('totals pool over items so a small document cannot swamp a large one', () => {
  const small = scoreExtraction(
    { ...golden, items: { outputs: ['only item'] } },
    model({ outputs: { content: [] } })
  );
  const large = scoreExtraction(
    { ...golden, items: { outputs: Array.from({ length: 99 }, (_, i) => `distinct output number ${i}`) } },
    model({ outputs: groups(...Array.from({ length: 99 }, (_, i) => `distinct output number ${i}`)) })
  );
  const totals = totalScores([small, large]);
  assert.equal(totals.expectedCount, 100);
  assert.equal(totals.recall, 0.99);
  // Averaging over documents would have said 50%.
});

test('items parked in unmapped are neither surplus nor expected', () => {
  // Putting content the extractor cannot place into `unmapped` is the correct conservative move.
  // Charging it against precision would reward forcing content into a column instead.
  const s = scoreExtraction(
    { ...golden, items: { outputs: ['150 students served each year'] } },
    model({ outputs: groups('150 students served each year'), unmapped: groups('Premises 14,200', 'Salaries 96,500') })
  );
  assert.equal(s.precision, 1);
  assert.equal(s.unmappedCount, 2);
  assert.deepEqual(s.surplus, []);
});

test('unmapped content still has to come from the document', () => {
  const s = scoreExtraction(
    { ...golden, items: {} },
    model({ unmapped: groups('Premises 14,200', 'a line from nowhere at all') }),
    { sourceText: '| Premises | 14,200 |' }
  );
  assert.equal(s.unsourced, 0.5);
});

test('the invention probe accepts source strings the extractor joined', () => {
  // A table row rendered as one item, and a label promoted onto its bullet, are both assembled
  // from the page. A substring test calls both inventions; this repo has made that mistake.
  const source = normalizeForMatch(
    '#### COST CENTRE\n- Premises\n#### Q1 BUDGET\n- 14,200\n#### Q1 ACTUAL\n- 13,880\n' +
      '#### VARIANCE\n- (320)\n- reading gains recorded termly'
  );
  assert.ok(appearsInSource('Premises — Q1 BUDGET: 14,200 | Q1 ACTUAL: 13,880 | VARIANCE: (320)', source));
  assert.ok(appearsInSource('Academic Skills: reading gains recorded termly', source));
  assert.ok(!appearsInSource('A quarterly newsletter nobody asked for', source));
});

test('a score row renders every axis on one line', () => {
  const row = formatScoreRow(scoreExtraction(golden, model({})), 'Some document');
  assert.match(row, /recall/);
  assert.match(row, /placement/);
  assert.match(row, /unsourced\s+—/);
});
