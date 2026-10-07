/**
 * Which Gemini model answers, and what generation settings go with it — in one place, as data.
 *
 * WHY THIS MODULE EXISTS. Until 2026-10-07 the model was a hardcoded `const` in two separate
 * files, and the generation config was written inline beside each call. The cost of that showed up
 * the day Google rotated `gemini-flash-latest` to `gemini-3.8-flash` underneath us: every question
 * worth asking — does an older model still work, does this setting help, what does the benchmark
 * say about a candidate — required editing tracked source and restarting a server, so a day went
 * on experiments that should each have been one command. A model roll is a normal event in the
 * life of this tool, and answering it should be boring.
 *
 * So: defaults live here, an environment variable overrides each one, and nothing else in the
 * codebase names a model. Trying a candidate is
 *
 *     LM_EXTRACT_MODEL=gemini-3.7-flash npm run benchmark:accuracy
 *
 * WHAT THIS DOES NOT DO, stated so nobody reads more into it. It does not make extraction
 * model-independent. The prompt is hundreds of lines tuned against observed model behaviour, and
 * extraction quality is a property of the model, so a model change always needs measuring. What
 * this removes is the cost of measuring it, not the measurement.
 */

/** The rolling alias both calls use unless told otherwise. */
const DEFAULT_MODEL_ID = 'gemini-flash-latest';

/**
 * Read at CALL time, never at module load, so a test or a script can set the variable after this
 * module is imported and still be heard. An empty or whitespace-only value is treated as unset
 * rather than as a model named "" — a blank variable in a shell profile should not break
 * extraction.
 */
function fromEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The model for the extraction call. `LM_EXTRACT_MODEL` overrides it.
 *
 * The default is a rolling alias on purpose, and the reason is stronger than convenience: a dated
 * snapshot gets sunset for new API keys. Confirmed 2026-09-14 and still true 2026-10-07 —
 * `gemini-2.5-flash` returns 404 "no longer available to new users" on a freshly created key even
 * though it still appears in `models.list`. The price of the alias is that Google can change what
 * answers without telling us, which is what `servedModelId` below is for.
 */
export function extractModelId(): string {
  return fromEnv('LM_EXTRACT_MODEL') ?? DEFAULT_MODEL_ID;
}

/** The model for the page-group detection call. `LM_DETECT_MODEL` overrides it. */
export function detectModelId(): string {
  return fromEnv('LM_DETECT_MODEL') ?? DEFAULT_MODEL_ID;
}

/**
 * Models worth scoring when the served model changes or a pin is being considered.
 *
 * This list is the structural answer to a rolling alias moving under us. The alternative — pick
 * one model and tune the prompt to it — is the same bet in different clothes, and it comes due
 * every time Google rotates or retires something. A short list that the benchmark can score turns
 * a roll into reading a table.
 *
 * It is NOT a fallback chain. Nothing here is tried automatically: a model is used because
 * somebody set `LM_EXTRACT_MODEL` to it after reading the numbers. Membership means "worth
 * measuring", never "known good" — see `fixtures/benchmark/README.md` for what the benchmark can
 * and cannot tell you about a model.
 */
export const CANDIDATE_MODEL_IDS = [
  'gemini-flash-latest',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
] as const;

/**
 * What actually answered, read off the response.
 *
 * The SDK returns `modelVersion` on every `generateContent` response, and until 2026-10-07 we
 * threw it away: the extraction log recorded the alias we asked for, so a silent roll at Google's
 * end left no trace in our own data and was eventually discovered through a confusing diff three
 * weeks later. Recording it is the cheapest change in this codebase with the largest effect on how
 * long the next surprise takes to attribute.
 *
 * Returns `undefined` rather than guessing when the field is absent, so a caller writes "unknown"
 * instead of writing the alias and calling it the served model. Never throws: a provenance field
 * must not be able to fail an extraction somebody is waiting on.
 */
export function servedModelId(response: unknown): string | undefined {
  const version = (response as { modelVersion?: unknown } | null | undefined)?.modelVersion;
  if (typeof version !== 'string') return undefined;
  const trimmed = version.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
