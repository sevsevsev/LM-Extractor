import type { DetectLogicModelGroupsInput, DocumentBundle, SourceImageRef } from '../types';
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

const SOURCE_FORMATS: readonly DocumentBundle['sourceFormat'][] = [
  'pdf',
  'docx',
  'pptx',
  'image',
  'xlsx',
];

function isSourceFormat(value: unknown): value is DocumentBundle['sourceFormat'] {
  return typeof value === 'string' && (SOURCE_FORMATS as readonly string[]).includes(value);
}

/**
 * One `imageRefs` entry: the document page (and optional column) a Track B JPEG came from.
 * Pages/columns are 1-based integers — a fractional or zero page would produce a nonsense label.
 */
function isSourceImageRef(value: unknown): value is SourceImageRef {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const pageOk = typeof r.page === 'number' && Number.isInteger(r.page) && r.page >= 1;
  const columnOk =
    r.column === undefined ||
    (typeof r.column === 'number' && Number.isInteger(r.column) && r.column >= 1);
  return pageOk && columnOk;
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
    // Parallel to `images` by position (see DocumentBundle.imageRefs) — labels each Track B image
    // with its real document page/column so Gemini's SOURCE LOCATION prompt instructions have a
    // real label to read from. Only accepted whole (not entry-by-entry repaired): a partially
    // invalid array would silently misalign `imageRefs[i]` with `images[i]` for every index after
    // the bad entry, which is worse than falling back to the no-label default.
    const imageRefs =
      Array.isArray(body.imageRefs) &&
      body.imageRefs.length === images.length &&
      images.length > 0 &&
      body.imageRefs.every(isSourceImageRef)
        ? (body.imageRefs as SourceImageRef[])
        : undefined;
    if (images.length === 0 && !textTrack.trim()) return null;
    return {
      images,
      imageRefs,
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
