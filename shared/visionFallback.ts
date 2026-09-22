/**
 * The two things the app has to say when vision conversion does not happen, in a module with no
 * dependencies so both `App.tsx` (statically imported) and `services/fileService.ts` (dynamically
 * imported, and heavy — pdfjs, mammoth, jszip) can share them.
 *
 * Why this exists: a conversion failure used to leave exactly one trace, a `console.warn` nobody
 * reads, and the file went on to a text-only extraction whose warning said only that images could
 * not be read. Nine decks run against a hosted deployment on 2026-09-22 all came back that way and
 * the log could not say why — the reason had been thrown away at the catch. The reason now travels
 * with the warning into the extraction log, so a run is its own diagnosis.
 */

/** Fallback happened and the document was still usable as text. */
export const TEXT_ONLY_FALLBACK_WARNING =
  "Couldn't read this document as images, so it was analyzed as plain text. Layout-based grouping may be less accurate — verify the results.";

const MAX_REASON_CHARS = 180;

/** `TEXT_ONLY_FALLBACK_WARNING` with the underlying failure appended, one line, bounded. */
export function textOnlyFallbackWarning(reason?: unknown): string {
  const raw =
    reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return TEXT_ONLY_FALLBACK_WARNING;
  const bounded =
    cleaned.length > MAX_REASON_CHARS ? `${cleaned.slice(0, MAX_REASON_CHARS - 1)}…` : cleaned;
  return `${TEXT_ONLY_FALLBACK_WARNING} Reason: ${bounded}`;
}

/**
 * Vision is not available at all on this deployment, so falling back to text would produce a
 * partial extraction that can never become a good one however many times it is retried.
 *
 * Thrown rather than swallowed: for a PowerPoint the text track is the slide's shapes in z-order
 * with no geometry, which is precisely the layout the column grouping depends on. A silent
 * downgrade spends a Gemini call to produce a result the reviewer has to throw away.
 */
export class VisionUnavailableError extends Error {
  /** The underlying server message, kept out of the sentence shown to the user. */
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'VisionUnavailableError';
    this.detail = detail;
  }
}

/** `instanceof` across the dynamic-import boundary, with a name check as the backstop. */
export function isVisionUnavailable(error: unknown): error is VisionUnavailableError {
  return (
    error instanceof VisionUnavailableError ||
    (error instanceof Error && error.name === 'VisionUnavailableError')
  );
}

/** Shown to the user when the PPTX→PDF service is not reachable or has no LibreOffice. */
export const PPTX_VISION_UNAVAILABLE_MESSAGE =
  'PowerPoint conversion is not available on this deployment, so this deck can only be read as plain text — which loses the column layout. Upload a PDF export of the deck instead, or run the app locally.';
