import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getAiExtractionPrompt, getAiCritiquePrompt } from '../constants.js';
import {
  bundleImpliesLowLegibility,
  type DocumentBundle,
  type LogicModel,
} from '../types.js';
import { parseLogicModelResponse } from '../shared/logicModelValidate.js';
import { normalizeExtractedLogicModel } from '../shared/extractNormalize.js';
import { sanitizeAbsentDomainCritiques } from '../shared/domainPresence.js';
import { reconcileProvenance } from '../shared/provenance.js';
import { applyCausalChainGuardrail } from '../shared/causalChain.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
/**
 * Use Google's rolling `-latest` aliases, not a dated snapshot (e.g. `gemini-2.5-flash`) — pinned
 * snapshots get sunset for new API keys/projects (confirmed 2026-09-14: `gemini-2.5-flash` returned
 * 404 "no longer available to new users" on a freshly created key even though it still appeared in
 * the models.list response). The alias resolves forward automatically as Google rotates the
 * recommended model, which is what we actually want for a rarely-touched local tool.
 */
const EXTRACT_MODEL_ID = 'gemini-flash-latest';
/**
 * Ideally a stronger-reasoning tier for qualitative judgment (logic-model theory, causal-chain
 * reasoning, CMO-lens classification) than mechanical transcription needs — see docs/specs
 * assessment (2026-09-14). In practice `gemini-pro-latest` (currently `gemini-3.1-pro`) returns a
 * hard 429 with `limit: 0` on the free tier, so critique stays on the same flash-tier alias as
 * extraction until billing is enabled. Revisit once the account has paid-tier quota.
 */
const CRITIQUE_MODEL_ID = 'gemini-flash-latest';

const baseItemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    verbatim: { type: Type.BOOLEAN },
    sourceNote: { type: Type.STRING },
    fillColor: { type: Type.STRING },
    borderColor: { type: Type.STRING },
    sourcePage: { type: Type.NUMBER },
    sourceColumn: { type: Type.NUMBER },
  },
  required: ['text'],
};

const baseGroupSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    items: { type: Type.ARRAY, items: baseItemSchema },
  },
  required: ['name', 'items'],
};

const baseFieldSchema = (contentType: Type): Schema => ({
  type: Type.OBJECT,
  properties: {
    content:
      contentType === Type.ARRAY
        ? { type: Type.ARRAY, items: baseGroupSchema }
        : { type: Type.STRING },
  },
  required: ['content'],
});

const extractModelSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    organization: { type: Type.STRING },
    program: { type: Type.STRING },
    impactStatement: baseFieldSchema(Type.STRING),
    mission: baseFieldSchema(Type.STRING),
    targetPopulation: baseFieldSchema(Type.STRING),
    inputs: baseFieldSchema(Type.ARRAY),
    activities: baseFieldSchema(Type.ARRAY),
    outputs: baseFieldSchema(Type.ARRAY),
    shortTermOutcomes: baseFieldSchema(Type.ARRAY),
    mediumTermOutcomes: baseFieldSchema(Type.ARRAY),
    longTermOutcomes: baseFieldSchema(Type.ARRAY),
    impact: baseFieldSchema(Type.ARRAY),
    colorLegend: { type: Type.STRING },
    unmapped: baseFieldSchema(Type.ARRAY),
    layoutFamily: {
      type: Type.STRING,
      enum: ['vertical_columns', 'horizontal_rows', 'diagram', 'prose_sections', 'unknown'],
    },
    extractionStatus: {
      type: Type.STRING,
      enum: ['ok', 'partial', 'abstained'],
    },
    extractionConfidence: {
      type: Type.STRING,
      enum: ['high', 'medium', 'low'],
    },
    extractionBlockers: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    'organization',
    'program',
    'mission',
    'targetPopulation',
    'inputs',
    'activities',
    'outputs',
    'shortTermOutcomes',
    'mediumTermOutcomes',
    'longTermOutcomes',
    'impact',
  ],
};

const critiquedItemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
    critique: { type: Type.STRING },
    rating: { type: Type.STRING, enum: ['Strong', 'Adequate', 'Weak'] },
    verbatim: { type: Type.BOOLEAN },
    sourceNote: { type: Type.STRING },
    fillColor: { type: Type.STRING },
    borderColor: { type: Type.STRING },
    sourcePage: { type: Type.NUMBER },
    sourceColumn: { type: Type.NUMBER },
    causalRole: {
      type: Type.STRING,
      enum: ['outcome', 'mechanism_leak', 'context_leak', 'unclear'],
    },
  },
  required: ['text', 'critique', 'rating'],
};

const critiquedGroupSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    name: { type: Type.STRING },
    items: { type: Type.ARRAY, items: critiquedItemSchema },
  },
  required: ['name', 'items'],
};

const critiquedFieldSchema = (contentType: Type): Schema => ({
  type: Type.OBJECT,
  properties: {
    content:
      contentType === Type.ARRAY
        ? { type: Type.ARRAY, items: critiquedGroupSchema }
        : { type: Type.STRING },
    critique: { type: Type.STRING },
    rating: { type: Type.STRING, enum: ['Strong', 'Adequate', 'Weak'] },
  },
  required: ['content', 'critique', 'rating'],
});

const critiqueModelSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    organization: { type: Type.STRING },
    program: { type: Type.STRING },
    impactStatement: critiquedFieldSchema(Type.STRING),
    mission: critiquedFieldSchema(Type.STRING),
    targetPopulation: critiquedFieldSchema(Type.STRING),
    inputs: critiquedFieldSchema(Type.ARRAY),
    activities: critiquedFieldSchema(Type.ARRAY),
    outputs: critiquedFieldSchema(Type.ARRAY),
    shortTermOutcomes: critiquedFieldSchema(Type.ARRAY),
    mediumTermOutcomes: critiquedFieldSchema(Type.ARRAY),
    longTermOutcomes: critiquedFieldSchema(Type.ARRAY),
    impact: critiquedFieldSchema(Type.ARRAY),
    colorLegend: { type: Type.STRING },
    unmapped: critiquedFieldSchema(Type.ARRAY),
    layoutFamily: {
      type: Type.STRING,
      enum: ['vertical_columns', 'horizontal_rows', 'diagram', 'prose_sections', 'unknown'],
    },
    extractionStatus: {
      type: Type.STRING,
      enum: ['ok', 'partial', 'abstained'],
    },
    extractionConfidence: {
      type: Type.STRING,
      enum: ['high', 'medium', 'low'],
    },
    extractionBlockers: { type: Type.ARRAY, items: { type: Type.STRING } },
    overallQuality: {
      type: Type.OBJECT,
      properties: {
        rating: { type: Type.STRING, enum: ['Strong', 'Adequate', 'Weak'] },
        rationale: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['rating', 'rationale'],
    },
    causalChainAssessment: {
      type: Type.OBJECT,
      properties: {
        coherence: { type: Type.STRING, enum: ['holds', 'weak', 'broken'] },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['coherence', 'evidence'],
    },
  },
  required: [
    'organization',
    'program',
    'mission',
    'targetPopulation',
    'inputs',
    'activities',
    'outputs',
    'shortTermOutcomes',
    'mediumTermOutcomes',
    'longTermOutcomes',
    'impact',
    'overallQuality',
  ],
};

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

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
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

export async function extractLogicModelOnServer(
  apiKey: string,
  bundle: DocumentBundle
): Promise<LogicModel> {
  const ai = new GoogleGenAI({ apiKey });
  const images = Array.isArray(bundle.images) ? bundle.images.filter(Boolean) : [];
  const textTrack = typeof bundle.textTrack === 'string' ? bundle.textTrack.trim() : '';
  const isVision = images.length > 0;
  const lowLegibility = bundleImpliesLowLegibility(bundle);
  const hasTextTrack = textTrack.length > 0;
  const prompt = getAiExtractionPrompt(isVision, { lowLegibility, hasTextTrack });

  let contents: unknown;
  if (isVision) {
    const parts: unknown[] = [{ text: prompt }];
    if (hasTextTrack) {
      parts.push({
        text:
          `\n\nTRACK A — STRUCTURAL TEXT / MARKDOWN (exact strings + hierarchy; fuse with Track B images below):\n` +
          `Use for verbatim wording, headings, lists, and bold/emphasis. Images remain authoritative for ` +
          `column position, fillColor/borderColor, and visual layout.\n---\n${textTrack}\n---`,
      });
    }
    for (let i = 0; i < images.length; i++) {
      const base64Image = images[i];
      const ref = bundle.imageRefs?.[i];
      const label =
        ref && typeof ref.page === 'number'
          ? ref.column != null
            ? `TRACK B image ${i + 1} of ${images.length}: document page ${ref.page}, column ${ref.column} (left→right).`
            : `TRACK B image ${i + 1} of ${images.length}: document page ${ref.page}.`
          : `TRACK B image ${i + 1} of ${images.length}.`;
      parts.push({ text: label });
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: base64Image },
      });
    }
    if (hasTextTrack) {
      parts.push({
        text: '\nTRACK B — The JPEG parts above are page/slide (and optional column-crop) images for visual semantics.',
      });
    }
    contents = { parts };
  } else {
    if (!hasTextTrack) {
      throw new Error('DocumentBundle must include images[] or a non-empty textTrack.');
    }
    contents = [
      { text: prompt },
      {
        text: `\n\nTRACK A — DOCUMENT CONTENT (text-only DocumentBundle):\n---\n${textTrack}\n---`,
      },
    ];
  }

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: EXTRACT_MODEL_ID,
      contents: contents as never,
      config: {
        responseMimeType: 'application/json',
        responseSchema: extractModelSchema,
        temperature: 0.1,
      },
    })
  );

  return normalizeExtractedLogicModel(parseLogicModelResponse(response.text), {
    sourceText: textTrack || undefined,
    lowLegibility,
  });
}

export async function critiqueLogicModelOnServer(
  apiKey: string,
  model: LogicModel | string
): Promise<LogicModel> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = getAiCritiquePrompt();

  // Keep the pre-critique model so provenance/colour fields survive even if the
  // critique response drops those optional properties.
  let sourceModel: LogicModel | undefined;
  if (typeof model === 'string') {
    try {
      sourceModel = JSON.parse(model) as LogicModel;
    } catch {
      sourceModel = undefined;
    }
  } else {
    sourceModel = model;
  }

  const contents = [
    { text: prompt },
    {
      text: `\n\nLogic Model JSON:\n---\n${typeof model === 'string' ? model : JSON.stringify(model)}\n---`,
    },
  ];

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: CRITIQUE_MODEL_ID,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: critiqueModelSchema,
        temperature: 0.2,
      },
    })
  );

  const critiqued = parseLogicModelResponse(response.text, { requireOverallQuality: true });
  if (sourceModel) reconcileProvenance(critiqued, sourceModel);
  const sanitized = sanitizeAbsentDomainCritiques(critiqued);
  return applyCausalChainGuardrail(sanitized);
}
