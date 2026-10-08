/**
 * What can honestly be tested here without a key: request CONSTRUCTION and response READING, both
 * pure. Nothing below says the Anthropic path produces good extractions — only that it asks the
 * same question the Gemini path asks, and that it refuses to treat a refusal or a truncated answer
 * as an extraction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXTRACT_JSON_SCHEMA,
  buildExtractRequest,
  extractEffort,
  readStructuredText,
} from './anthropicLogicModel.ts';
import type { DocumentBundle } from '../types.ts';

function withEnv(vars: Record<string, string | undefined>, run: () => void): void {
  const saved = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const bundle = (over: Partial<DocumentBundle> = {}): DocumentBundle => ({
  images: ['aaaa'],
  textTrack: '## Slide 1\n\nINPUTS Two tutors',
  warnings: [],
  sourceFormat: 'pptx',
  ...over,
});

function textBlocks(req: ReturnType<typeof buildExtractRequest>): string[] {
  return req.messages[0].content.filter(b => b.type === 'text').map(b => b.text ?? '');
}

test('the prompt is the first block and carries the cache breakpoint', () => {
  withEnv({ LM_EXTRACT_EFFORT: undefined }, () => {
    const req = buildExtractRequest(bundle(), 'claude-opus-5-5');
    const first = req.messages[0].content[0];
    assert.equal(first.type, 'text');
    assert.deepEqual(first.cache_control, { type: 'ephemeral' });
    assert.ok(first.text && first.text.includes('Logic Model Analyst'), 'the real extraction prompt');
    // Everything after the breakpoint is per-document, or the cache never hits.
    assert.equal(
      req.messages[0].content.slice(1).some(b => b.cache_control),
      false
    );
  });
});

test('both tracks are sent, in the same order and with the same labels as the Gemini path', () => {
  const req = buildExtractRequest(
    bundle({ images: ['a', 'b'], imageRefs: [{ page: 1 }, { page: 2, column: 3 }] }),
    'claude-opus-5-5'
  );
  const texts = textBlocks(req);
  assert.ok(texts.some(t => t.includes('TRACK A — STRUCTURAL TEXT')));
  assert.ok(texts.some(t => t.includes('TRACK B image 1 of 2: document page 1.')));
  assert.ok(texts.some(t => t.includes('TRACK B image 2 of 2: document page 2, column 3 (left→right).')));
  const images = req.messages[0].content.filter(b => b.type === 'image');
  assert.equal(images.length, 2);
  assert.deepEqual(images[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'a' });
});

test('a text-only bundle sends the text-only framing and no image blocks', () => {
  const req = buildExtractRequest(bundle({ images: [] }), 'claude-opus-5-5');
  assert.equal(req.messages[0].content.filter(b => b.type === 'image').length, 0);
  assert.ok(textBlocks(req).some(t => t.includes('TRACK A — DOCUMENT CONTENT (text-only')));
});

test('a bundle with neither images nor text is refused rather than sent', () => {
  assert.throws(
    () => buildExtractRequest(bundle({ images: [], textTrack: '   ' }), 'claude-opus-5-5'),
    /must include images\[\] or a non-empty textTrack/
  );
});

test('the response format is the JSON schema, and no effort is sent by default', () => {
  withEnv({ LM_EXTRACT_EFFORT: undefined }, () => {
    const req = buildExtractRequest(bundle(), 'claude-opus-5-5');
    assert.deepEqual(req.output_config.format, { type: 'json_schema', schema: EXTRACT_JSON_SCHEMA });
    assert.equal('effort' in req.output_config, false, 'the model default stands unless asked');
  });
});

test('LM_EXTRACT_EFFORT selects an arm, and an unrecognised value throws', () => {
  withEnv({ LM_EXTRACT_EFFORT: 'high' }, () => {
    assert.equal(extractEffort(), 'high');
    assert.equal(buildExtractRequest(bundle(), 'claude-opus-5-5').output_config.effort, 'high');
  });
  withEnv({ LM_EXTRACT_EFFORT: 'default' }, () => assert.equal(extractEffort(), null));
  withEnv({ LM_EXTRACT_EFFORT: 'turbo' }, () =>
    assert.throws(() => extractEffort(), /not an effort level/)
  );
});

/**
 * The schema is a set of QUESTIONS, and the two vendors must be asked the same ones or a
 * comparison between them is measuring the schemas. `documentTypeAssessment` and
 * `extractionStatus` are here because on the Gemini side both were called REQUIRED in the prompt
 * while only the schema actually enforced them — a document the model meant to abstain on
 * presented as a high-confidence success.
 */
test('the required list matches the one the Gemini schema enforces', () => {
  assert.deepEqual([...EXTRACT_JSON_SCHEMA.required], [
    'organization',
    'program',
    'mission',
    'targetPopulation',
    'inputs',
    'activities',
    'outputs',
    'shortTermOutcomes',
    'mediumTermOutcomes',
    'longTermOutcomes',
    'impact',
    'documentTypeAssessment',
    'extractionStatus',
  ]);
});

test('the structured answer is read from the first text block, past any thinking block', () => {
  const answer = '{"organization":"Acme"}';
  assert.equal(
    readStructuredText({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: answer }],
    }),
    answer
  );
});

/**
 * Both arrive as HTTP 200 with content that does not match the schema. Handing either to
 * `parseLogicModelResponse` would turn a vendor-side non-answer into a parse error blamed on us,
 * or worse into a partial extraction nobody flagged.
 */
test('a refusal and a truncated answer are errors, not extractions', () => {
  assert.throws(
    () => readStructuredText({ stop_reason: 'refusal', content: [] }),
    /declined this request/
  );
  assert.throws(
    () => readStructuredText({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }] }),
    /max_tokens/
  );
  assert.throws(
    () => readStructuredText({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] }),
    /no text block/
  );
});
