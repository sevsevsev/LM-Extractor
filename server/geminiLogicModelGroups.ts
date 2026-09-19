import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getDetectLogicModelGroupsPrompt } from '../constants.js';
import type { DetectLogicModelGroupsInput, LogicModelPageGroup } from '../types.js';
import { normalizeLogicModelPageGroups } from '../shared/logicModelPageGroups.js';
import { withRetry } from './geminiRetry.js';
import { deriveGeminiSeed } from './geminiSeed.js';

/** Same rolling alias as extraction — see server/geminiLogicModel.ts for why. */
const DETECT_MODEL_ID = 'gemini-flash-latest';

const detectSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    groups: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          startPage: { type: Type.NUMBER },
          endPage: { type: Type.NUMBER },
          label: { type: Type.STRING },
        },
        required: ['startPage', 'endPage'],
      },
    },
  },
  required: ['groups'],
};

/**
 * Cheap pre-pass deciding whether an uploaded document contains one logic model or several (see
 * docs/specs/multi-logic-model-pdf-v1.md). Never throws on a malformed/unparseable response — that
 * falls back to a single whole-document group via `normalizeLogicModelPageGroups`, same as any
 * other trust boundary in this app defaults to "don't do the aggressive thing" on bad input.
 */
export async function detectLogicModelGroupsOnServer(
  apiKey: string,
  input: DetectLogicModelGroupsInput
): Promise<LogicModelPageGroup[]> {
  const pageCount = input.previewImages.length;
  if (pageCount < 2) return [{ startPage: 1, endPage: Math.max(1, pageCount) }];

  const ai = new GoogleGenAI({ apiKey });
  const prompt = getDetectLogicModelGroupsPrompt(pageCount);
  const textTrack = input.textTrack.trim();

  const parts: unknown[] = [{ text: prompt }];
  if (textTrack) {
    parts.push({ text: `\n\nSTRUCTURAL TEXT (for header/organization/program cross-check):\n---\n${textTrack}\n---` });
  }
  for (let i = 0; i < input.previewImages.length; i++) {
    parts.push({ text: `Page ${i + 1} of ${pageCount}:` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: input.previewImages[i] } });
  }

  const seed = deriveGeminiSeed([prompt, textTrack, ...input.previewImages]);

  let raw: unknown;
  try {
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: DETECT_MODEL_ID,
        contents: { parts } as never,
        config: {
          responseMimeType: 'application/json',
          responseSchema: detectSchema,
          temperature: 0,
          seed,
        },
      })
    );
    const parsed = JSON.parse(response.text ?? '{}') as { groups?: unknown };
    raw = parsed.groups;
  } catch {
    raw = undefined; // network/parse failure — normalize's fallback (one group) handles it below
  }

  return normalizeLogicModelPageGroups(raw, pageCount);
}
