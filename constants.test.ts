import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  DETECT_PROMPT_VERSION,
  PROMPT_VERSION,
  getAiExtractionPrompt,
  getDetectLogicModelGroupsPrompt,
  promptVariantLabel,
} from './constants.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = path.join(__dirname, 'fixtures', 'prompt', 'extraction-prompt-variants.json');

/**
 * Golden snapshot of every prompt `getAiExtractionPrompt` can emit.
 *
 * The extraction prompt is the single largest lever on output quality, and it is tuned from
 * expensive real-document batch runs (see docs/specs/friction-log.md). This test exists so that
 * a *refactor* of constants.ts can be proven not to change a single character of what Gemini
 * actually receives — otherwise a restructure and a behavior change land in the same commit and
 * the next batch's results can't be attributed to either.
 *
 * When you intentionally change prompt wording: bump `PROMPT_VERSION`, run
 * `npm run prompt:snapshot`, and review the resulting diff in the snapshot file as the real
 * record of what changed. A failure here with no version bump means an accidental edit.
 */
function loadSnapshot(): Record<string, string> {
  return JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8')) as Record<string, string>;
}

function currentVariants(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const isVision of [true, false]) {
    for (const hasTextTrack of [true, false]) {
      for (const lowLegibility of [true, false]) {
        out[`extract:vision=${isVision}:text=${hasTextTrack}:lowleg=${lowLegibility}`] =
          getAiExtractionPrompt(isVision, { lowLegibility, hasTextTrack });
      }
    }
  }
  out['extract:no-options'] = getAiExtractionPrompt(true);
  for (const n of [1, 2, 7]) out[`detect:pages=${n}`] = getDetectLogicModelGroupsPrompt(n);
  return out;
}

test('every prompt variant matches the committed snapshot', () => {
  const snapshot = loadSnapshot();
  const current = currentVariants();

  assert.deepEqual(
    Object.keys(current).sort(),
    Object.keys(snapshot).sort(),
    'prompt variant set changed — regenerate with `npm run prompt:snapshot`'
  );

  for (const key of Object.keys(current)) {
    assert.equal(
      current[key],
      snapshot[key],
      `prompt "${key}" differs from the committed snapshot. If intentional: bump PROMPT_VERSION and run \`npm run prompt:snapshot\`.`
    );
  }
});

test('prompt versions are set and look like dated versions', () => {
  assert.match(PROMPT_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
  assert.match(DETECT_PROMPT_VERSION, /^\d{4}-\d{2}-\d{2}\.\d+$/);
});

test('promptVariantLabel distinguishes the tracks that change the prompt text', () => {
  assert.equal(
    promptVariantLabel({ isVision: true, hasTextTrack: true, lowLegibility: false }),
    'vision+text'
  );
  assert.equal(
    promptVariantLabel({ isVision: true, hasTextTrack: true, lowLegibility: true }),
    'vision+text+lowleg'
  );
  assert.equal(
    promptVariantLabel({ isVision: true, hasTextTrack: false, lowLegibility: false }),
    'vision-only'
  );
  assert.equal(
    promptVariantLabel({ isVision: false, hasTextTrack: true, lowLegibility: false }),
    'text-only'
  );
});

test('every distinct variant label maps to a distinct prompt text', () => {
  // Guards the analysis contract: pooling two files that got materially different prompts under
  // one label would make a batch's error rates uninterpretable.
  const byLabel = new Map<string, Set<string>>();
  for (const isVision of [true, false]) {
    for (const hasTextTrack of [true, false]) {
      for (const lowLegibility of [true, false]) {
        if (!isVision && !hasTextTrack) continue; // rejected upstream by parseDocumentBundle
        const label = promptVariantLabel({ isVision, hasTextTrack, lowLegibility });
        const text = getAiExtractionPrompt(isVision, { lowLegibility, hasTextTrack });
        if (!byLabel.has(label)) byLabel.set(label, new Set());
        byLabel.get(label)!.add(text);
      }
    }
  }
  for (const [label, texts] of byLabel) {
    assert.equal(texts.size, 1, `variant label "${label}" covers ${texts.size} different prompts`);
  }
});
