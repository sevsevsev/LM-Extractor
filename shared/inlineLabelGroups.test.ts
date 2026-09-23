import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LogicModel, LogicModelGroup } from '../types.ts';
import { promoteInlineColonLabels, inlineLabelsIn } from './inlineLabelGroups.ts';

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

const group = (name: string, ...texts: string[]): LogicModelGroup => ({
  name,
  items: texts.map(text => ({ text })),
});

const shape = (groups: LogicModelGroup[] | undefined) =>
  (groups ?? []).map(g => [g.name, g.items.map(i => i.text)] as const);

describe('promoteInlineColonLabels', () => {
  /**
   * YMCA Youth Civic Engagement's Outputs column, verbatim from
   * `fixtures/regression-set/snapshots/`: three bullets, each opening with its own category, all
   * returned in one group called "General". This is the case the pass exists for, and that
   * document is the one measurable instance of it in the blessed set.
   */
  it('promotes a band of inline labels in an ungrouped column', () => {
    const m = model({
      outputs: {
        content: [
          group(
            'General',
            'Participant Engagement: Attendance and active participation in weekly sessions.',
            'Skill Development: Observable growth in public speaking and leadership.',
            'Social Networks: Connections formed with peers from various schools and regions.'
          ),
        ],
      },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(shape(m.outputs.content), [
      ['Participant Engagement', ['Attendance and active participation in weekly sessions.']],
      ['Skill Development', ['Observable growth in public speaking and leadership.']],
      ['Social Networks', ['Connections formed with peers from various schools and regions.']],
    ]);
  });

  /**
   * A column that opens with prose and then turns into a labelled band. Four labelled of seven
   * clears MIN_LABELLED_SHARE, and the unlabelled three must keep their reading position ahead of
   * the promoted groups rather than being swept to the end.
   */
  it('keeps unlabelled items together, in source position', () => {
    const m = model({
      inputs: {
        content: [
          group(
            'General',
            'A first prose bullet describing the staffing model in a full sentence.',
            'A second prose bullet, listing partners and volunteers without any category label.',
            'A third prose bullet, again carrying no leading category of any kind.',
            'Curricula: instrumental and vocal music, orchestras, ensembles.',
            'Tools: vehicles, instruments, sound systems, rehearsal venues.',
            'Funding: foundations, endowment, government, corporate, individual donors.',
            'Tech: database, automated assessments, payroll systems'
          ),
        ],
      },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(
      (m.inputs.content ?? []).map(g => g.name),
      ['General', 'Curricula', 'Tools', 'Funding', 'Tech']
    );
    assert.equal(m.inputs.content[0].items.length, 3);
    assert.equal(
      m.inputs.content[1].items[0].text,
      'instrumental and vocal music, orchestras, ensembles.'
    );
  });

  it('leaves a column the model already grouped alone', () => {
    const m = model({
      outputs: {
        content: [
          group(
            'Program Delivery',
            'Participants: demographics and attendance.',
            'Community: audience counts.',
            'Evaluation: surveys collected.'
          ),
        ],
      },
    });
    const before = JSON.stringify(m.outputs.content);
    promoteInlineColonLabels(m);
    assert.equal(JSON.stringify(m.outputs.content), before);
  });

  /**
   * Healthy NewsWorks Cub Reporter: nine items all opening "Students demonstrate improvements
   * in:". That is GROUPING GATE rule 8's prefix-fold, already the canonical shape — not a set of
   * categories. Two independent guards reject it (the group is already named, and the labels are
   * not distinct); this asserts the second one on its own.
   */
  it('does not promote a repeated stem', () => {
    const m = model({
      shortTermOutcomes: {
        content: [
          group(
            'General',
            'Students demonstrate: Academic Skills - Writing',
            'Students demonstrate: Academic Skills - Reading',
            'Students demonstrate: Soft Skills - Confidence'
          ),
        ],
      },
    });
    const before = JSON.stringify(m.shortTermOutcomes.content);
    promoteInlineColonLabels(m);
    assert.equal(JSON.stringify(m.shortTermOutcomes.content), before);
  });

  /**
   * The guard still fires when a label names another column OUTRIGHT: promote "Impact" here and
   * `applySourceAwareMapping` moves a long-term outcome into the Impact column on the very next
   * pass. One offending label disqualifies the whole group.
   */
  it('refuses a column whose label names another column outright', () => {
    const m = model({
      longTermOutcomes: {
        content: [
          group(
            'General',
            'Empowered Civic Participation: Students become active, informed citizens.',
            'College and Career Readiness: Development of adaptable skills.',
            'Impact: A network of youth who continue to engage.'
          ),
        ],
      },
    });
    const before = JSON.stringify(m.longTermOutcomes.content);
    promoteInlineColonLabels(m);
    assert.equal(JSON.stringify(m.longTermOutcomes.content), before);
  });

  /**
   * And it no longer fires on a label that merely ENDS in a domain word. This is YMCA's Long-Term
   * Outcomes column verbatim, and the 2026-09-23 audit's fourth defect: "Sustained Community
   * Impact" used to read as the Impact column, so four of that document's five sections promoted
   * their labels and this one did not — same page, same markup, two behaviours. It is a
   * sub-heading, and `columnNameToDomain` now says so, so the fifth section promotes like the
   * rest.
   */
  it('promotes a band whose label only ends in a domain word', () => {
    const m = model({
      longTermOutcomes: {
        content: [
          group(
            'General',
            'Empowered Civic Participation: Students become active, informed citizens.',
            'College and Career Readiness: Development of adaptable skills.',
            'Sustained Community Impact: A network of youth who continue to engage.'
          ),
        ],
      },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(
      (m.longTermOutcomes.content ?? []).map(g => g.name),
      ['Empowered Civic Participation', 'College and Career Readiness', 'Sustained Community Impact']
    );
  });

  /** YMCA's Inputs column: "Resources" is an `inputs` synonym, and it already sits in Inputs. */
  it('allows a label that names the column it already sits in', () => {
    const m = model({
      inputs: {
        content: [
          group(
            'General',
            'Resources: Funding, partnerships with schools and community organizations.',
            'Facilities: Physical and virtual spaces for weekly sessions.',
            'Curriculum and Materials: Structured lesson plans and visual aids.'
          ),
        ],
      },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(
      (m.inputs.content ?? []).map(g => g.name),
      ['Resources', 'Facilities', 'Curriculum and Materials']
    );
  });

  /**
   * YMCA's Activities column is why LABEL_MAX_WORDS is five: "Mock Conferences (MUN and YAG)" is
   * a five-word label, and rejecting it would drop this column to two labelled items.
   */
  it('accepts a five-word label', () => {
    const m = model({
      activities: {
        content: [
          group(
            'General',
            'Weekly Sessions: 1-1.5 hour interactive sessions from September to April.',
            'Pre-Conferences: Held in November and February to introduce students to the format.',
            'Mock Conferences (MUN and YAG): 3-4 day immersive conferences.'
          ),
        ],
      },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(
      (m.activities.content ?? []).map(g => g.name),
      ['Weekly Sessions', 'Pre-Conferences', 'Mock Conferences (MUN and YAG)']
    );
  });

  it('needs at least three labelled items', () => {
    const m = model({
      outputs: { content: [group('General', 'Participants: attendance.', 'Community: counts.')] },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(shape(m.outputs.content), [
      ['General', ['Participants: attendance.', 'Community: counts.']],
    ]);
  });

  it('needs the labelled items to be at least half the column', () => {
    const m = model({
      outputs: {
        content: [
          group(
            'General',
            'Participants: attendance.',
            'Community: counts.',
            'Evaluation: surveys.',
            'A long prose bullet with no leading label at all, describing the work in a sentence.',
            'Another prose bullet, likewise carrying no category label of any kind whatsoever.',
            'A third prose bullet, which together with the others outweighs the labelled ones.',
            'A fourth prose bullet, putting the labelled bullets into a clear minority of three.'
          ),
        ],
      },
    });
    const before = JSON.stringify(m.outputs.content);
    promoteInlineColonLabels(m);
    assert.equal(JSON.stringify(m.outputs.content), before);
  });

  /**
   * The shapes a reviewer would not call a category: a bullet opening with a figure, a sentence
   * that happens to contain a colon, and a label past the word limit. None may be promoted.
   */
  it('rejects prose colons, figures and over-long labels', () => {
    const m = model({
      inputs: {
        content: [
          group(
            'General',
            '110+ professional staff: including those with deep community ties.',
            'Multi-year presence in priority neighbourhoods and strong partnerships: with schools.',
            'Long-term in school and out-of-school-time music instruction: ensembles and coaching.'
          ),
        ],
      },
    });
    const before = JSON.stringify(m.inputs.content);
    promoteInlineColonLabels(m);
    assert.equal(JSON.stringify(m.inputs.content), before);
  });

  it('is idempotent', () => {
    const m = model({
      outputs: {
        content: [
          group('General', 'Participants: attendance.', 'Community: counts.', 'Evaluation: surveys.'),
        ],
      },
    });
    promoteInlineColonLabels(m);
    const once = JSON.stringify(m.outputs.content);
    promoteInlineColonLabels(m);
    assert.equal(JSON.stringify(m.outputs.content), once);
  });

  it('preserves everything on an item except the promoted label', () => {
    const m = model({
      outputs: {
        content: [
          {
            name: 'General',
            items: [
              { text: 'Participants: attendance.', sourcePage: 2, fillColor: 'blue' },
              { text: 'Community: counts.', sourcePage: 2 },
              { text: 'Evaluation: surveys.', sourcePage: 2 },
            ],
          },
        ],
      },
    });
    promoteInlineColonLabels(m);
    assert.deepEqual(m.outputs.content[0].items[0], {
      text: 'attendance.',
      sourcePage: 2,
      fillColor: 'blue',
    });
  });

  it('leaves empty and absent columns alone', () => {
    const m = model();
    promoteInlineColonLabels(m);
    assert.deepEqual(m.outputs.content, []);
    assert.equal(m.generalOutcomes, undefined);
  });
});

describe('inlineLabelsIn', () => {
  it('reports the labels without rewriting the group', () => {
    const g = group(
      'General',
      'Participants: attendance.',
      'Community: counts.',
      'Evaluation: surveys.'
    );
    assert.deepEqual(inlineLabelsIn(g), ['Participants', 'Community', 'Evaluation']);
    assert.equal(g.items[0].text, 'Participants: attendance.');
  });

  it('reports nothing for a group that would not be promoted', () => {
    assert.deepEqual(inlineLabelsIn(group('Program Delivery', 'Participants: attendance.')), []);
  });
});

/**
 * The blast radius, enforced rather than asserted in a comment.
 *
 * The whole case for landing this pass is that it changes ONE of the ten blessed documents, and
 * that the one it changes has the miss it was written for. That claim is what a reviewer is being
 * asked to accept, so it is checked against the committed snapshots on every run: if a future
 * tweak to a threshold or to the label pattern starts regrouping a second document, this fails and
 * names it, instead of the change landing quietly and the comment above going stale.
 */
describe('promoteInlineColonLabels over the blessed snapshots', () => {
  const SNAPSHOTS = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'fixtures',
    'regression-set',
    'snapshots'
  );
  const DOMAINS = [
    'inputs',
    'activities',
    'outputs',
    'shortTermOutcomes',
    'mediumTermOutcomes',
    'longTermOutcomes',
    'generalOutcomes',
    'impact',
  ] as const;

  const grouping = (m: LogicModel) =>
    DOMAINS.map(
      d =>
        `${d}:${((m[d]?.content ?? []) as LogicModelGroup[])
          .map(g => `${g.name}(${g.items.length})`)
          .join(',')}`
    ).join('|');

  const changed = readdirSync(SNAPSHOTS)
    .filter(f => f.endsWith('.json'))
    .sort()
    .filter(f => {
      const raw = JSON.parse(readFileSync(path.join(SNAPSHOTS, f), 'utf8'));
      const m: LogicModel = raw.model ?? raw;
      const before = grouping(m);
      promoteInlineColonLabels(m);
      return grouping(m) !== before;
    });

  /**
   * This used to assert `['ymca-youth-civic-engagement.json']` — the one snapshot of ten this pass
   * regrouped, which was the blast-radius measurement PR #9 shipped on. Those snapshots predated
   * the pass, so re-running it over them did real work.
   *
   * The snapshots were recaptured on 2026-09-23 with the pass live, so every one of them already
   * carries its result and running it again is a no-op. That is a different guard and still a
   * useful one over seventeen real documents: the pass is idempotent (`promoteInlineColonLabels`
   * says it is safe to call twice, and this is what checks it), and it does not newly fire on any
   * blessed document. What it no longer covers is the original question — how many real documents
   * the pass changes at all — which now lives in the verification documents rather than here.
   */
  it('is a no-op over every blessed snapshot', () => {
    assert.deepEqual(changed, []);
  });
});
