import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Every property in the Gemini response schema is a QUESTION PUT TO THE MODEL, and the model
 * answers it whether or not the prompt ever says what it means.
 *
 * This is the detector for the session-19/20 bug. `verbatim` and `sourceNote` stayed in
 * `baseItemSchema` after PROMPT_VERSION 2026-09-20.2 removed every instruction defining them, so
 * Gemini kept answering on its own recognisance, and `shared/extractionFidelity.ts` kept feeding
 * the answer into the ratio that could drive `extractionConfidence` to `low` — which discards the
 * extraction. It never fired only because the model happened to answer `true` every time.
 *
 * The oracle is the BUILT prompt snapshot, not `constants.ts`: that file's comment history
 * mentions `verbatim` seven times while the prompt actually sent to Gemini defines it nowhere, so
 * grepping the source would have passed this test on the very bug it exists to catch. Backticks
 * are the discriminator — the prompt refers to real fields as `fieldName`, and the one surviving
 * plain-prose mention of "verbatim" ("an odd-looking verbatim string") is not a field definition.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverSrc = readFileSync(path.join(root, 'server', 'geminiLogicModel.ts'), 'utf8');
const promptSnapshot = readFileSync(
  path.join(root, 'fixtures', 'prompt', 'extraction-prompt-variants.json'),
  'utf8'
);

/**
 * Schema fields the prompt deliberately does not define, each with the reason. A field belongs
 * here only when nothing downstream branches on Gemini's answer to it.
 */
const UNDEFINED_BY_DESIGN: Record<string, string> = {};

function itemSchemaProperties(): string[] {
  const block = serverSrc.match(/const baseItemSchema: Schema = \{[\s\S]*?\n\};/);
  assert.ok(block, 'could not find baseItemSchema — has it been renamed?');
  const props = block[0].match(/^\s{4}(\w+):/gm) ?? [];
  return props.map(p => p.trim().replace(':', ''));
}

describe('Gemini item schema and the prompt agree', () => {
  it('finds the schema properties at all (guards the parser itself)', () => {
    const props = itemSchemaProperties();
    assert.ok(props.includes('text'), `expected 'text' among [${props.join(', ')}]`);
    assert.ok(props.length >= 4, `only found ${props.length} properties — parser likely broken`);
  });

  it('asks Gemini for nothing the prompt leaves undefined', () => {
    const undefinedFields = itemSchemaProperties().filter(
      field => !promptSnapshot.includes(`\`${field}\``) && !(field in UNDEFINED_BY_DESIGN)
    );
    assert.deepEqual(
      undefinedFields,
      [],
      `These fields are in the response schema but never defined in the built prompt, so Gemini ` +
        `answers them with nothing to go on: ${undefinedFields.join(', ')}. Either instruct the ` +
        `model in constants.ts (and re-run \`npm run prompt:snapshot\`), drop them from ` +
        `baseItemSchema, or add them to UNDEFINED_BY_DESIGN with a reason.`
    );
  });

  it('still refuses the exact pair that caused the bug', () => {
    const props = itemSchemaProperties();
    for (const field of ['verbatim', 'sourceNote']) {
      assert.ok(
        !props.includes(field),
        `\`${field}\` is back in baseItemSchema. It is a human-set field (LogicModelBoard sets ` +
          `\`verbatim: true\` on edit); reinstating it as a model-answered one needs a prompt ` +
          `instruction landed at the same time, or the fidelity rollup reads a guess again.`
      );
    }
  });
});
