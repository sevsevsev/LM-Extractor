import assert from 'node:assert/strict';
import test from 'node:test';
import type { LogicModel, LogicModelGroup, LogicModelItem } from '../types';
import {
  FIDELITY_BLOCKERS,
  countExtractionItems,
  documentTypeFlagLabel,
  formatHardStopMessage,
  reconcileExtractionFidelity,
  shouldHardStopExtraction,
  shouldShowFidelityBanner,
  shouldSoftGateCodingExport,
} from './extractionFidelity.js';

function item(text: string, verbatim?: boolean): LogicModelItem {
  return verbatim === undefined ? { text } : { text, verbatim };
}

function groups(items: LogicModelItem[], name = 'General'): LogicModelGroup[] {
  return [{ name, items }];
}

function baseModel(overrides: Partial<LogicModel> = {}): LogicModel {
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

function manyItems(n: number, nonVerbatim: number): LogicModelItem[] {
  const items: LogicModelItem[] = [];
  for (let i = 0; i < n; i++) {
    items.push(item(`Item ${i}`, i < nonVerbatim ? false : true));
  }
  return items;
}

test('ok + few non-verbatim → high', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'ok');
  assert.equal(model.extractionConfidence, 'high');
  assert.equal(shouldShowFidelityBanner(model), false);
  assert.equal(shouldSoftGateCodingExport(model), false);
});

/**
 * The four tests that used to sit here pinned the non-verbatim RATIO: 0.15 upgraded ok -> partial,
 * 0.40 on a partial drove confidence to `low`, and `low` hard-stops the extraction in App.tsx.
 *
 * That ratio counted `item.verbatim === false` — a field the prompt stopped defining in
 * PROMPT_VERSION 2026-09-20.2 while the response schema went on asking Gemini for it. So the input
 * to the discard decision was a field the model answered with no instruction to answer it against.
 * It never fired only because the model happened to answer `true` on 100% of items measured
 * (friction-log sessions 19-20). Gemini is no longer asked for it at all, and nothing but a human
 * edit can set it, so those thresholds are gone rather than merely unreachable.
 *
 * What replaces them is the inverse guarantee: item-level `verbatim` must NOT move the gate.
 */
test('items marked non-verbatim no longer change status or confidence', () => {
  const flagged = baseModel({ activities: { content: groups(manyItems(10, 5)) } }); // would have been 0.50
  const clean = baseModel({ activities: { content: groups(manyItems(10, 0)) } });
  reconcileExtractionFidelity(flagged);
  reconcileExtractionFidelity(clean);
  assert.equal(flagged.extractionStatus, clean.extractionStatus);
  assert.equal(flagged.extractionConfidence, clean.extractionConfidence);
  assert.equal(flagged.extractionConfidence, 'high');
});

test('a flawless extraction is never discarded because items carry verbatim:false', () => {
  // The exact shape of the withdrawn 2026-09-19.3 hazard: every item flagged, nothing else wrong.
  // Before session 20 this returned `low`, and `low` means App.tsx throws the extraction away.
  const model = baseModel({ activities: { content: groups(manyItems(10, 10)) } });
  reconcileExtractionFidelity(model);
  assert.notEqual(model.extractionConfidence, 'low');
  assert.equal(shouldHardStopExtraction(model), false);
});

test('a small extract with no other problem stays high whatever verbatim says', () => {
  const model = baseModel({ activities: { content: groups(manyItems(5, 4)) } });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionConfidence, 'high');
  assert.equal(shouldShowFidelityBanner(model), false);
});

test('small low-legibility extract is flagged, never discarded', () => {
  const model = baseModel({
    activities: { content: groups([item('A'), item('B'), item('C')]) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionConfidence, 'medium');
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
});

test('a dense low-legibility extract warns loudly but still reaches the operator', () => {
  const model = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.lowLegibilityDense));
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
});

test('mismatch true → partial upgrade + medium', () => {
  // N>=8 and U/N >= 0.30
  const mapped = manyItems(6, 0);
  const unmapped = manyItems(4, 0);
  const model = baseModel({
    activities: { content: groups(mapped) },
    unmapped: {
      content: [
        { name: 'Assumptions', items: unmapped.slice(0, 2) },
        { name: 'External Factors', items: unmapped.slice(2) },
      ],
    },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.ok(
    model.extractionConfidence === 'medium' || model.extractionConfidence === 'low'
  );
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.mismatch));
});

test('unknown layoutFamily upgrades ok → partial', () => {
  const model = baseModel({
    layoutFamily: 'unknown',
    activities: { content: groups(manyItems(6, 0)) },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.unknownLayout));
});

