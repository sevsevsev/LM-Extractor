import type { LogicModel } from '../types';
import { critiqueLogicModelOnServer, extractLogicModelOnServer } from './geminiLogicModel';

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export function getApiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

/** Vercel parses JSON bodies, but local/edge cases can still hand us a raw string. */
export function parseJsonBody(body: unknown): Record<string, unknown> {
  if (body == null) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof body === 'object') return body as Record<string, unknown>;
  return {};
}

function missingKeyResult(): ApiResult {
  return {
    status: 500,
    body: { error: 'Server is missing GEMINI_API_KEY. Set it in the hosting environment variables.' },
  };
}

function errorResult(error: unknown): ApiResult {
  const message = error instanceof Error ? error.message : 'Unknown server error';
  return { status: 500, body: { error: message } };
}

export async function handleExtractRequest(rawBody: unknown): Promise<ApiResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyResult();

  try {
    const { images, text, textHint } = parseJsonBody(rawBody) as {
      images?: string[];
      text?: string;
      textHint?: string;
    };

    if (Array.isArray(images) && images.length > 0) {
      const model = await extractLogicModelOnServer(apiKey, images, {
        textHint: typeof textHint === 'string' ? textHint : undefined,
      });
      return { status: 200, body: { model } };
    }

    if (typeof text === 'string' && text.trim()) {
      const model = await extractLogicModelOnServer(apiKey, text);
      return { status: 200, body: { model } };
    }

    return { status: 400, body: { error: 'Request must include images[] or text.' } };
  } catch (error) {
    return errorResult(error);
  }
}

export async function handleCritiqueRequest(rawBody: unknown): Promise<ApiResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyResult();

  try {
    const { model } = parseJsonBody(rawBody) as { model?: LogicModel | string };
    if (model == null) {
      return { status: 400, body: { error: 'Request must include model.' } };
    }

    const result = await critiqueLogicModelOnServer(apiKey, model);
    return { status: 200, body: { model: result } };
  } catch (error) {
    return errorResult(error);
  }
}
