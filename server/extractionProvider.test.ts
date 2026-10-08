import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDER_IDS,
  apiKeyFor,
  apiKeyVarFor,
  detectModelIdFor,
  extractModelIdFor,
  extractionProviderId,
} from './extractionProvider.ts';
import { getExtractionProvider } from './extractionProviders.ts';

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

test('the default provider is Gemini — the measured, shipped path', () => {
  withEnv({ LM_EXTRACT_PROVIDER: undefined }, () => {
    assert.equal(extractionProviderId(), 'gemini');
  });
});

test('LM_EXTRACT_PROVIDER selects, case-insensitively, with whitespace trimmed', () => {
  withEnv({ LM_EXTRACT_PROVIDER: 'anthropic' }, () => assert.equal(extractionProviderId(), 'anthropic'));
  withEnv({ LM_EXTRACT_PROVIDER: ' Anthropic ' }, () => assert.equal(extractionProviderId(), 'anthropic'));
  withEnv({ LM_EXTRACT_PROVIDER: 'gemini' }, () => assert.equal(extractionProviderId(), 'gemini'));
});

test('a blank variable means unset, not a provider named ""', () => {
  for (const blank of ['', '   ', '\t']) {
    withEnv({ LM_EXTRACT_PROVIDER: blank }, () =>
      assert.equal(extractionProviderId(), 'gemini', JSON.stringify(blank))
    );
  }
});

/**
 * The same stance `extractThinkingLevel` takes, for the same reason: an experiment that quietly
 * runs the shipped arm and files its numbers under the candidate's name is a worse failure than
 * one that refuses to start.
 */
test('an unrecognised provider throws rather than falling back to the default', () => {
  withEnv({ LM_EXTRACT_PROVIDER: 'openai' }, () => {
    assert.throws(() => extractionProviderId(), /not a provider/);
  });
});

test('the variable is read on every call, not captured at import', () => {
  withEnv({ LM_EXTRACT_PROVIDER: 'anthropic' }, () => assert.equal(extractionProviderId(), 'anthropic'));
  withEnv({ LM_EXTRACT_PROVIDER: 'gemini' }, () => assert.equal(extractionProviderId(), 'gemini'));
});

test('each provider has its own default models', () => {
  withEnv({ LM_EXTRACT_MODEL: undefined, LM_DETECT_MODEL: undefined }, () => {
    assert.equal(extractModelIdFor('gemini'), 'gemini-flash-latest');
    assert.equal(extractModelIdFor('anthropic'), 'claude-opus-5-5');
    assert.equal(detectModelIdFor('gemini'), 'gemini-flash-latest');
    assert.equal(detectModelIdFor('anthropic'), 'claude-haiku-5-5');
  });
});

test('LM_EXTRACT_MODEL overrides whichever provider is in play, and does not drag detection along', () => {
  withEnv({ LM_EXTRACT_MODEL: 'claude-sonnet-5-5', LM_DETECT_MODEL: undefined }, () => {
    assert.equal(extractModelIdFor('anthropic'), 'claude-sonnet-5-5');
    assert.equal(detectModelIdFor('anthropic'), 'claude-haiku-5-5');
  });
});

/**
 * The reason the seam exists at all. Before it, `apiCore` read `GEMINI_API_KEY` by name, so
 * running on another vendor still required the first vendor's key to be present.
 */
test('the key variable follows the provider', () => {
  assert.equal(apiKeyVarFor('gemini'), 'GEMINI_API_KEY');
  assert.equal(apiKeyVarFor('anthropic'), 'ANTHROPIC_API_KEY');
  withEnv({ GEMINI_API_KEY: 'g-key', ANTHROPIC_API_KEY: 'a-key' }, () => {
    assert.equal(apiKeyFor('gemini'), 'g-key');
    assert.equal(apiKeyFor('anthropic'), 'a-key');
  });
  withEnv({ ANTHROPIC_API_KEY: '  spaced  ' }, () => assert.equal(apiKeyFor('anthropic'), 'spaced'));
  withEnv({ ANTHROPIC_API_KEY: undefined }, () => assert.equal(apiKeyFor('anthropic'), ''));
});

test('every provider id resolves to an implementation that reports its own id and key variable', () => {
  for (const id of PROVIDER_IDS) {
    const provider = getExtractionProvider(id);
    assert.equal(provider.id, id);
    assert.equal(provider.apiKeyVar, apiKeyVarFor(id));
    assert.equal(typeof provider.extract, 'function');
    assert.equal(typeof provider.detectLogicModelGroups, 'function');
  }
});

/**
 * Pinned rather than merely documented, because this is the one capability difference that changes
 * what `census` and `regression:check` mean. If a future edit flips Anthropic to `true` without a
 * seed parameter actually existing, two runs that disagree would start reading as a regression.
 */
test('seed support is a per-provider fact, and Anthropic has none', () => {
  assert.equal(getExtractionProvider('gemini').supportsSeed, true);
  assert.equal(getExtractionProvider('anthropic').supportsSeed, false);
});