test('abstained sticky with low confidence', () => {
  const model = baseModel({
    extractionStatus: 'abstained',
    extractionBlockers: ['Not a logic model'],
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'abstained');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.abstained));
  assert.ok(model.extractionBlockers?.includes('Not a logic model'));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('never downgrade partial → ok when signals clear', () => {
  const model = baseModel({
    extractionStatus: 'partial',
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: false });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(shouldSoftGateCodingExport(model), true);
  assert.equal(shouldHardStopExtraction(model), false);
});

test('no content → partial + low + blocker', () => {
  const model = baseModel();
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noContent));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('shouldHardStopExtraction on low even if status ok', () => {
  const model = baseModel({
    extractionStatus: 'ok',
    extractionConfidence: 'low',
    activities: { content: groups(manyItems(3, 0)) },
  });
  assert.equal(shouldHardStopExtraction(model), true);
  assert.equal(shouldSoftGateCodingExport(model), false);
});

/**
 * The art-thru-youth case (friction-log session 11). A 1024px PNG extracted string-for-string
 * against its source, with zero inventions, and was discarded anyway because this branch forced
 * `low`. Low legibility is a reason to CHECK an extraction, not a reason to throw it away — the
 * conversion warning that triggers it literally says "verify the extracted wording against the
 * original". It must still shout: the same document returns 18/17/13 items across three runs.
 */
test('dense low-legibility grid warns loudly and still reaches the operator (Oxford-class)', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(10, 0)) },
  });
  reconcileExtractionFidelity(model, { lowLegibility: true });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.lowLegibilityDense));
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true); // operator sees extraction + warning
});

/** The boundary: `low` still means "nothing worth showing", and those cases still hard-stop. */
test('low legibility does not hard-stop, but abstained and no-content still do', () => {
  const legible = baseModel({ activities: { content: groups(manyItems(10, 0)) } });
  reconcileExtractionFidelity(legible, { lowLegibility: true });
  assert.equal(shouldHardStopExtraction(legible), false);

  const abstained = baseModel({ extractionStatus: 'abstained' });
  reconcileExtractionFidelity(abstained, { lowLegibility: true });
  assert.equal(shouldHardStopExtraction(abstained), true);

  const empty = baseModel({});
  reconcileExtractionFidelity(empty, { lowLegibility: true });
  assert.equal(shouldHardStopExtraction(empty), true);
});

test('formatHardStopMessage explains in plain language and keeps the reason verbatim', () => {
  assert.match(formatHardStopMessage([]), /could not extract/i);
  // The reason is operator-facing copy — pass it through untouched rather than re-casing it.
  assert.match(formatHardStopMessage(['Illegible grid']), /Illegible grid/);
  assert.match(formatHardStopMessage(['One', 'Two', 'Three']), /2 other reasons/);
});

test('countExtractionItems includes unmapped', () => {
  const model = baseModel({
    activities: { content: groups([item('a', true)]) },
    unmapped: { content: groups([item('b', false)], 'Other') },
  });
  assert.deepEqual(countExtractionItems(model), { total: 2 });
});

// The client-side text-line-counting heuristic that used to live here (comparing candidate
// bullet/numbered lines in Track A against extracted item counts) was removed after auditing a
// real 112-file batch: hand-verifying 3 flagged documents against their source PDFs found it
// firing on wrapped multi-column table lines, numbered academic references, and legitimate
// secondary sections (evaluation frameworks, stat-tile infographics) — 3 for 3 false positives,
// driving the majority of that batch's "Needs Review" flags. Gemini's own per-image self-report
// (tested via `possiblyMissedRegions` on the model directly, below) is the only remaining source.
test('possiblyMissedRegions on the model (Gemini self-report) drives possiblyIncomplete; a model with none never flags on its own', () => {
  const clean = baseModel({ activities: { content: groups(manyItems(9, 0)) } });
  reconcileExtractionFidelity(clean);
  assert.equal(clean.extractionStatus, 'ok');
  assert.equal(clean.extractionConfidence, 'high');
  assert.ok(!clean.extractionBlockers?.includes(FIDELITY_BLOCKERS.possiblyIncomplete));

  const flagged = baseModel({
    activities: { content: groups(manyItems(9, 0)) },
    possiblyMissedRegions: [{ page: 1, note: 'A labeled box on this image was not transcribed' }],
  });
  reconcileExtractionFidelity(flagged);
  assert.equal(flagged.extractionStatus, 'partial');
  assert.equal(flagged.extractionConfidence, 'medium');
  assert.ok(flagged.extractionBlockers?.includes(FIDELITY_BLOCKERS.possiblyIncomplete));
  assert.equal(shouldHardStopExtraction(flagged), false);
});

