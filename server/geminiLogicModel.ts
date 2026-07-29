import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getAiExtractionPrompt, getAiCritiquePrompt } from '../constants';
import { LogicModel } from '../types';
import { parseLogicModelResponse } from '../shared/logicModelValidate';
import { normalizeExtractedLogicModel } from '../shared/extractNormalize';
import { sanitizeAbsentDomainCritiques } from '../shared/domainPresence';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;
const MODEL_ID = 'gemini-2.5-flash';

const baseItemSchema: Schema = {
  type: Type.OBJECT,
  properties: { text: { type: Type.STRING } },
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
    overallQuality: {
      type: Type.OBJECT,
      properties: {
        rating: { type: Type.STRING, enum: ['Strong', 'Adequate', 'Weak'] },
        rationale: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['rating', 'rationale'],
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
  input: string | string[],
  options?: { textHint?: string }
): Promise<LogicModel> {
  const ai = new GoogleGenAI({ apiKey });
  const isVision = Array.isArray(input);
  const prompt = getAiExtractionPrompt(isVision);
  const textHint = options?.textHint?.trim();

  let contents: unknown;
  if (isVision) {
    const parts: unknown[] = [{ text: prompt }];
    if (textHint) {
      parts.push({
        text: `\n\nTEXT-LAYER HINT (use to fill impactStatement when page 1 has a labeled Impact Statement; images remain authoritative for the grid):\n---\n${textHint}\n---`,
      });
    }
    for (const base64Image of input) {
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: base64Image },
      });
    }
    contents = { parts };
  } else {
    contents = [{ text: prompt }, { text: `\n\nDocument Content:\n---\n${input}\n---` }];
  }

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL_ID,
      contents: contents as never,
      config: {
        responseMimeType: 'application/json',
        responseSchema: extractModelSchema,
        temperature: 0.1,
      },
    })
  );

  return normalizeExtractedLogicModel(parseLogicModelResponse(response.text), {
    sourceText: textHint || (typeof input === 'string' ? input : undefined),
  });
}

export async function critiqueLogicModelOnServer(
  apiKey: string,
  model: LogicModel | string
): Promise<LogicModel> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = getAiCritiquePrompt();
  const contents = [
    { text: prompt },
    {
      text: `\n\nLogic Model JSON:\n---\n${typeof model === 'string' ? model : JSON.stringify(model)}\n---`,
    },
  ];

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: MODEL_ID,
      contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: critiqueModelSchema,
        temperature: 0.2,
      },
    })
  );

  return sanitizeAbsentDomainCritiques(
    parseLogicModelResponse(response.text, { requireOverallQuality: true })
  );
}
