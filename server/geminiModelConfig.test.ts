import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_MODEL_IDS,
  detectModelId,
  extractModelId,
  servedModelId,
} from './geminiModelConfig.ts';

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

test('both calls default to the rolling alias', () => {
  withEnv({ LM_EXTRACT_MODEL: undefined, LM_DETECT_MODEL: undefined }, () => {
    assert.equal(extractModelId(), 'gemini-flash-latest');
    assert.equal(detectModelId(), 'gemini-flash-latest');
  });
});

/**
 * The point of the module. Until this existed, trying a candidate model meant editing a const in
 * tracked source and restarting the server, so each question cost a code change and a revert.
 */
test('an environment variable overrides each model independently', () => {
  withEnv({ LM_EXTRACT_MODEL: 'gemini-3.7-flash', LM_DETECT_MODEL: undefined }, () => {
    assert.equal(extractModelId(), 'gemini-3.7-flash');
    assert.equal(detectModelId(), 'gemini-flash-latest', 'detection is not dragged along');
  });
  withEnv({ LM_EXTRACT_MODEL: undefined, LM_DETECT_MODEL: 'gemini-3.8-flash' }, () => {
    assert.equal(extractModelId(), 'gemini-flash-latest');
    assert.equal(detectModelId(), 'gemini-3.8-flash');
  });
});

/**
 * Read at call time, not at module load, or a script that sets the variable after importing
 * anything in this tree would be silently ignored — the sort of thing that costs an afternoon and
 * produces a confidently wrong measurement.
 */
test('the variable is read on every call, not captured at import', () => {
  withEnv({ LM_EXTRACT_MODEL: 'model-a' }, () => assert.equal(extractModelId(), 'model-a'));
  withEnv({ LM_EXTRACT_MODEL: 'model-b' }, () => assert.equal(extractModelId(), 'model-b'));
});

test('a blank or whitespace variable means unset, not a model named ""', () => {
  for (const blank of ['', '   ', '\t']) {
    withEnv({ LM_EXTRACT_MODEL: blank }, () => {
      assert.equal(extractModelId(), 'gemini-flash-latest', JSON.stringify(blank));
    });
  }
  withEnv({ LM_EXTRACT_MODEL: '  gemini-3.7-flash  ' }, () => {
    assert.equal(extractModelId(), 'gemini-3.7-flash', 'and a stray space is trimmed, not fatal');
  });
});

/**
 * `servedModelId` is provenance, and a wrong provenance field is worse than an absent one: it
 * would read as evidence that the alias and the served model agreed. So every shape that is not a
 * usable string returns undefined, and nothing here may throw — a provenance field must not be
 * able to fail an extraction somebody is waiting on.
 */
test('the served model is read from the response, or reported as absent', () => {
  assert.equal(servedModelId({ modelVersion: 'gemini-3.8-flash' }), 'gemini-3.8-flash');
  assert.equal(servedModelId({ modelVersion: '  gemini-3.8-flash ' }), 'gemini-3.8-flash');
  for (const absent of [
    {},
    { modelVersion: '' },
    { modelVersion: '   ' },
    { modelVersion: 7 },
    { modelVersion: null },
    null,
    undefined,
    'a string response',
  ]) {
    assert.equal(servedModelId(absent), undefined, JSON.stringify(absent) ?? 'undefined');
  }
});

test('the candidate list is a non-empty list of distinct ids including the default', () => {
  assert.ok(CANDIDATE_MODEL_IDS.length >= 2, 'a list of one is a pin, which is the thing it avoids');
  assert.equal(new Set(CANDIDATE_MODEL_IDS).size, CANDIDATE_MODEL_IDS.length, 'no duplicates');
  assert.ok(CANDIDATE_MODEL_IDS.includes('gemini-flash-latest'), 'the default is measurable too');
});
