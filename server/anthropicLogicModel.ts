/**
 * The Anthropic side of the provider seam: the same two calls, against the Messages API.
 *
 * NOT RUN IN ANGER YET. This was written and typechecked in a container with no Anthropic key, so
 * every line below is checked against Anthropic's documented request and response shapes and
 * nothing here has made a live call. The first real run belongs on a machine that has a key, and
 * until that has happened this path is a candidate, not a tested one. Treat a green `npm test` as
 * evidence about the Gemini path and about request CONSTRUCTION here, and about nothing else.
 *
 * WHY RAW `fetch` RATHER THAN `@anthropic-ai/sdk`. `AGENTS.md` says any new npm package is an
 * escalation to the user, and this landed as a draft for review rather than with a dependency
 * already added. The surface actually needed is small — one POST, a JSON schema, base64 image
 * blocks — so it is written against the documented wire shape instead. The SDK is the better home
 * for it once the dependency is agreed; that swap is contained to this file.
 *
 * WHAT DELIBERATELY MATCHES THE GEMINI PATH, so that a comparison between the two is about the
 * models and not about two different programs:
 *   - identical prompt text, from `getAiExtractionPrompt`, with the same variant flags;
 *   - the same TRACK A / TRACK B framing, in the same order, with the same per-image labels;
 *   - the same required-field list on the response schema, so both vendors are asked the same
 *     question and `extractionStatus` / `documentTypeAssessment` cannot be silently skipped;
 *   - the prompt sent as the first user content block rather than as a `system` prompt. `system`
 *     is the idiomatic home for a static instruction block and would be the better choice for a
 *     product; it is the wrong choice for an instrument, because it changes where the instructions
 *     sit relative to the document and that is a difference the measurement would then carry.
 *
 * WHAT CANNOT MATCH:
 *   - `seed`. The Messages API has none. `server/geminiSeed.ts` is not called here and no
 *     substitute is invented; the provider reports `supportsSeed: false` and the instruments that
 *     rest on reproducibility say so. See `server/extractionProvider.ts`.
 *   - thinking. On the current Opus, thinking is always on and cannot be disabled; `effort` is the
 *     only control. The Gemini path ships no `thinkingConfig` and takes the model's default, so
 *     this ships no `effort` and takes Claude's. `LM_EXTRACT_EFFORT` exists for the same reason
 *     `LM_EXTRACT_THINKING_LEVEL` does: so that selecting an arm is a command, not a source edit.
 */
import { PROMPT_VERSION, getAiExtractionPrompt, getDetectLogicModelGroupsPrompt, promptVariantLabel } from '../constants.js';
import {
  bundleImpliesLowLegibility,
  type DetectLogicModelGroupsInput,
  type DocumentBundle,
  type LogicModelPageGroup,
} from '../types.js';
import { parseLogicModelResponse } from '../shared/logicModelValidate.js';
import { normalizeExtractedLogicModel } from '../shared/extractNormalize.js';
import { normalizeLogicModelPageGroups } from '../shared/logicModelPageGroups.js';
import { withRetry } from './geminiRetry.js';
import { fromEnv } from './envConfig.js';
import { detectModelIdFor, extractModelIdFor, type ServerExtractResult } from './extractionProvider.js';

const ANTHROPIC_VERSION = '2023-06-01';

/** Honoured the way the official SDKs honour it, so a proxy or a gateway needs no code change. */
function apiBase(): string {
  return (fromEnv('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com').replace(/\/+$/, '');
}

/**
 * `low` | `medium` | `high` | `xhigh` | `max`, or null for "send none", which is the default and
 * the shipped behaviour. Unset means the model's own default stands — the same stance the Gemini
 * path takes on `thinkingLevel`, and for the same reason: on that side a non-default thinking
 * level scored the invented benchmark at 100% and cost two real documents accuracy (PR #36,
 * reverted by #37). An unrecognised value throws rather than quietly running the default arm.
 */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function extractEffort(): EffortLevel | null {
  const raw = fromEnv('LM_EXTRACT_EFFORT');
  if (raw === null) return null;
  const value = raw.toLowerCase();
  if (value === 'default' || value === 'none' || value === 'unset') return null;
  if ((EFFORT_LEVELS as readonly string[]).includes(value)) return value as EffortLevel;
  throw new Error(
    `LM_EXTRACT_EFFORT=${raw} is not an effort level. ` +
      `Use one of ${EFFORT_LEVELS.join(', ')}, or "default" to send none (the shipped behaviour).`
  );
}

const itemSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    fillColor: { type: 'string' },
    borderColor: { type: 'string' },
    sourcePage: { type: 'number' },
    sourceColumn: { type: 'number' },
  },
  required: ['text'],
  additionalProperties: false,
} as const;

const groupSchema = {
  type: 'object',
  properties: { name: { type: 'string' }, items: { type: 'array', items: itemSchema } },
  required: ['name', 'items'],
  additionalProperties: false,
} as const;

const stringField = {
  type: 'object',
  properties: { content: { type: 'string' } },
  required: ['content'],
  additionalProperties: false,
} as const;

