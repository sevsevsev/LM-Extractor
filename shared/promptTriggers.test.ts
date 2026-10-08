import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLayoutSignals, MIN_CHARS_TO_CLAIM_ABSENCE } from './promptTriggers.ts';
import { getAiExtractionPrompt, promptShapeFromEnv, promptVariantLabel } from '../constants.ts';

const GRID = ['## Slide 1', '**Inputs**', 'Staff', '**Activities**', '- Tutoring', '### Outputs', '40 sessions', 'Short-Term Outcomes:', 'Better grades'].join('\n');
const NARRATIVE = Array.from({ length: 10 }, (_, i) =>
  `Paragraph ${i + 1}: our programme believes every young person deserves a mentor, and our activities have grown each year.`
).join('\n');

test('three distinct column names on lines of their own read as a grid', () => {
  assert.equal(detectLayoutSignals(GRID).grid, 'present');
});

test('column words inside prose are not headings', () => {
  assert.ok(NARRATIVE.length >= MIN_CHARS_TO_CLAIM_ABSENCE);
  assert.equal(detectLayoutSignals(NARRATIVE).grid, 'absent');
});

test('a flattened PPTX track reads its grid from inline capitals, and never claims absence', () => {
  const flat =
    '## Slide 1\n\nRiverbend Logic Model RESOURCES Two coordinators ACTIVITIES Weekly mentoring ' +
    'OUTPUTS Forty sessions SHORT-TERM OUTCOMES Better reading';
  assert.equal(detectLayoutSignals(flat).grid, 'present');
  const flatProse = '## Slide 1\n\n' + 'Our activities and outputs are described in the outcomes report. '.repeat(10);
  assert.equal(detectLayoutSignals(flatProse).grid, 'unknown');
});

test('no text track, or too little text, claims nothing', () => {
  assert.equal(detectLayoutSignals(undefined).grid, 'unknown');
  assert.equal(detectLayoutSignals('A short page.').grid, 'unknown');
  assert.equal(detectLayoutSignals('Activities\nOutputs\nSome text').grid, 'unknown');
});

test('the four outcome tiers count as one column family', () => {
  const tiers = 'Short-Term Outcomes\nx\nMedium-Term Outcomes\ny\nLong-Term Outcomes\nz';
  assert.equal(detectLayoutSignals(tiers).grid, 'unknown');
});

test('the full shape is the default, and ignores the text track entirely', () => {
  const a = getAiExtractionPrompt(true, { hasTextTrack: true });
  const b = getAiExtractionPrompt(true, { hasTextTrack: true, textTrack: GRID, shape: 'full' });
  assert.equal(a, b);
  assert.equal(promptVariantLabel({ isVision: true, hasTextTrack: true, textTrack: GRID }), 'vision+text');
});

test('layered drops the no-grid method and its pointer only when a grid is visible', () => {
  const grid = getAiExtractionPrompt(true, { hasTextTrack: true, textTrack: GRID, shape: 'layered' });
  assert.ok(!grid.includes('WHEN THERE IS NO GRID'));
  const narrative = getAiExtractionPrompt(true, { hasTextTrack: true, textTrack: NARRATIVE, shape: 'layered' });
  assert.ok(narrative.includes('**WHEN THERE IS NO GRID**'));
  assert.ok(narrative.includes('see WHEN THERE IS NO GRID'));
});

test('layered always drops the failure-mode recap and always keeps every section another rule cites', () => {
  for (const textTrack of [GRID, NARRATIVE, undefined]) {
    const p = getAiExtractionPrompt(true, { hasTextTrack: Boolean(textTrack), textTrack, shape: 'layered' });
    assert.ok(!p.includes('KNOWN FAILURE MODES'));
    for (const kept of ['**COLUMN FIDELITY (HARD RULES)**', '**COLOUR CODING', '**ONE PROGRAM PRINTED TWICE**', '**GROUPING GATE**', 'DOCUMENT TYPE CHECK']) {
      assert.ok(p.includes(kept), `${kept} missing`);
    }
  }
});

test('a layered prompt is labelled with what was detected, so arms never pool', () => {
  assert.equal(
    promptVariantLabel({ isVision: true, hasTextTrack: true, textTrack: GRID, shape: 'layered' }),
    'vision+text+layered:grid=present'
  );
});

test('LM_PROMPT_SHAPE: unset or blank is full, a known value is honoured, anything else refuses to run', () => {
  const saved = process.env.LM_PROMPT_SHAPE;
  try {
    delete process.env.LM_PROMPT_SHAPE;
    assert.equal(promptShapeFromEnv(), 'full');
    process.env.LM_PROMPT_SHAPE = '  ';
    assert.equal(promptShapeFromEnv(), 'full');
    process.env.LM_PROMPT_SHAPE = 'Layered';
    assert.equal(promptShapeFromEnv(), 'layered');
    process.env.LM_PROMPT_SHAPE = 'short';
    assert.throws(() => promptShapeFromEnv(), /LM_PROMPT_SHAPE=short/);
  } finally {
    if (saved === undefined) delete process.env.LM_PROMPT_SHAPE;
    else process.env.LM_PROMPT_SHAPE = saved;
  }
});
