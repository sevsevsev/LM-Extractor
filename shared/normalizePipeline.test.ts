import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRawFixtures, replayFixture } from '../scripts/normalize-replay.ts';
import { diffExtractions, formatExtractionDiff } from './extractionDiff.ts';
import type { LogicModel } from '../types.ts';

/**
 * The composition test for `normalizeExtractedLogicModel`.
 *
 * Every pass it composes has its own unit tests over hand-built objects. What had no test was the
 * six of them running in order over a WHOLE model, which is where both post-processing defects
 * this project has shipped actually lived — the impact-statement harvester filling a field Gemini
 * correctly left empty, and the synonym remapper moving items out of columns the extraction got
 * right. A unit test on either module in isolation passed throughout.
 *
 * The inputs are real Gemini answers to the synthetic benchmark documents, captured at the seam
 * (see scripts/normalize-replay.ts). They are committable precisely because those documents are
 * invented: a raw answer carries the document's own wording, so a client document's answer could
 * never live here.
 *
 * A failure here is not necessarily a bug — an intended change to post-processing changes these
 * files. It means: look at the diff, satisfy yourself every line of it is what you meant, then
 * `npm run replay -- --bless` and say why in the commit message.
 */
const expectedDir = path.resolve(import.meta.dirname, '..', 'fixtures', 'normalize', 'expected');

test('post-processing over whole model answers matches the blessed output', () => {
  const fixtures = loadRawFixtures();
  assert.ok(fixtures.length >= 5, `expected a fixture set, found ${fixtures.length}`);
  for (const fixture of fixtures) {
    const expectedPath = path.join(expectedDir, `${fixture.id}.json`);
    assert.ok(existsSync(expectedPath), `${fixture.id} has no blessed output — run npm run replay`);
    const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as LogicModel;
    const diff = diffExtractions(expected, replayFixture(fixture));
    assert.equal(diff.unchanged, true, `${fixture.id} changed:\n${formatExtractionDiff(fixture.id, diff)}`);
  }
});

test('normalization does not depend on being run twice, or on run order', () => {
  // Every pass mutates the model in place. If one of them is not idempotent, a retry path or a
  // second normalization on the client (App.tsx calls it too) silently produces a third answer.
  for (const fixture of loadRawFixtures()) {
    const once = replayFixture(fixture);
    const twice = JSON.parse(JSON.stringify(once)) as LogicModel;
    const again = replayFixture({ ...fixture, raw: twice });
    const diff = diffExtractions(once, again);
    assert.equal(diff.unchanged, true, `${fixture.id} is not idempotent:\n${formatExtractionDiff(fixture.id, diff)}`);
  }
});

test('every raw fixture records the prompt version that produced it', () => {
  for (const fixture of loadRawFixtures()) {
    assert.match(fixture.promptVersion, /^\d{4}-\d{2}-\d{2}/, `${fixture.id} has no prompt version`);
  }
});
