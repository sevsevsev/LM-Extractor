import { DetectLogicModelGroupsInput, DocumentBundle, LogicModel, LogicModelPageGroup } from '../types';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function postJson<T extends { error?: string }>(url: string, body: unknown): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as T;

      if (!response.ok) {
        const message = payload.error || `Request failed (${response.status})`;
        if (attempt < MAX_RETRIES && isTransientHttpStatus(response.status)) {
          await sleep(BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw new Error(message);
      }

      return payload;
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

export const extractLogicModel = async (bundle: DocumentBundle): Promise<LogicModel> => {
  const data = await postJson<{ model?: LogicModel; error?: string }>('/api/gemini/extract', bundle);
  if (!data.model) throw new Error('Server response missing logic model.');
  return data.model;
};

/**
 * Cheap pre-pass deciding whether an upload contains one logic model or several — see
 * docs/specs/multi-logic-model-pdf-v1.md. Never throws for the caller to treat as "must split";
 * the server already falls back to a single whole-document group on any detection failure, so a
 * network error here should surface like any other extraction-path failure, not silently.
 */
export const detectLogicModelGroups = async (
  input: DetectLogicModelGroupsInput
): Promise<LogicModelPageGroup[]> => {
  const data = await postJson<{ groups?: LogicModelPageGroup[]; error?: string }>(
    '/api/gemini/detect-logic-models',
    input
  );
  return data.groups ?? [{ startPage: 1, endPage: Math.max(1, input.previewImages.length) }];
};
