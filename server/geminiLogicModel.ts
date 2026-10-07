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
import { extractModelId, servedModelId } from './geminiModelConfig.js';

/**
 * Which model answers, and why the default is a rolling alias, now live in
 * `server/geminiModelConfig.ts` so that neither is a hardcoded string in this file. Re-exported
 * here because the extraction log and the raw dump both record it.
 */
export { extractModelId } from './geminiModelConfig.js';

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
function dumpRawModel(
  seed: number,
  raw: LogicModel,
  options: Record<string, unknown>,
  served: string | undefined
): void {
  const dir = process.env.LM_DUMP_RAW;
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${seed}.raw.json`),
      JSON.stringify(
        {
          seed,
          promptVersion: PROMPT_VERSION,
          modelId: extractModelId(),
          // What actually answered, which is the only field that survives a silent roll.
          servedModelId: served ?? 'unknown',
          options,
          raw,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.warn(`LM_DUMP_RAW: could not write dump for seed ${seed}:`, (error as Error).message);
  }
}

export interface ServerExtractResult {
  model: LogicModel;
  /**
   * What we ASKED for — the configured model id, usually a rolling alias. See
   * `server/geminiModelConfig.ts`.
   */
  modelId: string;
  /**
   * What ANSWERED, as reported by `response.modelVersion`, or `undefined` when the response did
   * not say.
   *
   * The two differ whenever `modelId` is an alias, and the difference is the whole point. A
   * rolling alias means Google can rotate the served model with no change on our side; recording
   * only the alias is what let the 2026-10-07 roll to `gemini-3.8-flash` go unnoticed until an
   * accuracy shift was blamed on our own diff. Never inferred and never defaulted to the alias: a
   * caller that cannot read this writes "unknown", because a wrong provenance field is worse than
   * an absent one.
   */
  servedModelId?: string;
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
      model: extractModelId(),
      contents: contents as never,
      config: {
        responseMimeType: 'application/json',
        responseSchema: extractModelSchema,
        // No `temperature`/`topP`/`topK`: Google deprecated them. Newer Gemini models ignore
        // them, and future ones return 400. Determinism now rests on `seed` alone, which is still
        // a supported GenerationConfig field.
        seed,
        // NO `thinkingConfig` HERE, AND DO NOT ADD ONE WITHOUT RUNNING THE REGRESSION SET.
        // The configured model is a rolling alias that now resolves to `gemini-3.8-flash`, whose
        // thinking default is Medium. That default collapses two of the fifteen BENCHMARK
        // documents to a single item, and `thinkingLevel: LOW` scores the whole invented set at
        // 100%, so LOW was shipped in PR #36 on that evidence. It was wrong.
        //
        // Measured 2026-10-07 on real documents, paired arms on the same PROMPT_VERSION
        // (2026-09-28.3), same bundles, two runs per arm, every run identical within its arm:
        //   - `seamaac` Activities: word counts 1,1,1,1,3,4,4,4,4,5 without the level, four of
        //     them single words, 19 chars average. With LOW: ZERO labels of two words or fewer,
        //     44 chars average. Item count 33 either way, so no count-based check can see it.
        //     That is precisely the failure `seamaac`'s `covers` field exists to guard.
        //   - `philadelphia-ballet-lets-dance` unmapped: 38 without the level, 27 with it.
        //
        // The invented decks contain no single-word-label case and no narrative
        // not-a-logic-model case, so neither failure could appear there. The benchmark was not
        // wrong, it was blind — which is why a generation-config change needs the regression set
        // before it merges, not after. `MINIMAL` is not an escape: this model rejects it with
        // 400 "Thinking level MINIMAL is not supported for this model" (tested, not inferred),
        // and `high` collapses the benchmark the same way Medium does.
        //
        // So the Medium default stands, and the benchmark collapse is open rather than fixed. It
        // has never been reproduced on any real document. Whatever fixes it must be measured on
        // the regression set, and the decks need those two shapes added first.
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
  const served = servedModelId(response);
  dumpRawModel(seed, raw, normalizeOptions, served);
  const model = normalizeExtractedLogicModel(raw, normalizeOptions);

  return {
    model,
    modelId: extractModelId(),
    servedModelId: served,
    promptVersion: PROMPT_VERSION,
    promptVariant: promptVariantLabel({ isVision, hasTextTrack, lowLegibility }),
  };
}
