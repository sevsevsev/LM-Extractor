import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LogicModel, LogicModelItem } from '../types.ts';
import { analyzeColorAxis, colorAxisNotes, itemMatchesColorFilter } from './colorAxis.ts';

function model(overrides: Partial<LogicModel> = {}): LogicModel {
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: { content: [] },
    activities: { content: [] },
    outputs: { content: [] },
    shortTermOutcomes: { content: [] },
    mediumTermOutcomes: { content: [] },
    longTermOutcomes: { content: [] },
    impact: { content: [] },
    ...overrides,
  };
}

const items = (pairs: [string, string][]): LogicModelItem[] =>
  pairs.map(([text, fillColor]) => ({ text, fillColor }));

describe('analyzeColorAxis', () => {
  it('treats no fills as none', () => {
    const axis = analyzeColorAxis(
      model({
        activities: { content: [{ name: 'General', items: [{ text: 'Workshops' }] }] },
      })
    );
    assert.equal(axis.kind, 'none');
    assert.deepEqual(colorAxisNotes(axis), []);
  });

  it('treats a single shared fill as decorative', () => {
    const axis = analyzeColorAxis(
      model({
        activities: {
          content: [{ name: 'General', items: items([['A', 'navy'], ['B', 'Navy']]) }],
        },
        outputs: { content: [{ name: 'General', items: items([['C', 'navy']]) }] },
      })
    );
    assert.equal(axis.kind, 'decorative');
    assert.deepEqual(axis.colors, ['navy']);
    assert.deepEqual(colorAxisNotes(axis), []);
  });

  it('treats one colour per column as column chrome, not a category', () => {
    const axis = analyzeColorAxis(
      model({
        inputs: {
          content: [{ name: 'General', items: items([['i1', 'yellow'], ['i2', 'yellow'], ['i3', 'yellow']]) }],
        },
        activities: {
          content: [{ name: 'General', items: items([['a1', 'blue'], ['a2', 'blue'], ['a3', 'blue']]) }],
        },
        outputs: {
          content: [{ name: 'General', items: items([['o1', 'green'], ['o2', 'green'], ['o3', 'green']]) }],
        },
      })
    );
    assert.equal(axis.kind, 'column_chrome');
    assert.equal(axis.stampedDomains.length, 0);
    assert.deepEqual(colorAxisNotes(axis), []);
  });

  it('treats mixed colours within a column as a cross-cutting axis without inferring meaning', () => {
    const axis = analyzeColorAxis(
      model({
        activities: {
          content: [
            {
              name: 'General',
              items: items([
                ['Student workshops', 'orange'],
                ['Family nights', 'purple'],
                ['Joint event', 'orange'],
              ]),
            },
          ],
        },
        shortTermOutcomes: {
          content: [
            {
              name: 'General',
              items: items([
                ['Career awareness', 'orange'],
                ['Caregiver skills', 'purple'],
              ]),
            },
          ],
        },
      })
    );
    assert.equal(axis.kind, 'cross_cutting');
    assert.equal(axis.hasLegend, false);
    assert.match(colorAxisNotes(axis).join(' '), /no key/i);
  });

  it('flags a uniformly coloured column when other columns mix', () => {
    const axis = analyzeColorAxis(
      model({
        activities: {
          content: [
            {
              name: 'General',
              items: items([
                ['A1', 'blue'],
                ['A2', 'blue'],
                ['A3', 'blue'],
                ['A4', 'blue'],
              ]),
            },
          ],
        },
        outputs: {
          content: [
            {
              name: 'General',
              items: items([
                ['O1', 'orange'],
                ['O2', 'purple'],
              ]),
            },
          ],
        },
      })
    );
    assert.equal(axis.kind, 'cross_cutting');
    assert.deepEqual(axis.stampedDomains, ['activities']);
    assert.match(colorAxisNotes(axis).join(' '), /Activities/i);
  });
});

describe('itemMatchesColorFilter', () => {
  it('matches normalized fill tokens', () => {
    assert.equal(itemMatchesColorFilter({ text: 'A', fillColor: 'Orange' }, 'orange'), true);
    assert.equal(itemMatchesColorFilter({ text: 'A', fillColor: 'purple' }, 'orange'), false);
    assert.equal(itemMatchesColorFilter({ text: 'A' }, null), true);
  });
});