const arrayField = {
  type: 'object',
  properties: { content: { type: 'array', items: groupSchema } },
  required: ['content'],
  additionalProperties: false,
} as const;

/**
 * The same questions `extractModelSchema` in `server/geminiLogicModel.ts` puts to Gemini, in JSON
 * Schema rather than the Google SDK's `Schema`. Every property here is a QUESTION, and a field
 * present in the schema but undefined by the prompt still gets answered on the model's own
 * recognisance — which is how `verbatim` and `sourceNote` once fed a confidence rollup nobody was
 * instructing. Keep the two schemas in step; `anthropicLogicModel.test.ts` asserts the required
 * lists match so a field cannot become mandatory for one vendor only.
 */
export const EXTRACT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    organization: { type: 'string' },
    program: { type: 'string' },
    impactStatement: stringField,
    mission: stringField,
    targetPopulation: stringField,
    inputs: arrayField,
    activities: arrayField,
    outputs: arrayField,
    shortTermOutcomes: arrayField,
    mediumTermOutcomes: arrayField,
    longTermOutcomes: arrayField,
    generalOutcomes: arrayField,
    impact: arrayField,
    colorLegend: { type: 'string' },
    unmapped: arrayField,
    layoutFamily: {
      type: 'string',
      enum: ['vertical_columns', 'horizontal_rows', 'diagram', 'prose_sections', 'unknown'],
    },
    extractionStatus: { type: 'string', enum: ['ok', 'partial', 'abstained'] },
    extractionConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    extractionBlockers: { type: 'array', items: { type: 'string' } },
    documentTypeAssessment: {
      type: 'string',
      enum: ['logic_model', 'not_logic_model', 'unclear'],
    },
    documentTypeNote: { type: 'string' },
    possiblyMissedRegions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          page: { type: 'number' },
          xStart: { type: 'number' },
          xEnd: { type: 'number' },
          note: { type: 'string' },
        },
        required: ['page'],
        additionalProperties: false,
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
    // Both of these are called REQUIRED in the prompt, and on the Gemini side both turned out to
    // be enforced only by the schema: a document the model meant to abstain on presented as a
    // high-confidence success while `extractionStatus` was merely documented. Same list here.
    'documentTypeAssessment',
    'extractionStatus',
  ],
  additionalProperties: false,
} as const;

const DETECT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          startPage: { type: 'number' },
          endPage: { type: 'number' },
          label: { type: 'string' },
        },
        required: ['startPage', 'endPage'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
} as const;

interface ContentBlock {
  type: string;
  text?: string;
  source?: { type: 'base64'; media_type: string; data: string };
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: { role: 'user'; content: ContentBlock[] }[];
  output_config: Record<string, unknown>;
}

function imageBlock(base64: string): ContentBlock {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } };
}

/**
 * Build the extract request, as a pure function of the bundle, so the construction is testable
 * without a key and without a network. Every assertion in `anthropicLogicModel.test.ts` runs
 * against this, which is the only part of this file a test in this repo can honestly cover.
 */
export function buildExtractRequest(bundle: DocumentBundle, model: string): AnthropicRequest {
  const images = Array.isArray(bundle.images) ? bundle.images.filter(Boolean) : [];
  const textTrack = typeof bundle.textTrack === 'string' ? bundle.textTrack.trim() : '';
  const isVision = images.length > 0;
  const hasTextTrack = textTrack.length > 0;
  if (!isVision && !hasTextTrack) {
    throw new Error('DocumentBundle must include images[] or a non-empty textTrack.');
  }
  const prompt = getAiExtractionPrompt(isVision, {
    lowLegibility: bundleImpliesLowLegibility(bundle),
    hasTextTrack,
  });

  const content: ContentBlock[] = [
    // The prompt is the same bytes on every request, so it is the cache prefix. Everything after
    // this breakpoint is per-document and must stay after it.
    { type: 'text', text: prompt, cache_control: { type: 'ephemeral' } },
  ];

  if (isVision) {
    if (hasTextTrack) {
      content.push({
        type: 'text',
        text:
          `\n\nTRACK A — STRUCTURAL TEXT / MARKDOWN (exact strings + hierarchy; fuse with Track B images below):\n` +
          `Use for verbatim wording, headings, lists, and bold/emphasis. Images remain authoritative for ` +
          `column position, fillColor/borderColor, and visual layout.\n---\n${textTrack}\n---`,
      });
    }
    for (let i = 0; i < images.length; i++) {
      const ref = bundle.imageRefs?.[i];
      const label =
        ref && typeof ref.page === 'number'
          ? ref.column != null
            ? `TRACK B image ${i + 1} of ${images.length}: document page ${ref.page}, column ${ref.column} (left→right).`
            : `TRACK B image ${i + 1} of ${images.length}: document page ${ref.page}.`
          : `TRACK B image ${i + 1} of ${images.length}.`;
      content.push({ type: 'text', text: label });
      content.push(imageBlock(images[i]));
    }
    if (hasTextTrack) {
      content.push({
        type: 'text',
        text: '\nTRACK B — The JPEG parts above are page/slide (and optional column-crop) images for visual semantics.',
      });
    }
  } else {
    content.push({
      type: 'text',
      text: `\n\nTRACK A — DOCUMENT CONTENT (text-only DocumentBundle):\n---\n${textTrack}\n---`,
    });
  }

  const effort = extractEffort();
  return {
    model,
    // Headroom, not a target: a long grid plus a full `unmapped` pass is the biggest answer this
    // schema can produce, and a truncated response is an invalid one that costs the whole call.
    max_tokens: 16000,
    messages: [{ role: 'user', content }],
    output_config: {
      format: { type: 'json_schema', schema: EXTRACT_JSON_SCHEMA },
      ...(effort ? { effort } : {}),
    },
  };
}

