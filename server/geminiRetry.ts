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
 * The hosted deploy is already capped at 60s by `vercel.json`; this matters most for local use,
 * which is the primary one. `LM_MODEL_CALL_TIMEOUT_MS` overrides it; an unusable value falls back
 * to the default rather than disabling the guard.
 */
export const DEFAULT_CALL_TIMEOUT_MS = 150_000;

export function callTimeoutMs(): number {
  const raw = Number(process.env.LM_MODEL_CALL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CALL_TIMEOUT_MS;
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

function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ModelCallTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Shared retry/backoff for any Gemini server call — extract, and the detect-logic-models pre-pass. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { timeoutMs?: number }
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? callTimeoutMs();
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await withDeadline(fn(), timeoutMs);
    } catch (error) {
      lastError = error;
      if (error instanceof ModelCallTimeoutError) throw error;
      if (!(attempt < MAX_RETRIES && isTransientError(error))) throw error;
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }
  throw lastError;
}
