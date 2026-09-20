import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LogicModel } from '../types.ts';
import { findNestingViolations, formatNestingViolations } from './nestingConsistency.ts';

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
  } as LogicModel;
}

const group = (name: string, ...texts: string[]) => ({ name, items: texts.map(text => ({ text })) });

describe('findNestingViolations', () => {
  /**
   * The shape GROUPING GATE 7-9 asks for, taken verbatim from the Healthy NewsWorks Core Reporter
   * Outputs column (heading "Program Delivery", bulleted label "Student Publications" with five
   * sub-bullets beneath it). This must stay silent or the check is useless.
   */
  it('accepts the canonical flattening', () => {
    const m = model({
      outputs: {
        content: [
          group(
            'Program Delivery',
            'Lessons delivered to more than 600 students in 24 classrooms',
            'Student Publications — 40+ school newspapers published',
            'Student Publications — 2 magazines published'
          ),
          group('Teacher Training', 'In-person and online teacher trainings held'),
        ],
      },
    });
    assert.deepEqual(findNestingViolations(m), []);
  });

  /** Encoding (d) from friction-log session 6: the parent emitted beside its own children. */
  it('flags a parent label emitted as its own item', () => {
    const m = model({
      outputs: {
        content: [
          group(
            'Program Delivery',
            'Student Publications',
            'Student Publications — 40+ school newspapers published'
          ),
        ],
      },
    });
    const v = findNestingViolations(m);
    assert.equal(v.length, 1);
    assert.equal(v[0].kind, 'parent_label_as_item');
    assert.equal(v[0].text, 'Student Publications');
    assert.equal(v[0].example, 'Student Publications — 40+ school newspapers published');
    assert.match(formatNestingViolations(v)[0], /parent label emitted as its own item/);
  });

  /** Rule 9c: the group name restated inside items that already sit in that group. */
  it('flags an item that repeats its own group name', () => {
    const m = model({
      activities: { content: [group('Summer Intensive', 'Summer Intensive — Pilates, Yoga, Ballet')] },
    });
    const v = findNestingViolations(m);
    assert.equal(v.length, 1);
    assert.equal(v[0].kind, 'group_name_repeated_in_item');
    assert.equal(v[0].domain, 'Activities');
  });

  /** Cub Reporter folds on a colon, because its labels already end in one. Same violation. */
  it('recognises the colon joiner as well as the dash', () => {
    const m = model({
      shortTermOutcomes: {
        content: [
          group(
            'Core Reporters',
            'Academic Skills',
            'Academic Skills: Writing',
            'Academic Skills: Research skills'
          ),
        ],
      },
    });
    const kinds = findNestingViolations(m).map(v => v.kind);
    assert.deepEqual(kinds, ['parent_label_as_item']);
  });

  it('does not treat "General" as a repeated label', () => {
    const m = model({ outputs: { content: [group('General', 'General — something odd')] } });
    assert.deepEqual(findNestingViolations(m), []);
  });

  /**
   * Conservative by design: a shared opening word is not a parent/child relationship, and a false
   * "your grouping is wrong" is worse than a missed one.
   */
  it('does not fire on items that merely share an opening word', () => {
    const m = model({
      outputs: { content: [group('General', 'Student reporters trained', 'Student reporters published')] },
    });
    assert.deepEqual(findNestingViolations(m), []);
  });

  it('ignores empty items and untouched domains', () => {
    const m = model({ outputs: { content: [group('Program Delivery', '   ', '')] } });
    assert.deepEqual(findNestingViolations(m), []);
  });
});
