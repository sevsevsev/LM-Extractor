import type { DetectLogicModelGroupsInput, DocumentBundle } from '../types';
import { extractLogicModelOnServer } from './geminiLogicModel.js';
import { detectLogicModelGroupsOnServer } from './geminiLogicModelGroups.js';

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

/**
 * Parse the client's `imageRefs` (document page / column for each extract JPEG).
 *
 * `server/geminiLogicModel.ts` labels each Track B image with its real page/column from this, and
 * the extraction prompt's SOURCE LOCATION rules tell the model to read `sourcePage` off that
 * label. This parser used to drop the field entirely, so the labels degraded to bare ordinals
 * ("TRACK B image 1 of 2") and every `sourcePage` the model returned was a guess — which then fed
 * the source-review page jump and the spot-check chips. Returns undefined unless the array is
 * well-formed AND parallel to `images`, since a misaligned ref is worse than none.
 */
function parseImageRefs(raw: unknown, imageCount: number): DocumentBundle['imageRefs'] {
  if (!Array.isArray(raw) || raw.length !== imageCount || imageCount === 0) return undefined;
  const refs: NonNullable<DocumentBundle['imageRefs']> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return undefined;
    const rec = entry as Record<string, unknown>;
    const page = rec.page;
    if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) return undefined;
    const column = rec.column;
    const hasColumn = typeof column === 'number' && Number.isFinite(column) && column >= 1;
    refs.push(hasColumn ? { page: Math.round(page), column: Math.round(column) } : { page: Math.round(page) });
  }
  return refs;
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
      imageRefs: parseImageRefs(body.imageRefs, images.length),
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

    const { model, promptVersion, promptVariant } = await extractLogicModelOnServer(apiKey, bundle);
    return { status: 200, body: { model, promptVersion, promptVariant } };
  } catch (error) {
    return errorResult(error);
  }
}

/** Narrower than `parseDocumentBundle` — only needs `previewImages` (whole pages), not Track B. */
export function parseDetectLogicModelGroupsInput(rawBody: unknown): DetectLogicModelGroupsInput | null {
  const body = parseJsonBody(rawBody);
  if (!isSourceFormat(body.sourceFormat)) return null;
  const previewImages = Array.isArray(body.previewImages)
    ? body.previewImages.filter((img): img is string => typeof img === 'string' && img.length > 0)
    : [];
  if (previewImages.length === 0) return null;
  const textTrack = typeof body.textTrack === 'string' ? body.textTrack : '';
  return { previewImages, textTrack, sourceFormat: body.sourceFormat };
}

export async function handleDetectLogicModelGroupsRequest(rawBody: unknown): Promise<ApiResult> {
  const apiKey = getApiKey();
  if (!apiKey) return missingKeyResult();

  try {
    const input = parseDetectLogicModelGroupsInput(rawBody);
    if (!input) {
      return {
        status: 400,
        body: { error: 'Request must include sourceFormat and a non-empty previewImages[].' },
      };
    }

    const groups = await detectLogicModelGroupsOnServer(apiKey, input);
    return { status: 200, body: { groups } };
  } catch (error) {
    return errorResult(error);
  }
}
