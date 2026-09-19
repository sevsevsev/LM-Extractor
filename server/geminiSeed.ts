import { createHash } from 'node:crypto';

/**
 * Deterministic seed for Gemini's `config.seed`, derived from the exact request content. Same
 * document (same images/text) re-run gets the same seed, so a re-run is reproducible as far as
 * Gemini's "mostly deterministic... not a guaranteed absolute deterministic behavior" contract
 * allows — it's a stabilizer for genuine sampling noise, not a fix for prompt ambiguity that leads
 * the model to a genuinely different structural read of the same content.
 */
export function deriveGeminiSeed(parts: (string | undefined)[]): number {
  const hash = createHash('sha256').update(parts.filter(Boolean).join('\u0000')).digest();
  // Gemini's `seed` is a signed TYPE_INT32 — readUInt32BE can exceed INT32_MAX (confirmed live:
  // Google rejected a request with a >2^31 seed as "Invalid value ... TYPE_INT32"). readInt32BE
  // reinterprets the same 4 bytes as signed, which by definition always fits.
  return hash.readInt32BE(0);
}
