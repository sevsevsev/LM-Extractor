const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const err = error as Record<string, unknown>;
  if (typeof err.status === 'number') return err.status;
  if (typeof err.code === 'number') return err.code;
  const response = err.response as Record<string, unknown> | undefined;
  if (response && typeof response.status === 'number') return response.status;
  const errorObj = err.error as Record<string, unknown> | undefined;
  if (errorObj && typeof errorObj.code === 'number') return errorObj.code;
  return undefined;
}

function isTransientError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
    return true;
  }
  if (error instanceof TypeError) return true;
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
    const name = typeof err.name === 'string' ? err.name.toLowerCase() : '';
    if (
      name.includes('network') ||
      message.includes('network') ||
      message.includes('fetch failed') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * How long one model call may take before it is abandoned.
 *
 * WHY. Until 2026-10-08 nothing bounded a call: locally the operator's file simply spun. Two
 * separate prompt experiments that day each produced a call that never answered — a trimmed prompt
 * on `terse-activity-labels` (past five minutes, twice) and a restructured one on
 * `plain-five-column` (five observations, up to 300s, no response and no server error) — while the
 * shipped prompt answers every benchmark deck in under 15s. Neither hang was diagnosed. A guard is
 * cheaper than a diagnosis and protects against the next one.
 *
 * 150s is roughly ten times the slowest benchmark answer, so a slow real document is not cut off.
 * That is the LOCAL budget, where nothing else bounds the call.
 *
 * HOSTED IS DIFFERENT, AND THAT IS WHAT PRODUCED THE "Request failed (504)" REPORT OF 2026-11-10.
 * `vercel.json` gives every `api/gemini/*` function `maxDuration: 60`, and 60s is the plan
 * ceiling, not a setting. A 150s guard can therefore NEVER fire on the hosted deploy: the
 * platform kills the invocation at 60s first and answers with its own HTML gateway page, which
 * carries no JSON, so the browser falls back to the bare status line `Request failed (504)` and
 * the operator learns nothing about what went wrong. Worse, both the browser and the server
 * retried, so one slow document spent four invocations of roughly a minute each, all of them
 * ending the same way, while holding one of the two batch slots.
 *
 * So on the hosted deploy the budget is set BELOW the platform cap. The function then answers
 * for itself — a readable sentence with `code: 'model_timeout'` — instead of being killed
 * mid-call. 50s leaves ~10s of the 60s for the request body, the response and startup overhead.
 *
 * `LM_MODEL_CALL_TIMEOUT_MS` overrides either default; an unusable value falls back to the
 * default rather than disabling the guard.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 150_000;

/** Below `vercel.json`'s `maxDuration: 60`, so our own error beats the platform's 504. */
export const HOSTED_CALL_TIMEOUT_MS = 50_000;

/** True on Vercel, where the function cap applies. `VERCEL` is set by the platform itself. */
function isHosted(): boolean {
  return Boolean(process.env.VERCEL);
}

export function callTimeoutMs(): number {
  const fallback = isHosted() ? HOSTED_CALL_TIMEOUT_MS : DEFAULT_CALL_TIMEOUT_MS;
  const raw = Number(process.env.LM_MODEL_CALL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/**
 * A call that ran out of time. NEVER retried: with a content-derived seed, both hangs above
 * reproduced on every attempt, so a retry would only multiply the operator's wait by four. The
 * message is written for the operator and is passed through unchanged by `friendlyError`.
 */
export class ModelCallTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(
      `The AI did not answer this document within ${Math.round(timeoutMs / 1000)} seconds, so the ` +
        'extraction was stopped. Trying again usually stops at the same point for the same document.'
    );
    this.name = 'ModelCallTimeoutError';
  }
}

/**
 * Races one attempt against the time it has left. `budgetMs` is what is reported to the operator
 * (the whole call's budget); `remainingMs` is what this attempt actually gets. `onExpire` aborts
 * the in-flight request, so an abandoned call stops costing the function its remaining time
 * instead of running on unobserved until the platform kills the invocation.
 */
function withDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
  budgetMs: number,
  onExpire: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onExpire();
      reject(new ModelCallTimeoutError(budgetMs));
    }, Math.max(0, remainingMs));
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Shared retry/backoff for any Gemini server call — extract, and the detect-logic-models pre-pass.
 *
 * THE BUDGET COVERS THE WHOLE CALL, NOT EACH ATTEMPT. It used to be per attempt, so four
 * transient failures could spend four full budgets; hosted, that is four times the function cap
 * and the invocation dies without ever answering. Now the deadline is measured from the first
 * attempt, a retry that cannot even outlast its own backoff is not started, and the abort signal
 * handed to `fn` stops the request that ran out of time.
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options?: { timeoutMs?: number }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? callTimeoutMs();
  const startedAt = Date.now();
  const remaining = () => timeoutMs - (Date.now() - startedAt);
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    try {
      return await withDeadline(fn(controller.signal), remaining(), timeoutMs, () =>
        controller.abort()
      );
    } catch (error) {
      lastError = error;
      if (error instanceof ModelCallTimeoutError) throw error;
      if (!(attempt < MAX_RETRIES && isTransientError(error))) throw error;
      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      // Sleeping through the rest of the budget only to start an attempt with no time left
      // produces the same timeout a minute later. Report it now.
      if (remaining() <= delay) throw new ModelCallTimeoutError(timeoutMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
