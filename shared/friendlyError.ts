/**
 * Turning whatever went wrong into a sentence the operator can act on.
 *
 * Extracted from `App.tsx` for testing. Every branch here is a real failure someone hit, and the
 * ordering matters: a vision failure already carries a written-for-the-user message and must pass
 * through before the patterns below rewrite it into something vaguer.
 */
import { isVisionFailure } from './visionFallback.js';

export const friendlyError = (error: unknown): string => {
  // Already written for the user, and specific about what to do next: pass it through before the
  // patterns below rewrite it into something vaguer.
  if (isVisionFailure(error)) return error.message;
  const message = error instanceof Error ? error.message : String(error || 'Something went wrong');
  if (/api key|401|unauthorized/i.test(message)) {
    return "Couldn't reach Gemini — check that GEMINI_API_KEY is set in .env.local.";
  }
  if (/429|rate|quota/i.test(message)) {
    return 'Gemini is rate-limiting requests. Wait a moment, then try again.';
  }
  if (/\b404\b|not found/i.test(message)) {
    return 'The API endpoint was not found. If this is a hosted deployment, confirm the /api functions deployed.';
  }
  if (/\b413\b|payload too large|request entity too large/i.test(message)) {
    return 'This document is too large for the hosted upload limit. Try a shorter PDF or run locally.';
  }
  if (/Failed to convert|Unsupported file format|vision/i.test(message)) {
    return "Couldn't read this document. Try a PDF, or a simpler DOCX/PPTX.";
  }
  return message;
};
