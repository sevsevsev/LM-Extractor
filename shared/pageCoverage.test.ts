import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import { findUncoveredGridPages, formatUncoveredPages } from './pageCoverage.js';

// Every string in this file is invented. The documents that drove this check are real client
// logic models and none of their wording appears here.

function groups(texts: string[], name = 'General'): LogicModelGroup[] {
  return [{ name, items: texts.map((text): LogicModelItem => ({ text })) }];
}

function model(overrides: Partial<LogicModel> = {}): LogicModel {
  const empty = { content: [] as LogicModelGroup[] };
  return {
    organization: 'Org',
    program: 'Prog',
    mission: { content: '' },
    targetPopulation: { content: '' },
    inputs: empty,
    activities: empty,
    outputs: empty,
    shortTermOutcomes: empty,
    mediumTermOutcomes: empty,
    longTermOutcomes: empty,
    impact: empty,
    layoutFamily: 'vertical_columns',
    ...overrides,
  };
}

/**
 * A page that clears MIN_PAGE_CHARS and passes the structure gate. Two pages built from different
 * word lists share almost no 12-grams, which is what lets a test say "this page's wording is not in
 * the extraction" without relying on any real document's text.
 */
function gridPage(words: string[]): string {
  // Every line is unique and shares no 12-character run with another page's lines, so "this page's
  // wording is not in the extraction" is a fact about the fixture rather than a coincidence.
  const body: string[] = [];
  for (let i = 0; i < 26; i++) {
    const w = words[i % words.length];
    body.push(`${w}${i} delivers ${w}sustained${i} through ${w}practice${i} for ${w}cohort${i} each term`);
  }
  return [
    'RESOURCES ACTIVITIES OUTPUTS SHORT-TERM OUTCOMES MEDIUM-TERM OUTCOMES LONG-TERM OUTCOMES',
    ...body,
  ].join(' ');
}

const ALPHA = gridPage(['quartzberry', 'lampwright', 'fernshadow', 'cobblemist', 'harrowvane']);
const OMEGA = gridPage(['zephyrgloam', 'thistledown', 'ironbrook', 'velvetspire', 'pinewhistle']);
const EXTRA = [
  gridPage(['brambleknot', 'saltmeadow', 'copperfen', 'duskwillow', 'ambergrove']),
  gridPage(['heronstead', 'kelpwarden', 'nettlecroft', 'opaltrace', 'ryegarden']),
  gridPage(['slateharbor', 'tinderpost', 'umberfield', 'vetchlane', 'wickmoor']),
];

function track(pages: string[]): string {
  return pages.map((text, i) => `## Slide ${i + 1}\n${text}`).join('\n');
}

test('flags a grid page whose wording is absent from the extraction', () => {
  // The shape of the real defect: two grids in one document, only the first one extracted.
  const extracted = model({ inputs: { content: groups([ALPHA]) } });
  const uncovered = findUncoveredGridPages(extracted, track([ALPHA, OMEGA]));
  assert.deepEqual(
    uncovered.map(u => u.page),
    [2]
  );
  assert.ok(uncovered[0].recall < 0.55);
});

test('does not flag a grid page the extraction carries', () => {
  const extracted = model({ inputs: { content: groups([ALPHA]) } });
  assert.deepEqual(findUncoveredGridPages(extracted, track([ALPHA])), []);
});

test('ignores a page with no grid structure, however little of it was extracted', () => {
  // A colour legend and a cover page both carry plenty of text that is never meant to become grid
  // items. Two of these sat at 0.058 and 0.017 recall in the real measurement; both are correct
  // omissions, and the structure gate is the only thing keeping them out.
  const legend =
    'Visual key for this document. Blue marks resources supplied by partners. Green marks activities delivered in classrooms. '.repeat(
      6
    );
  const extracted = model({ inputs: { content: groups([ALPHA]) } });
  assert.deepEqual(findUncoveredGridPages(extracted, track([ALPHA, legend])), []);
});

test('ignores a page too short to measure', () => {
  const stub = 'RESOURCES ACTIVITIES OUTPUTS SHORT-TERM OUTCOMES: see the appendix for detail.';
  const extracted = model({ inputs: { content: groups([ALPHA]) } });
  assert.deepEqual(findUncoveredGridPages(extracted, track([ALPHA, stub])), []);
});

test('has no opinion without a text track or without page markers', () => {
  const extracted = model({ inputs: { content: groups([ALPHA]) } });
  assert.deepEqual(findUncoveredGridPages(extracted, undefined), []);
  assert.deepEqual(findUncoveredGridPages(extracted, ''), []);
  // Word's Track A carries no pagination — nothing page-scoped to compare, so no claim either way.
  assert.deepEqual(findUncoveredGridPages(extracted, OMEGA), []);
});

test('has no opinion when the extraction brought nothing back', () => {
  // `noContent` / `noGridItems` already say this, far more loudly, and every page would fire.
  assert.deepEqual(findUncoveredGridPages(model(), track([ALPHA, OMEGA])), []);
});

test('reports pages in document order and caps the list', () => {
  const extracted = model({ inputs: { content: groups([ALPHA]) } });
  const uncovered = findUncoveredGridPages(extracted, track([ALPHA, OMEGA, ...EXTRA]));
  assert.equal(uncovered.length, 4);
  assert.deepEqual(
    uncovered.map(u => u.page),
    [2, 3, 4, 5]
  );
});

test('formats page lists for the operator-facing blocker', () => {
  assert.equal(formatUncoveredPages([]), '');
  assert.equal(formatUncoveredPages([{ page: 3, recall: 0.1 }]), 'page 3');
  assert.equal(
    formatUncoveredPages([
      { page: 3, recall: 0.1 },
      { page: 5, recall: 0.1 },
    ]),
    'pages 3 and 5'
  );
  assert.equal(
    formatUncoveredPages([
      { page: 3, recall: 0.1 },
      { page: 5, recall: 0.1 },
      { page: 6, recall: 0.1 },
    ]),
    'pages 3, 5 and 6'
  );
});
