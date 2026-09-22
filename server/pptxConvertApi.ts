import { convertPptxBufferToPdf, libreOfficeWasmAvailable } from './libreOfficeConverter.js';
import type { ApiResult } from './apiCore.js';

function errorResult(error: unknown): ApiResult {
  const message = error instanceof Error ? error.message : 'Unknown server error';
  return { status: 500, body: { error: message } };
}

/** Seams for the tests; production callers pass nothing and get the real LibreOffice. */
export interface PptxConvertDeps {
  wasmAvailable?: () => boolean;
  convert?: typeof convertPptxBufferToPdf;
}

const UNAVAILABLE_MESSAGE =
  'LibreOffice is not available in this deployment: the converter package is installed but its WASM assets were not shipped with this function. Add them to the function bundle (see `includeFiles` in vercel.json), or run the Express server, which reads them from node_modules.';

/**
 * `GET /api/convert/pptx-to-pdf` — can this deployment convert PowerPoint at all?
 *
 * Deliberately not part of `/api/health`: a serverless platform bundles each function separately,
 * so only the function that does the converting can answer for the files it was shipped with.
 * A health route in another bundle would confidently report the wrong answer.
 */
export function handlePptxConvertProbeRequest(deps: PptxConvertDeps = {}): ApiResult {
  const available = (deps.wasmAvailable ?? libreOfficeWasmAvailable)();
  return {
    status: 200,
    body: {
      ok: true,
      libreOfficeWasm: available,
      ...(available ? {} : { error: UNAVAILABLE_MESSAGE }),
    },
  };
}

/**
 * The upload as bytes, whatever shape the host handed us: an `express.raw` Buffer, a Uint8Array,
 * or `{ data: base64 }`. Returns null when there is nothing usable, which the caller turns into a
 * 400 — or, on a serverless host, an attempt to read the request stream directly.
 */
export function coercePptxRequestBytes(rawBody: unknown): Uint8Array | null {
  if (Buffer.isBuffer(rawBody)) return rawBody.byteLength ? new Uint8Array(rawBody) : null;
  if (rawBody instanceof Uint8Array) return rawBody.byteLength ? rawBody : null;
  if (rawBody instanceof ArrayBuffer) {
    return rawBody.byteLength ? new Uint8Array(rawBody) : null;
  }
  if (rawBody && typeof rawBody === 'object' && 'data' in rawBody) {
    const data = (rawBody as { data?: unknown }).data;
    if (typeof data === 'string' && data.length) {
      const decoded = Buffer.from(data, 'base64');
      return decoded.byteLength ? new Uint8Array(decoded) : null;
    }
  }
  return null;
}

/**
 * Convert raw PPTX body → PDF bytes (base64 JSON) for the browser PDF pipeline.
 * Expects `express.raw` body (Buffer), a Uint8Array, or `{ data: base64 }`, and optional
 * `?filename=`. `diagnostics` describes what a serverless host actually delivered, so a 400 says
 * why rather than only that it happened.
 */
export async function handlePptxToPdfRequest(
  rawBody: unknown,
  filenameHint = 'presentation.pptx',
  deps: PptxConvertDeps = {},
  diagnostics?: string
): Promise<ApiResult> {
  try {
    const bytes = coercePptxRequestBytes(rawBody);

    if (!bytes || bytes.byteLength === 0) {
      return {
        status: 400,
        body: {
          error: `Request must include raw PPTX bytes or { data: base64 }.${
            diagnostics ? ` Received ${diagnostics}.` : ''
          }`,
        },
      };
    }

    // Checked before init: without this the loader fails deep inside the worker and the caller gets
    // a 500 with a stack-trace message, which the browser then reports as a generic conversion
    // failure. A 503 naming the cause is what lets the client say something a user can act on.
    if (!(deps.wasmAvailable ?? libreOfficeWasmAvailable)()) {
      return { status: 503, body: { error: UNAVAILABLE_MESSAGE } };
    }

    const result = await (deps.convert ?? convertPptxBufferToPdf)(bytes, filenameHint);
    return {
      status: 200,
      body: {
        pdfBase64: Buffer.from(result.data).toString('base64'),
        filename: result.filename,
        durationMs: result.duration,
      },
    };
  } catch (error) {
    console.error('[LibreOffice WASM] PPTX→PDF failed:', error);
    return errorResult(error);
  }
}