test('documentTypeAssessment "not_logic_model" flags for review, never hard-stops', () => {
  const model = baseModel({
    documentTypeAssessment: 'not_logic_model',
    documentTypeNote: 'Reads as a Theory of Change narrative',
    mission: { content: 'Through sustained investment, ...' },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.some(b => /may not be a logic model/i.test(b)));
  assert.ok(model.extractionBlockers?.some(b => b.includes('Theory of Change narrative')));
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
  assert.match(documentTypeFlagLabel(model), /^Not a logic model — the app sorted these items into columns/);
});

test('documentTypeAssessment "unclear" also flags for review', () => {
  const model = baseModel({
    documentTypeAssessment: 'unclear',
    mission: { content: 'Overview text' },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(shouldHardStopExtraction(model), false);
  assert.match(documentTypeFlagLabel(model), /^Unclear document type — some columns may have been assigned/);
});

test('documentTypeAssessment "logic_model" (or absent) never flags', () => {
  const clean = baseModel({
    documentTypeAssessment: 'logic_model',
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(clean);
  assert.equal(clean.extractionStatus, 'ok');
  assert.equal(documentTypeFlagLabel(clean), '');

  const absent = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(absent);
  assert.equal(absent.extractionStatus, 'ok');
  assert.equal(documentTypeFlagLabel(absent), '');
});

test('textOnlyFallback flags for review, never hard-stops, even with clean-looking content', () => {
  const model = baseModel({
    activities: { content: groups(manyItems(8, 0)) },
  });
  reconcileExtractionFidelity(model, { textOnlyFallback: true });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.textOnlyFallback));
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
});

test('textOnlyFallback: false (or absent) never flags on its own', () => {
  const model = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(model, { textOnlyFallback: false });
  assert.equal(model.extractionStatus, 'ok');

  const absent = baseModel({ activities: { content: groups(manyItems(8, 0)) } });
  reconcileExtractionFidelity(absent);
  assert.equal(absent.extractionStatus, 'ok');
});

test('zero grid items with recovered overview text flags for review instead of passing as ok/high', () => {
  // Real gap found via a 112-file batch run: hasRecoveredLogicModelContent() is satisfied by
  // mission/target/impact text alone, so a document that extracted zero inputs/activities/
  // outputs/outcomes items could previously report "Successfully Processed" / high confidence.
  const model = baseModel({
    mission: { content: 'A real mission statement was recovered.' },
    targetPopulation: { content: 'Youth in grades 6-12' },
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noGridItems));
  assert.equal(shouldHardStopExtraction(model), false);
});

test('a genuinely empty result (no overview text either) still gets the stricter noContent treatment', () => {
  const model = baseModel();
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'low');
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noContent));
  assert.ok(!model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noGridItems));
  assert.equal(shouldHardStopExtraction(model), true);
});

test('Gemini-reported possiblyMissedRegions are normalized and deduped', () => {
  const items: LogicModelItem[] = [{ text: 'Item 1', sourcePage: 1 }];
  const model = baseModel({
    activities: { content: groups(items) },
    possiblyMissedRegions: [
      { page: 2, xStart: 0.1, xEnd: 0.3, note: 'Left column looks cut off' },
      { page: 0, note: 'invalid page, must be dropped' },
      { page: 2, xStart: 0.1, xEnd: 0.3, note: 'duplicate of the first entry, must be deduped' },
      { page: 3, xStart: 0.5, xEnd: 0.2, note: 'invalid span (end before start), span must be dropped' },
    ],
  });
  reconcileExtractionFidelity(model);
  assert.equal(model.extractionStatus, 'partial');
  assert.deepEqual(model.possiblyMissedRegions, [
    { page: 2, xStart: 0.1, xEnd: 0.3, note: 'Left column looks cut off' },
    { page: 3, note: 'invalid span (end before start), span must be dropped' },
  ]);
});

