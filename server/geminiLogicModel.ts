import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

/**
 * Every property here is a QUESTION PUT TO GEMINI. A field listed in this schema but left
 * undefined by the prompt still gets answered — on the model's own recognisance, with no
 * instruction to answer it against.
 *
 * `verbatim` and `sourceNote` were exactly that from PROMPT_VERSION 2026-09-20.2 (which removed
 * every instruction defining them, after measuring item-level flagging firing about once in 640
 * items) until friction-log session 20. They stayed in this schema, so the model kept answering,
 * and `shared/extractionFidelity.ts` kept feeding the answer into the ratio that can drive
 * `extractionConfidence` to `low` — which since session 12 means the extraction is discarded.
 * It never fired only because the model happened to answer `true` on 100% of items measured; that
 * was luck, not a guarantee. It is the same hazard that got PROMPT_VERSION 2026-09-19.3 withdrawn
 * unrun, reached from the other side: the definition was removed and the consumer left wired up.
 *
 * Both are now gone from here. `verbatim` survives on `LogicModelItem` as a HUMAN-SET field —
 * `LogicModelBoard` sets it to `true` when an operator edits an item — so reinstating item-level
 * flagging is a prompt instruction plus a line here, not a schema rebuild.
 *
 * `geminiLogicModel.test.ts` asserts that every property below is defined in the built prompt.
 */
const baseItemSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    text: { type: Type.STRING },
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

/**
 * Write the pre-normalization model to `$LM_DUMP_RAW` when that env var names a directory.
 *
 * Off unless the variable is set, and it never touches the response, so a deployment that does not
 * set it runs exactly as before. Named by seed because `deriveGeminiSeed` is content-derived and
 * therefore stable per document across runs — the same document overwrites its own dump rather
 * than accumulating copies. A failure here is swallowed: a diagnostic must never fail an
 * extraction a user is waiting on.
 */
function dumpRawModel(seed: number, raw: LogicModel, options: Record<string, unknown>): void {
  const dir = process.env.LM_DUMP_RAW;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${seed}.raw.json`),
      JSON.stringify({ seed, promptVersion: PROMPT_VERSION, options, raw }, null, 2)
    );
  } catch (error) {
    console.warn(`LM_DUMP_RAW: could not write dump for seed ${seed}:`, (error as Error).message);
  }
}

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

  const raw = parseLogicModelResponse(response.text);
  const normalizeOptions = {
    sourceText: textTrack || undefined,
    lowLegibility,
    textOnlyFallback: !isVision,
  };
  // Capture the seam between Gemini's answer and our post-processing, when asked to. This is the
  // input the offline replay harness needs: normalization is a pure function of these two values,
  // so one saved pair turns every later post-processing experiment into a free, deterministic
  // diff instead of another paid extract call. See scripts/normalize-replay.ts.
  dumpRawModel(seed, raw, normalizeOptions);
  const model = normalizeExtractedLogicModel(raw, normalizeOptions);

  return {
    model,
    promptVersion: PROMPT_VERSION,
    promptVariant: promptVariantLabel({ isVision, hasTextTrack, lowLegibility }),
  };
}
