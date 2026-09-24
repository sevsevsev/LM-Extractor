import {
  PPTX_VISION_UNAVAILABLE_MESSAGE,
  VisionConversionFailedError,
  VisionUnavailableError,
  isRetryableConvertStatus,
  pptxConversionFailedMessage,
} from './visionFallback';

/**
 * The PPTX→PDF request, with its retry and its reading of what went wrong.
 *
 * Lives here rather than in `services/fileService.ts` so it can be tested without a browser: that
 * module pulls in pdfjs, mammoth, docx-preview and jszip at import time. The caller passes the
 * send function, so the tests drive every response shape the hosted route can produce.
 *
 * Why a retry at all: reported 2026-09-24, a deck converts when uploaded on its own and fails when
 * it goes up with others. Conversion requests are strictly serial (verified in a browser against a
 * three-deck batch, never more than one in flight), so a batch differs from a single file only in
 * how long the work runs and what state the server is in by the time each request lands. That is
 * the shape of failure a single retry exists for, and the convert route is a pure function of its
 * body, so repeating it costs a few seconds and risks nothing.
 */

/** The part of `Response` this needs; keeps the tests free of a fetch polyfill. */
export interface ConvertResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type ConvertSend = () => Promise<ConvertResponseLike>;

export interface ConvertRequestOptions {
  /** Total attempts, including the first. Default 2. */
  attempts?: number;
  /** Pause before a retry. Default 1500ms. */
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, detail: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

interface AttemptFailure {
  status: number | null;
  detail: string;
}

async function attempt(send: ConvertSend): Promise<{ pdfBase64: string } | AttemptFailure> {
  let response: ConvertResponseLike;
  try {
    response = await send();
  } catch (error) {
    // The request never completed: a dropped connection, a refused socket. No status to read.
    return { status: null, detail: error instanceof Error ? error.message : 'request failed' };
  }

  let payload: { pdfBase64?: string; error?: string } = {};
  let bodyUnreadable = false;
  try {
    payload = ((await response.json()) ?? {}) as { pdfBase64?: string; error?: string };
  } catch {
    // A gateway timeout or a platform-level error answers in HTML, and a truncated body throws
    // here too. Swallowing this was how a 504 came to be reported as "not available on this
    // deployment": every non-JSON answer looked alike.
    bodyUnreadable = true;
  }

  if (response.ok && typeof payload.pdfBase64 === 'string' && payload.pdfBase64.length > 0) {
    return { pdfBase64: payload.pdfBase64 };
  }

  const suffix = bodyUnreadable
    ? ', response body could not be read'
    : response.ok
      ? ', response carried no PDF'
      : '';
  return { status: response.status, detail: payload.error || `HTTP ${response.status}${suffix}` };
}

/** Returns the base64 PDF, or throws the vision error that describes why it could not. */
export async function requestPptxPdfBase64(
  send: ConvertSend,
  options: ConvertRequestOptions = {}
): Promise<string> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const sleep = options.sleep ?? defaultSleep;
  let last: AttemptFailure = { status: null, detail: 'no attempt was made' };

  for (let n = 1; n <= attempts; n++) {
    const result = await attempt(send);
    if ('pdfBase64' in result) return result.pdfBase64;
    last = result;

    // This deployment has no LibreOffice at all. Saying so is the whole point of that 503, and
    // repeating the request only makes the user wait for the same answer.
    if (result.status === 503) {
      throw new VisionUnavailableError(PPTX_VISION_UNAVAILABLE_MESSAGE, result.detail);
    }
    if (result.status !== null && !isRetryableConvertStatus(result.status)) {
      throw new VisionConversionFailedError(
        pptxConversionFailedMessage(result.detail, false),
        result.detail
      );
    }
    if (n < attempts) {
      options.onRetry?.(n, result.detail);
      await sleep(options.retryDelayMs ?? 1500);
    }
  }

  throw new VisionConversionFailedError(
    pptxConversionFailedMessage(last.detail, attempts > 1),
    last.detail
  );
}
