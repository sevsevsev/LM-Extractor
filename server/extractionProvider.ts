/**
 * Which PROVIDER answers, as a setting — the seam one level above `server/geminiModelConfig.ts`.
 *
 * WHY THIS MODULE EXISTS. `geminiModelConfig.ts` made the *model* a setting, which turned "did
 * Google roll the alias under us" from a source edit into one command. It did not make the
 * *provider* a setting: `server/apiCore.ts` imported the Gemini implementation directly and read
 * `GEMINI_API_KEY` by name, so the question one level up — is another vendor better at this, and
 * what does it cost — still required editing tracked source.
 *
 * That question came due on 2026-10-07. Scored on the 17 invented benchmark decks, same prompt
 * text, same response schema, same post-processing and the same scorer: Gemini 3.8 Flash 89.1%
 * recall over two identical passes, a hand-run Claude extraction 100.0%, with the entire gap on
 * two decks (`inline-colon-labels`, `theory-of-change-own-voice`) and the other fifteen tied. That
 * is one measurement with known weaknesses — see `docs/specs/provider-seam.md` — and the point of
 * this module is NOT that it settled anything. The point is that the next time it is asked, it is
 * a measurement rather than a rewrite.
 *
 * WHAT THIS DOES NOT DO. It does not make extraction provider-independent. The prompt is hundreds
 * of lines tuned against observed Gemini behaviour over weeks, so most of its rules exist because
 * one model did one wrong thing once; a provider change always needs measuring, and a fair trial
 * of another vendor probably means removing rules rather than porting all of them. What this
 * removes is the cost of asking, not the answer.
 */
import type { DetectLogicModelGroupsInput, DocumentBundle, LogicModel, LogicModelPageGroup } from '../types.js';
import { fromEnv } from './envConfig.js';

export const PROVIDER_IDS = ['gemini', 'anthropic'] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The provider that answers unless told otherwise. Shipped behaviour, and the measured one. */
const DEFAULT_PROVIDER: ProviderId = 'gemini';

/**
 * What the extract call returns, regardless of who answered.
 *
 * Defined here rather than in `geminiLogicModel.ts` (where it used to live) so that a second
 * implementation does not have to import the first one to describe its own return type.
 */
export interface ServerExtractResult {
  model: LogicModel;
  /**
   * What we ASKED for — the configured model id, usually a rolling alias on the Gemini side. See
   * `extractModelIdFor` below.
   */
  modelId: string;
  /**
   * What ANSWERED, read off the response, or `undefined` when the response did not say.
   *
   * Never inferred and never defaulted to the requested id: a rolling alias means the vendor can
   * rotate the served model with no change on our side, and recording only the alias is what let
   * the 2026-10-07 roll to `gemini-3.8-flash` go unnoticed until an accuracy shift was blamed on
   * our own diff. A wrong provenance field is worse than an absent one.
   */
  servedModelId?: string;
  /** Exact prompt wording version that produced `model` — see `PROMPT_VERSION` in constants.ts. */
  promptVersion: string;
  /** Which of the prompt's variants this document actually received. */
  promptVariant: string;
}

/**
 * One vendor behind the two calls this app makes.
 *
 * Deliberately narrow. Everything below the seam — `parseLogicModelResponse`,
 * `normalizeExtractedLogicModel`, the fidelity rollup, the scorer — is a pure function of what
 * comes back, and none of it learns that there was a choice.
 */
export interface ExtractionProvider {
  readonly id: ProviderId;
  /** The environment variable holding this provider's key, named in the missing-key error. */
  readonly apiKeyVar: string;
  /**
   * Whether a run can be pinned to a content-derived seed, so the same document re-run gives the
   * same answer as far as the vendor's own determinism contract allows.
   *
   * REPORTED, NOT FAKED, and this is the one capability that is a real difference rather than a
   * shape difference. `npm run census` and `npm run regression:check` both rest on "same document,
   * same answer": the census compares two runs with each other, and the regression set diffs
   * today's output against a blessed snapshot. Gemini has `config.seed` and
   * `server/geminiSeed.ts` derives one from the document. The Claude API has no equivalent — there
   * is no seed parameter — so on a provider where this is `false` those instruments are measuring
   * something weaker, and the honest move is to say so at the point of measurement rather than let
   * sampling noise read as a regression. Nothing here invents a substitute.
   */
  readonly supportsSeed: boolean;
  extract(apiKey: string, bundle: DocumentBundle): Promise<ServerExtractResult>;
  detectLogicModelGroups(
    apiKey: string,
    input: DetectLogicModelGroupsInput
  ): Promise<LogicModelPageGroup[]>;
}

/**
 * Default models per provider. `LM_EXTRACT_MODEL` / `LM_DETECT_MODEL` override either one, and
 * they are read per provider so that setting a Claude model id does not have to be paired with
 * remembering to also set the provider — a mismatch fails loudly at the vendor instead.
 *
 * The Gemini defaults are a rolling alias on purpose (a dated snapshot gets sunset for new API
 * keys — confirmed 2026-09-14, still true 2026-10-07). The Anthropic defaults are the current
 * Opus for extraction, which is the tier the 2026-10-07 comparison was run at, and a cheaper model
 * for the page-group pre-pass, which only has to split pages into groups. NEITHER Anthropic
 * default has been scored by this repo's benchmark through this code path — they are a starting
 * point for a measurement, not a recommendation.
 */
const DEFAULT_EXTRACT_MODEL: Record<ProviderId, string> = {
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-opus-5-5',
};

const DEFAULT_DETECT_MODEL: Record<ProviderId, string> = {
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-haiku-5-5',
};

const API_KEY_VAR: Record<ProviderId, string> = {
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * The provider for both calls. `LM_EXTRACT_PROVIDER` overrides it.
 *
 * An unrecognised value THROWS rather than falling back to the default, for the same reason
 * `extractThinkingLevel` does: an experiment that quietly runs the shipped arm and files its
 * numbers under the candidate's name is a worse failure than one that refuses to start, and this
 * project has already been burned once by a measurement that described a different arm than its
 * label claimed.
 */
export function extractionProviderId(): ProviderId {
  const raw = fromEnv('LM_EXTRACT_PROVIDER');
  if (raw === null) return DEFAULT_PROVIDER;
  const value = raw.toLowerCase();
  if (isProviderId(value)) return value;
  throw new Error(
    `LM_EXTRACT_PROVIDER=${raw} is not a provider. Use one of ${PROVIDER_IDS.join(', ')}.`
  );
}

/** The extract-call model for a provider. `LM_EXTRACT_MODEL` overrides it. */
export function extractModelIdFor(provider: ProviderId): string {
  return fromEnv('LM_EXTRACT_MODEL') ?? DEFAULT_EXTRACT_MODEL[provider];
}

/** The page-group detection model for a provider. `LM_DETECT_MODEL` overrides it. */
export function detectModelIdFor(provider: ProviderId): string {
  return fromEnv('LM_DETECT_MODEL') ?? DEFAULT_DETECT_MODEL[provider];
}

/** The environment variable this provider's key lives in. */
export function apiKeyVarFor(provider: ProviderId): string {
  return API_KEY_VAR[provider];
}

/** This provider's key, or '' when unset — the caller turns that into the missing-key error. */
export function apiKeyFor(provider: ProviderId): string {
  return (process.env[API_KEY_VAR[provider]] || '').trim();
}
