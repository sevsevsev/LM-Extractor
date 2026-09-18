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

/** Shared retry/backoff for any Gemini server call — extract, and the detect-logic-models pre-pass. */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!(attempt < MAX_RETRIES && isTransientError(error))) throw error;
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }
  throw lastError;
}
