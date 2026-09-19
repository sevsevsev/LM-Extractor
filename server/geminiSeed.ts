import { createHash } from 'node:crypto';

/**
 * Deterministic seed for Gemini's `config.seed`, derived from the exact request content. Same
 * document (same images/text) re-run gets the same seed, so a re-run is reproducible as far as
 * Gemini's "mostly deterministic... not a guaranteed absolute deterministic behavior" contract
 * allows — it's a stabilizer for genuine sampling noise, not a fix for prompt ambiguity that leads
 * the model to a genuinely different structural read of the same content.
 *
 * **Callers must pass document content only — never the prompt.** The prompt used to be part of
 * this hash, which meant every prompt edit also moved the seed: an A/B between two PROMPT_VERSIONs
 * was then a prompt change *plus* a sampling change, with no way to separate them. Since prompt
 * revision is driven by comparing batch runs (see the working agreement at the top of
 * constants.ts), the seed has to be held constant across prompt versions for the comparison to be
 * paired. Keying on the document alone gives that: same document + same prompt reproduces exactly,
 * and same document + different prompt isolates the prompt as the only variable.
 */
export function deriveGeminiSeed(parts: (string | undefined)[]): number {
  const hash = createHash('sha256').update(parts.filter(Boolean).join('\u0000')).digest();
  // Gemini's `seed` is a signed TYPE_INT32 — readUInt32BE can exceed INT32_MAX (confirmed live:
  // Google rejected a request with a >2^31 seed as "Invalid value ... TYPE_INT32"). readInt32BE
  // reinterprets the same 4 bytes as signed, which by definition always fits.
  return hash.readInt32BE(0);
}
