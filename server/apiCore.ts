import type { DocumentBundle } from '../types';
import { extractLogicModelOnServer } from './geminiLogicModel.js';

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

function isSourceFormat(value: unknown): value is DocumentBundle['sourceFormat'] {
  return value === 'pdf' || value === 'docx' || value === 'pptx';
}

/** Normalize request body into a DocumentBundle (dual-track extract contract). */
export function parseDocumentBundle(rawBody: unknown): DocumentBundle | null {
  const body = parseJsonBody(rawBody);

  // Preferred: full DocumentBundle
  if (isSourceFormat(body.sourceFormat)) {
    const images = Array.isArray(body.images)
      ? body.images.filter((img): img is string => typeof img === 'string' && img.length > 0)
      : [];
    const textTrack = typeof body.textTrack === 'string' ? body.textTrack : '';
    const warnings = Array.isArray(body.warnings)
      ? body.warnings.filter((w): w is string => typeof w === 'string')
      : [];
    if (images.length === 0 && !textTrack.trim()) return null;
    return {
      images,
      textTrack,
      warnings,
      sourceFormat: body.sourceFormat,
    };
  }

  return null;
}

export async function handleExtractRequest(rawBody: unknown): Promise<ApiResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyResult();

  try {
    const bundle = parseDocumentBundle(rawBody);
    if (!bundle) {
      return {
        status: 400,
        body: {
          error:
            'Request must include a DocumentBundle with sourceFormat and images[] and/or textTrack.',
        },
      };
    }

    const model = await extractLogicModelOnServer(apiKey, bundle);
    return { status: 200, body: { model } };
  } catch (error) {
    return errorResult(error);
  }
}
