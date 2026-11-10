import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ModelCallTimeoutError,
  callTimeoutMs,
  DEFAULT_CALL_TIMEOUT_MS,
  HOSTED_CALL_TIMEOUT_MS,
  withRetry,
} from './geminiRetry.ts';
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

/**
 * The 504 report of 2026-11-10. The budget used to be PER ATTEMPT, so four transient failures
 * could spend four full budgets. Hosted, that outlives the 60s function cap several times over
 * and the operator sees the platform's bodiless gateway page instead of our sentence.
 */
test('the budget covers the whole call, not each attempt', async () => {
  let calls = 0;
  const startedAt = Date.now();
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 40));
        throw Object.assign(new Error('unavailable'), { status: 503 });
      },
      { timeoutMs: 120 }
    ),
    (error: unknown) => error instanceof ModelCallTimeoutError && error.timeoutMs === 120
  );
  assert.ok(Date.now() - startedAt < 400, 'whole call stayed near its budget');
  assert.ok(calls >= 1 && calls <= 4);
});

test('a retry that cannot outlast its own backoff is not started', async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 30));
        throw Object.assign(new Error('unavailable'), { status: 503 });
      },
      { timeoutMs: 35 }
    ),
    (error: unknown) => error instanceof ModelCallTimeoutError
  );
  assert.equal(calls, 1);
});

test('the attempt that runs out of time is aborted, not left running', async () => {
  let aborted = false;
  await assert.rejects(
    withRetry(
      signal =>
        new Promise(() => {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }),
      { timeoutMs: 20 }
    ),
    (error: unknown) => error instanceof ModelCallTimeoutError
  );
  assert.equal(aborted, true);
});

/**
 * Hosted, `vercel.json` caps the function at 60s, so a 150s guard can never fire: the platform
 * kills the invocation first and answers with HTML the browser cannot read. The hosted default
 * must sit below that cap.
 */
test('the hosted default sits below the 60s function cap', () => {
  const savedVercel = process.env.VERCEL;
  const savedOverride = process.env.LM_MODEL_CALL_TIMEOUT_MS;
  try {
    delete process.env.LM_MODEL_CALL_TIMEOUT_MS;
    process.env.VERCEL = '1';
    assert.equal(callTimeoutMs(), HOSTED_CALL_TIMEOUT_MS);
    assert.ok(HOSTED_CALL_TIMEOUT_MS < 60_000);
    // The override still wins, and a bad value still falls back to the hosted default.
    process.env.LM_MODEL_CALL_TIMEOUT_MS = '30000';
    assert.equal(callTimeoutMs(), 30_000);
    process.env.LM_MODEL_CALL_TIMEOUT_MS = 'never';
    assert.equal(callTimeoutMs(), HOSTED_CALL_TIMEOUT_MS);
    delete process.env.VERCEL;
    delete process.env.LM_MODEL_CALL_TIMEOUT_MS;
    assert.equal(callTimeoutMs(), DEFAULT_CALL_TIMEOUT_MS);
  } finally {
    if (savedVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = savedVercel;
    if (savedOverride === undefined) delete process.env.LM_MODEL_CALL_TIMEOUT_MS;
    else process.env.LM_MODEL_CALL_TIMEOUT_MS = savedOverride;
  }
});
