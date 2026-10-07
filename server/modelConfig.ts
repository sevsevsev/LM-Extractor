import { ThinkingLevel } from '@google/genai';

/**
 * Which model answers, and the generation knobs that depend on which model it is.
 *
 * WHY THIS IS A MODULE AND NOT TWO CONSTANTS IN TWO FILES. Every one of these values is a bet on
 * one model's behaviour, and Google rotates the model underneath a rolling alias. Until this file
 * existed the model id was a hardcoded `const` in `geminiLogicModel.ts` and another in
 * `geminiLogicModelGroups.ts`, and the thinking level was inline in the request. So answering
 * "does this still work on the next model" required editing tracked source, restarting the server
 * and reverting afterwards — a code change per question, which is why PR #36 was argued from a
 * single arm instead of a table. With the values read from the environment, the same question is
 * `LM_EXTRACT_MODEL=gemini-3.7-flash npm run benchmark:accuracy`, and nothing has to be edited to
 * ask it.
 *
 * The defaults below are the shipped configuration; the environment variables exist for
 * experiments and are not expected to be set in normal use.
 */

/** Trim-and-drop-empty, so `LM_EXTRACT_MODEL=` in a `.env` file does not mean "model named ''". */
function env(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed ? trimmed : undefined;
}

/**
 * Use Google's rolling `-latest` aliases, not a dated snapshot (e.g. `gemini-2.5-flash`) — pinned
 * snapshots get sunset for new API keys/projects (confirmed 2026-09-14, and still true
 * 2026-10-07: `gemini-2.5-flash` returns 404 "no longer available to new users" on this
 * project's key even though it still appears in the models.list response). The alias resolves
 * forward automatically as Google rotates the recommended model, which is what we actually want
 * for a rarely-touched local tool.
 *
 * The cost of that choice is that we do not control when the served model changes, which is why
 * `ServerExtractResult.modelVersion` records what actually answered. Override with
 * `LM_EXTRACT_MODEL` to qualify a candidate model without changing code.
 */
export const EXTRACT_MODEL_ID = env('LM_EXTRACT_MODEL') ?? 'gemini-flash-latest';

/** Same rolling alias as extraction, overridable separately so the cheap pre-pass can be pinned
 * independently of the expensive call. */
export const DETECT_MODEL_ID = env('LM_DETECT_MODEL') ?? 'gemini-flash-latest';

const THINKING_LEVELS: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

/** `undefined` means "send no `thinkingConfig` at all" — the model's own default. */
export type ResolvedThinkingLevel = ThinkingLevel | undefined;

/**
 * Parse `LM_EXTRACT_THINKING_LEVEL`. Exported as a pure function so the parsing is testable
 * without reaching into `process.env`.
 *
 * `'default'` is a first-class value rather than an absence, because "send nothing and let the
 * model decide" is a real arm that has to be reachable without editing code: on
 * `gemini-3.8-flash` the default is what the regression set extracts correctly, and the explicit
 * `low` below is what it does not. Being unable to select that arm from the outside is precisely
 * what made PR #36 expensive to evaluate.
 *
 * An unrecognised value THROWS rather than falling back. A silently ignored override would make
 * an experiment report the default's numbers under the candidate's name, which is a worse failure
 * than refusing to start.
 */
export function resolveThinkingLevel(raw: string | undefined): ResolvedThinkingLevel {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return ThinkingLevel.LOW;
  if (key === 'default' || key === 'none') return undefined;
  const level = THINKING_LEVELS[key];
  if (!level) {
    throw new Error(
      `LM_EXTRACT_THINKING_LEVEL=${raw} is not a thinking level. ` +
        `Use one of: ${Object.keys(THINKING_LEVELS).join(', ')}, default.`
    );
  }
  return level;
}

/**
 * Thinking level for the extraction call. Defaults to `low`, which is NOT the model's default and
 * is a deliberate choice for `gemini-3.8-flash`: at the model's own default (Medium) two of the 15
 * benchmark documents (`inline-colon-labels`, `theory-of-change-own-voice`) come back with ONE
 * item and nothing else — Gemini's raw answer, not our post-processing, with `finishReason: STOP`
 * and ~1.7k thought tokens spent. `high` fails the same way; `low` returns no thoughts at all and
 * scores the deck set 100%.
 *
 * KNOWN COST, measured on real documents 2026-10-07 and not visible in the deck set: `low` also
 * expands short Activities labels (`seamaac-urban-arts`: ten labels, four of them single words,
 * all expanded to 4-9 words at an unchanged item count of 33) and drops 11 `unmapped` items from
 * `philadelphia-ballet-lets-dance`. `minimal` is rejected by the model; a capped `thinkingBudget`
 * produces output identical to `low`; restoring `temperature: 0` alongside it changes nothing, so
 * the thinking level is the cause and there is no middle setting. Set
 * `LM_EXTRACT_THINKING_LEVEL=default` to get the arm that extracts those two documents correctly
 * and collapses the two decks instead.
 */
export const EXTRACT_THINKING_LEVEL: ResolvedThinkingLevel = resolveThinkingLevel(
  env('LM_EXTRACT_THINKING_LEVEL')
);
