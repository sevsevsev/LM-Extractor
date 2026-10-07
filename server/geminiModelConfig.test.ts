import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_MODEL_IDS,
  THINKING_LEVELS,
  detectModelId,
  extractModelId,
  extractThinkingLevel,
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

test('no thinking level is sent unless an experiment asks for one', () => {
  // The shipped default, and a measured decision: `thinkingLevel: LOW` scored the invented
  // benchmark at 100% and cost two real documents accuracy (PR #36, reverted by #37).
  withEnv({ LM_EXTRACT_THINKING_LEVEL: undefined }, () => assert.equal(extractThinkingLevel(), null));
  for (const explicit of ['default', 'none', 'unset', 'DEFAULT']) {
    withEnv({ LM_EXTRACT_THINKING_LEVEL: explicit }, () =>
      assert.equal(extractThinkingLevel(), null, explicit)
    );
  }
});

test('each thinking level is selectable, case-insensitively', () => {
  for (const level of THINKING_LEVELS) {
    withEnv({ LM_EXTRACT_THINKING_LEVEL: level }, () => assert.equal(extractThinkingLevel(), level));
    withEnv({ LM_EXTRACT_THINKING_LEVEL: level.toUpperCase() }, () =>
      assert.equal(extractThinkingLevel(), level, level.toUpperCase())
    );
  }
});

/**
 * The failure this prevents is not a crash, it is a confidently mislabelled measurement: an
 * experiment that silently runs the default and files its numbers under the candidate's name.
 */
test('an unrecognised thinking level throws instead of quietly running the default', () => {
  for (const bad of ['lowish', 'off', 'LOWEST', '0', '-1']) {
    withEnv({ LM_EXTRACT_THINKING_LEVEL: bad }, () => {
      assert.throws(() => extractThinkingLevel(), /is not a thinking level/, bad);
    });
  }
  // And the message names the way out, so nobody has to read the source to recover.
  withEnv({ LM_EXTRACT_THINKING_LEVEL: 'lowish' }, () => {
    assert.throws(() => extractThinkingLevel(), /minimal, low, medium, high/);
    assert.throws(() => extractThinkingLevel(), /"default"/);
  });
});
