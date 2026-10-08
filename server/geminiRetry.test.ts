import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelCallTimeoutError, callTimeoutMs, DEFAULT_CALL_TIMEOUT_MS, withRetry } from './geminiRetry.ts';
import { friendlyError } from '../shared/friendlyError.ts';

test('a call that never answers is stopped at the deadline, and is not retried', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(() => {
      calls++;
      return new Promise(() => {});
    }, { timeoutMs: 20 }),
    (error: unknown) => error instanceof ModelCallTimeoutError && error.timeoutMs === 20
  );
  assert.equal(calls, 1);
});

test('a call that answers in time is returned unchanged', async () => {
  assert.equal(await withRetry(async () => 'ok', { timeoutMs: 1000 }), 'ok');
});

test('a transient failure is still retried under the deadline', async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('unavailable'), { status: 503 });
    return 'second';
  }, { timeoutMs: 1000 });
  assert.equal(result, 'second');
  assert.equal(calls, 2);
});

test('the timeout message reaches the operator as written', () => {
  const error = new ModelCallTimeoutError(150_000);
  assert.equal(friendlyError(error), error.message);
  assert.match(error.message, /150 seconds/);
});

test('LM_MODEL_CALL_TIMEOUT_MS overrides the default, and a bad value cannot disable the guard', () => {
  const saved = process.env.LM_MODEL_CALL_TIMEOUT_MS;
  try {
    delete process.env.LM_MODEL_CALL_TIMEOUT_MS;
    assert.equal(callTimeoutMs(), DEFAULT_CALL_TIMEOUT_MS);
    process.env.LM_MODEL_CALL_TIMEOUT_MS = '90000';
    assert.equal(callTimeoutMs(), 90_000);
    for (const bad of ['0', '-5', 'never', '']) {
      process.env.LM_MODEL_CALL_TIMEOUT_MS = bad;
      assert.equal(callTimeoutMs(), DEFAULT_CALL_TIMEOUT_MS);
    }
  } finally {
    if (saved === undefined) delete process.env.LM_MODEL_CALL_TIMEOUT_MS;
    else process.env.LM_MODEL_CALL_TIMEOUT_MS = saved;
  }
});
