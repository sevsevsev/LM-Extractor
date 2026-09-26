import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { LogicModel, LogicModelGroup } from '../types';
import { pdfColumnPlan } from './pdfColumnPlan.js';

function groups(...texts: string[]): LogicModelGroup[] {
  return [{ name: 'General', items: texts.map(text => ({ text })) }];
}

function baseModel(overrides: Partial<LogicModel> = {}): LogicModel {
  const empty = { content: [] as LogicModelGroup[] };
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: { content: groups('Staff') },
    activities: { content: groups('Workshops') },
    outputs: { content: groups('Sessions held') },
    shortTermOutcomes: empty,
    mediumTermOutcomes: empty,
    longTermOutcomes: empty,
    impact: empty,
    ...overrides,
  };
}

const titles = (model: LogicModel) => pdfColumnPlan(model).columns.map(c => c.title);

test('a document with time-horizon outcomes prints the same six columns as before', () => {
  const model = baseModel({ shortTermOutcomes: { content: groups('Confidence rises') } });
  assert.deepEqual(titles(model), [
    'Resources (Inputs)',
    'Activities',
    'Outputs',
    'Short-Term Outcomes',
    'Medium-Term Outcomes',
    'Long-Term Outcomes',
  ]);
  assert.equal(pdfColumnPlan(model).generalOutcomesSwappedIn, false);
});

test('general outcomes are swapped in only when all three time-horizon columns are empty', () => {
  const model = baseModel({ generalOutcomes: { content: groups('Pupils read more') } });
  const plan = pdfColumnPlan(model);
  assert.equal(plan.generalOutcomesSwappedIn, true);
  assert.deepEqual(titles(model), ['Resources (Inputs)', 'Activities', 'Outputs', 'Outcomes']);
  assert.deepEqual(plan.columns[3].groups, groups('Pupils read more'));
});

test('one time-horizon column with items keeps the six-column layout, general outcomes or not', () => {
  // Deliberate: general outcomes are NOT spread across short/medium/long, because that would assert
  // a time horizon the document never stated. A document that has both keeps today's layout, and the
  // full CSV is where every item is.
  const model = baseModel({
    longTermOutcomes: { content: groups('Graduates stay in the field') },
    generalOutcomes: { content: groups('Pupils read more') },
  });
  const plan = pdfColumnPlan(model);
  assert.equal(plan.generalOutcomesSwappedIn, false);
  assert.equal(plan.columns.length, 6);
  assert.ok(!plan.columns.some(c => c.field === 'generalOutcomes'));
});

test('a model with no outcomes at all is unchanged: six columns, three of them empty', () => {
  const plan = pdfColumnPlan(baseModel());
  assert.equal(plan.generalOutcomesSwappedIn, false);
  assert.equal(plan.columns.length, 6);
});

test('outcome groups that exist but hold no usable item do not trigger the swap', () => {
  const blank = baseModel({ generalOutcomes: { content: [{ name: 'General', items: [{ text: '  ' }] }] } });
  assert.equal(pdfColumnPlan(blank).generalOutcomesSwappedIn, false);
});

test('the plan never renders Impact or Unmapped', () => {
  const model = baseModel({
    generalOutcomes: { content: groups('Pupils read more') },
    impact: { content: groups('The neighbourhood reads') },
    unmapped: { content: groups('A stakeholder roster') },
  });
  const fields = pdfColumnPlan(model).columns.map(c => c.field);
  assert.ok(!fields.includes('impact'));
  assert.ok(!fields.includes('unmapped'));
});

test('the plan reads the model and never rewrites it', () => {
  const model = baseModel({ generalOutcomes: { content: groups('Pupils read more') } });
  const before = JSON.stringify(model);
  pdfColumnPlan(model);
  assert.equal(JSON.stringify(model), before);
});

/**
 * The plan over the 17 blessed regression extractions, rather than over hand-built models.
 *
 * These are the shapes the app actually produces from real documents, and they are what showed the
 * omission in the first place: three of them state their outcomes with no time horizon. Committed,
 * so this needs no Gemini call. The snapshots hold real client wording, so no assertion message
 * reproduces any of it — a failure names the document id.
 */
const SNAPSHOT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'regression-set',
  'snapshots'
);

const BLESSED: { id: string; model: LogicModel }[] = fs.existsSync(SNAPSHOT_DIR)
  ? fs
      .readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        const snap = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf8')) as {
          model?: LogicModel;
        };
        return { id: f.replace(/\.json$/, ''), model: snap.model ?? (snap as unknown as LogicModel) };
      })
  : [];

const itemTexts = (g: LogicModelGroup[] = []): string[] =>
  g.flatMap(group => group.items.map(i => i.text?.trim() ?? '').filter(Boolean));

test('the blessed regression snapshots are present to test the PDF plan against', () => {
  assert.ok(BLESSED.length >= 17, `expected at least 17 blessed snapshots, found ${BLESSED.length}`);
});

for (const { id, model } of BLESSED) {
  test(`the PDF plan for ${id} prints each column's own items and nothing else`, () => {
    const plan = pdfColumnPlan(model);
    for (const column of plan.columns) {
      const onModel = itemTexts((model[column.field] as { content?: LogicModelGroup[] })?.content);
      assert.deepEqual(
        itemTexts(column.groups).slice().sort(),
        onModel.slice().sort(),
        `${id}: the ${column.field} column prints exactly what that field holds`
      );
    }
    assert.equal(
      new Set(plan.columns.map(c => c.field)).size,
      plan.columns.length,
      `${id}: no field is printed twice`
    );
  });

  test(`a document whose outcomes carry no time horizon still shows them: ${id}`, () => {
    const has = (field: keyof LogicModel) =>
      itemTexts((model[field] as { content?: LogicModelGroup[] })?.content).length > 0;
    const timeHorizonEmpty =
      !has('shortTermOutcomes') && !has('mediumTermOutcomes') && !has('longTermOutcomes');
    const plan = pdfColumnPlan(model);

    assert.equal(
      plan.generalOutcomesSwappedIn,
      timeHorizonEmpty && has('generalOutcomes'),
      `${id}: the swap fires on exactly the documents it is for`
    );
    if (has('generalOutcomes') && timeHorizonEmpty) {
      // This is the case that used to lose its outcomes from the client's copy entirely.
      assert.ok(
        plan.columns.some(c => c.field === 'generalOutcomes' && itemTexts(c.groups).length > 0),
        `${id}: general outcomes reach the PDF`
      );
    }
  });
}
