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

/** True for both vision errors: the ones App.tsx must not quietly downgrade to a text extraction. */
export function isVisionFailure(
  error: unknown
): error is VisionUnavailableError | VisionConversionFailedError {
  return (
    isVisionUnavailable(error) ||
    error instanceof VisionConversionFailedError ||
    (error instanceof Error && error.name === 'VisionConversionFailedError')
  );
}

/**
 * Shown when the deployment genuinely cannot convert PowerPoint: the convert route itself says its
 * LibreOffice is missing. Retrying cannot change that, so the sentence tells the user to stop
 * trying and do something else.
 */
export const PPTX_VISION_UNAVAILABLE_MESSAGE =
  'PowerPoint conversion is not available on this deployment, so this deck can only be read as plain text — which loses the column layout. Upload a PDF export of the deck instead, or run the app locally.';

/**
 * Shown when the conversion failed THIS TIME: a timeout, a crash, a truncated response.
 *
 * Kept separate because the sentence above was first written to cover both, and it lied about the
 * common case — a deck that converts on its own and then fails in a batch is proof that the
 * deployment can convert PowerPoint, so telling that user their deployment cannot is both wrong
 * and unactionable (reported 2026-09-24). `cause` carries the status or message the server gave,
 * because the user reading this is the only person who can see it.
 */
export function pptxConversionFailedMessage(cause: string, retried: boolean): string {
  const trimmed = cause.replace(/\s+/g, ' ').trim();
  const bounded =
    trimmed.length > MAX_REASON_CHARS ? `${trimmed.slice(0, MAX_REASON_CHARS - 1)}…` : trimmed;
  const what = `Couldn't convert this deck to pages${bounded ? ` (${bounded})` : ''}.`;
  // A refused request and an unlucky one need opposite advice, and the wrong one wastes the user's
  // time: telling someone to retry a 413 sends them round the same loop.
  return retried
    ? `${what} It was already retried once. Try this file again on its own — if it keeps failing, upload a PDF export of the deck.`
    : `${what} The server refused the request rather than failing at it, so another attempt will do the same. Upload a PDF export of the deck instead.`;
}

/**
 * The conversion failed in a way that another attempt might survive, so the file is worth
 * retrying — unlike `VisionUnavailableError`, which no number of attempts will fix.
 */
export class VisionConversionFailedError extends Error {
  readonly detail?: string;

  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'VisionConversionFailedError';
    this.detail = detail;
  }
}

/**
 * Which failures are worth another attempt.
 *
 * 503 is this app's own "no LibreOffice here" answer from the convert route, and 4xx generally
 * means the request was wrong rather than unlucky — neither improves on a second try. Everything
 * else (a 5xx crash, a gateway timeout on a cold start, a response whose body never arrived) is
 * the kind of failure a retry exists for.
 */
export function isRetryableConvertStatus(status: number): boolean {
  if (status === 503) return false;
  if (status >= 400 && status < 500) return false;
  return true;
}
