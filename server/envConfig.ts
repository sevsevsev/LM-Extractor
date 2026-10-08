/**
 * Reading a configuration value out of the environment, the same way everywhere.
 *
 * One function, extracted only because `server/geminiModelConfig.ts` and
 * `server/extractionProvider.ts` both need it and a second copy would be a second place for the
 * "" case to be got wrong. The rule it encodes: an empty or whitespace-only variable means UNSET,
 * not a value of "". A blank `LM_EXTRACT_MODEL` left in a shell profile should not break
 * extraction by asking for a model named "".
 */

/**
 * Read at CALL time, never captured at module load, so a test or a script can set the variable
 * after this module is imported and still be heard. That is not a style preference — a value
 * captured at import is exactly the bug that makes a measurement quietly describe a different arm
 * than its label claims.
 */
export function fromEnv(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
