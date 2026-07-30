import { LogicModel } from '../types';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        model?: LogicModel;
        error?: string;
      };

      if (!response.ok) {
        const message = payload.error || `Request failed (${response.status})`;
        if (attempt < MAX_RETRIES && isTransientHttpStatus(response.status)) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(message);
      }

      if (!payload.model) {
        throw new Error('Server response missing logic model.');
      }
      return payload as T;
    } catch (error) {
      lastError = error;
      const retryable =
        attempt < MAX_RETRIES &&
        (error instanceof TypeError ||
          (error instanceof Error && /failed to fetch|network/i.test(error.message)));
      if (!retryable) throw error;
      await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemini request failed.');
}

export const extractLogicModel = async (
  input: string | string[],
  options?: { textHint?: string; lowLegibility?: boolean }
): Promise<LogicModel> => {
  const body = Array.isArray(input)
    ? { images: input, textHint: options?.textHint, lowLegibility: options?.lowLegibility }
    : { text: input };
  const data = await postJson<{ model: LogicModel }>('/api/gemini/extract', body);
  return data.model;
};

export const critiqueLogicModel = async (model: LogicModel | string): Promise<LogicModel> => {
  const data = await postJson<{ model: LogicModel }>('/api/gemini/critique', { model });
  return data.model;
};
