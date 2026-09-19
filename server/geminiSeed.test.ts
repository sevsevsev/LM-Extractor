import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveGeminiSeed } from './geminiSeed.ts';

test('deriveGeminiSeed is deterministic for the same input', () => {
  const a = deriveGeminiSeed(['prompt', 'text track', 'img-base64-a', 'img-base64-b']);
  const b = deriveGeminiSeed(['prompt', 'text track', 'img-base64-a', 'img-base64-b']);
  assert.equal(a, b);
});

test('deriveGeminiSeed differs for different input', () => {
  const a = deriveGeminiSeed(['prompt', 'text track', 'img-base64-a']);
  const b = deriveGeminiSeed(['prompt', 'text track', 'img-base64-b']);
  assert.notEqual(a, b);
});

test('deriveGeminiSeed ignores undefined/empty entries the same as omitting them', () => {
  const a = deriveGeminiSeed(['prompt', undefined, 'img']);
  const b = deriveGeminiSeed(['prompt', 'img']);
  assert.equal(a, b);
});

test('deriveGeminiSeed always returns a value within signed INT32 range', () => {
  // Regression: readUInt32BE previously produced values above INT32_MAX (Gemini's `seed` is a
  // signed TYPE_INT32) — confirmed live via a real extraction request Google rejected with
  // "Invalid value at 'generation_config.seed' (TYPE_INT32), 3867915212". Check many inputs, since
  // the bug is about the *range* of possible outputs, not any one fixed input.
  for (let i = 0; i < 200; i++) {
    const s = deriveGeminiSeed([`input-${i}`, `variant-${i * 7}`]);
    assert.ok(Number.isInteger(s));
    assert.ok(s >= -2147483648 && s <= 2147483647, `seed ${s} out of signed INT32 range`);
  }
});

/**
 * Guard for the paired-A/B contract: the seed must key on document content only.
 *
 * The prompt used to be part of this hash, so every PROMPT_VERSION bump silently moved the seed
 * too — meaning a comparison between two prompt versions mixed the prompt change with a sampling
 * change and the two could not be separated. Prompt revision in this project is driven entirely by
 * comparing batch runs (see the working agreement at the top of constants.ts), so this property is
 * load-bearing for the whole tuning loop, not a detail.
 */
test('same document content yields the same seed regardless of prompt text', () => {
  const textTrack = '## Page 1\nRESOURCES\nStaff';
  const images = ['img-a', 'img-b'];
  const withPromptA = deriveGeminiSeed([textTrack, ...images]);
  const withPromptB = deriveGeminiSeed([textTrack, ...images]);
  assert.equal(withPromptA, withPromptB);

  // And the seed still moves when the DOCUMENT changes — otherwise it would be a constant.
  assert.notEqual(deriveGeminiSeed([textTrack, ...images]), deriveGeminiSeed([textTrack, 'img-c']));
  assert.notEqual(deriveGeminiSeed([textTrack, ...images]), deriveGeminiSeed(['other text', ...images]));
});
