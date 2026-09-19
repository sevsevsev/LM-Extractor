import { GoogleGenAI, Type, Schema } from '@google/genai';
import { PROMPT_VERSION, getAiExtractionPrompt, promptVariantLabel } from '../constants.js';
import {
  bundleImpliesLowLegibility,
  type DocumentBundle,
  type LogicModel,
} from '../types.js';
import { parseLogicModelResponse } from '../shared/logicModelValidate.js';
import { normalizeExtractedLogicModel } from '../shared/extractNormalize.js';
import { withRetry } from './geminiRetry.js';
import { deriveGeminiSeed } from './geminiSeed.js';

/**
 * Use Google's rolling `-latest` aliases, not a dated snapshot (e.g. `gemini-2.5-flash`) — pinned
 * snapshots get sunset for new API keys/projects (confirmed 2026-09-14: `gemini-2.5-flash` returned
 * 404 "no longer available to new users" on a freshly created key even though it still appeared in
 * the models.list response). The alias resolves forward automatically as Google rotates the
 * recommended model, which is what we actually want for a rarely-touched local tool.
 */
const EXTRACT_MODEL_ID = 'gemini-flash-latest';

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
    generalOutcomes: baseFieldSchema(Type.ARRAY),
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
    documentTypeAssessment: {
      type: Type.STRING,
      enum: ['logic_model', 'not_logic_model', 'unclear'],
    },
    documentTypeNote: { type: Type.STRING },
    possiblyMissedRegions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          page: { type: Type.NUMBER },
          xStart: { type: Type.NUMBER },
          xEnd: { type: Type.NUMBER },
          note: { type: Type.STRING },
        },
        required: ['page'],
      },
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
    // The prompt's DOCUMENT TYPE CHECK section calls this "REQUIRED — DO THIS FIRST", but structured
    // output only actually enforces what's schema-required — found via a real document (a narrative
    // program brochure) that got the call silently skipped instead, leaving the field undefined
    // rather than the intended "not_logic_model" flag.
    'documentTypeAssessment',
    // Same bug class, sibling field: constants.ts's EXTRACTION FIDELITY STATUS section also calls
    // this "REQUIRED", but it wasn't schema-required either — found via codebase audit. Missing
    // `extractionStatus` silently defaults to 'ok' in `reconcileExtractionFidelity`
    // (shared/extractionFidelity.ts), which skips the entire abstain-handling branch: a document
    // Gemini tried to abstain on would present as a high-confidence success instead.
    'extractionStatus',
  ],
};

export interface ServerExtractResult {
  model: LogicModel;
  /** Exact prompt wording version that produced `model` — see `PROMPT_VERSION` in constants.ts. */
  promptVersion: string;
  /**
   * Which of the prompt's variants this document actually received. Reported by the server rather
   * than re-derived on the client, so the extraction log records what was really sent.
   */
  promptVariant: string;
}

export async function extractLogicModelOnServer(
  apiKey: string,
  bundle: DocumentBundle
): Promise<ServerExtractResult> {
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

  // Document content only — deliberately NOT the prompt, so that two PROMPT_VERSIONs run against
  // the same document share a seed and the comparison between them is paired. See geminiSeed.ts.
  const seed = deriveGeminiSeed([textTrack, ...images]);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: EXTRACT_MODEL_ID,
      contents: contents as never,
      config: {
        responseMimeType: 'application/json',
        responseSchema: extractModelSchema,
        temperature: 0,
        seed,
      },
    })
  );

  const model = normalizeExtractedLogicModel(parseLogicModelResponse(response.text), {
    sourceText: textTrack || undefined,
    lowLegibility,
    textOnlyFallback: !isVision,
  });

  return {
    model,
    promptVersion: PROMPT_VERSION,
    promptVariant: promptVariantLabel({ isVision, hasTextTrack, lowLegibility }),
  };
}