function statusError(status: number, body: string): Error {
  const error = new Error(`Anthropic request failed (${status}): ${body.slice(0, 400)}`);
  // `server/geminiRetry.ts` reads `.status` to decide whether a failure is transient. `fetch` does
  // not throw on a non-2xx, so the status has to be carried onto the error by hand or every 429
  // and 503 would be treated as permanent.
  (error as Error & { status: number }).status = status;
  return error;
}

async function postMessages(apiKey: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${apiBase()}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw statusError(response.status, await response.text().catch(() => ''));
  return (await response.json()) as Record<string, unknown>;
}

/**
 * The structured answer, as a string, out of the response's content blocks.
 *
 * Thinking blocks arrive alongside the answer and carry no `text` worth parsing, so this takes the
 * first `text` block rather than the first block. A refusal or a `max_tokens` stop returns HTTP
 * 200 with content that does not match the schema, so both are turned into errors here instead of
 * being handed to `parseLogicModelResponse` as if they were an extraction.
 */
export function readStructuredText(response: Record<string, unknown>): string {
  const stop = response.stop_reason;
  if (stop === 'refusal') {
    throw new Error('Anthropic declined this request, so there is no extraction to read.');
  }
  if (stop === 'max_tokens') {
    throw new Error('Anthropic response hit max_tokens and is truncated, so it cannot be parsed.');
  }
  const content = Array.isArray(response.content) ? (response.content as ContentBlock[]) : [];
  const text = content.find(block => block?.type === 'text' && typeof block.text === 'string');
  if (!text?.text) throw new Error('Anthropic response carried no text block to parse.');
  return text.text;
}

export async function extractLogicModelOnAnthropic(
  apiKey: string,
  bundle: DocumentBundle
): Promise<ServerExtractResult> {
  const modelId = extractModelIdFor('anthropic');
  const request = buildExtractRequest(bundle, modelId);
  const response = await withRetry(() => postMessages(apiKey, request));

  const images = Array.isArray(bundle.images) ? bundle.images.filter(Boolean) : [];
  const textTrack = typeof bundle.textTrack === 'string' ? bundle.textTrack.trim() : '';
  const raw = parseLogicModelResponse(readStructuredText(response));
  const model = normalizeExtractedLogicModel(raw, {
    sourceText: textTrack || undefined,
    lowLegibility: bundleImpliesLowLegibility(bundle),
    textOnlyFallback: images.length === 0,
  });

  return {
    model,
    modelId,
    // What actually answered. Same provenance discipline as the Gemini path: read off the
    // response, never defaulted to what was requested.
    servedModelId: typeof response.model === 'string' ? response.model : undefined,
    promptVersion: PROMPT_VERSION,
    promptVariant: promptVariantLabel({
      isVision: images.length > 0,
      hasTextTrack: textTrack.length > 0,
      lowLegibility: bundleImpliesLowLegibility(bundle),
    }),
  };
}

/**
 * The page-group pre-pass. Never throws, exactly like the Gemini one: a failure here falls back to
 * a single whole-document group via `normalizeLogicModelPageGroups`, because the aggressive thing
 * (splitting a document) is the wrong default on bad input.
 */
export async function detectLogicModelGroupsOnAnthropic(
  apiKey: string,
  input: DetectLogicModelGroupsInput
): Promise<LogicModelPageGroup[]> {
  const pageCount = input.previewImages.length;
  if (pageCount < 2) return [{ startPage: 1, endPage: Math.max(1, pageCount) }];

  const textTrack = input.textTrack.trim();
  const content: ContentBlock[] = [
    { type: 'text', text: getDetectLogicModelGroupsPrompt(pageCount) },
  ];
  if (textTrack) {
    content.push({
      type: 'text',
      text: `\n\nSTRUCTURAL TEXT (for header/organization/program cross-check):\n---\n${textTrack}\n---`,
    });
  }
  for (let i = 0; i < pageCount; i++) {
    content.push({ type: 'text', text: `Page ${i + 1} of ${pageCount}:` });
    content.push(imageBlock(input.previewImages[i]));
  }

  let raw: unknown;
  try {
    const response = await withRetry(() =>
      postMessages(apiKey, {
        model: detectModelIdFor('anthropic'),
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema: DETECT_JSON_SCHEMA } },
      })
    );
    const parsed = JSON.parse(readStructuredText(response)) as { groups?: unknown };
    raw = parsed.groups;
  } catch {
    raw = undefined;
  }

  return normalizeLogicModelPageGroups(raw, pageCount);
}