/**
 * FIDELITY_BLOCKERS is the text an operator reads in the banner and beside a flagged file. It was
 * rewritten out of schema/NLP vocabulary in friction-log session 13 ("Model abstained from
 * extraction", "Layout family unknown", "Share of items flagged non-verbatim is high"). This keeps
 * the next addition from quietly reintroducing it.
 */
{
  const banned = [
    'verbatim', 'schema', 'enum', 'domain', 'json', 'null', 'undefined', 'nlp', 'token',
    'prompt', 'parse', 'layout family', 'abstain', 'legibility', 'fidelity', 'non-verbatim',
  ];

  for (const [key, text] of Object.entries(FIDELITY_BLOCKERS)) {
    test(`blocker copy: ${key} avoids jargon and tells the operator something`, () => {
      // "the model" is how these used to refer to Gemini; "the AI" is what a reader outside this
      // codebase understands. "logic model" is the domain term and is fine.
      const probe = text.toLowerCase().replace(/logic model/g, '');
      for (const word of banned) {
        assert.ok(!probe.includes(word), `blocker "${key}" contains "${word}": ${text}`);
      }
      assert.ok(!/\bthe model\b/.test(probe), `blocker "${key}" says "the model" — say "the AI": ${text}`);
      assert.ok(text.length >= 25, `blocker "${key}" is too terse to act on: ${text}`);
      assert.ok(/^[A-Z]/.test(text), `blocker "${key}" should read as a sentence: ${text}`);
    });
  }
}

/**
 * Page coverage — the code-side missed-content signal (shared/pageCoverage.ts). Its own unit tests
 * cover what it detects; these cover how the rollup treats it. All wording below is invented.
 */
function coveragePage(words: string[]): string {
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

const COVERAGE_KEPT = coveragePage(['quartzberry', 'lampwright', 'fernshadow', 'cobblemist', 'harrowvane']);
const COVERAGE_DROPPED = coveragePage(['zephyrgloam', 'thistledown', 'ironbrook', 'velvetspire', 'pinewhistle']);
const COVERAGE_TRACK = `## Slide 1\n${COVERAGE_KEPT}\n## Slide 2\n${COVERAGE_DROPPED}`;

function coverageModel(): LogicModel {
  return baseModel({ inputs: { content: groups([item(COVERAGE_KEPT)]) } });
}

test('a page of grid content missing from the extraction caps ok/high at partial/medium', () => {
  const model = coverageModel();
  reconcileExtractionFidelity(model, { sourceText: COVERAGE_TRACK });
  assert.equal(model.extractionStatus, 'partial');
  assert.equal(model.extractionConfidence, 'medium');
  assert.ok(model.extractionBlockers?.some(b => b.startsWith(FIDELITY_BLOCKERS.pageNotExtracted)));
});

test('the page-coverage blocker names the page', () => {
  const model = coverageModel();
  reconcileExtractionFidelity(model, { sourceText: COVERAGE_TRACK });
  const blocker = model.extractionBlockers?.find(b => b.startsWith(FIDELITY_BLOCKERS.pageNotExtracted));
  assert.equal(blocker, `${FIDELITY_BLOCKERS.pageNotExtracted} (page 2)`);
});

test('page coverage never hard-stops an extraction', () => {
  const model = coverageModel();
  reconcileExtractionFidelity(model, { sourceText: COVERAGE_TRACK });
  assert.equal(shouldHardStopExtraction(model), false);
  assert.equal(shouldShowFidelityBanner(model), true);
});

test('a fully covered document is untouched by the check', () => {
  const model = baseModel({ inputs: { content: groups([item(COVERAGE_KEPT)]) } });
  reconcileExtractionFidelity(model, { sourceText: `## Slide 1\n${COVERAGE_KEPT}` });
  assert.equal(model.extractionStatus, 'ok');
  assert.equal(model.extractionConfidence, 'high');
  assert.equal(model.extractionBlockers, undefined);
});

test('re-reconciling without the text track keeps the page-coverage warning', () => {
  // App.tsx's `modelForExport` re-normalizes with no bundle in hand. A warning raised on the first
  // pass must survive that, or the export would quietly disagree with the board.
  const model = coverageModel();
  reconcileExtractionFidelity(model, { sourceText: COVERAGE_TRACK });
  reconcileExtractionFidelity(model, {});
  assert.equal(model.extractionStatus, 'partial');
  assert.ok(model.extractionBlockers?.some(b => b.startsWith(FIDELITY_BLOCKERS.pageNotExtracted)));
});

test('page coverage stays quiet when nothing came back at all', () => {
  const model = baseModel();
  reconcileExtractionFidelity(model, { sourceText: COVERAGE_TRACK });
  assert.ok(model.extractionBlockers?.includes(FIDELITY_BLOCKERS.noContent));
  assert.ok(!model.extractionBlockers?.some(b => b.startsWith(FIDELITY_BLOCKERS.pageNotExtracted)));
});
