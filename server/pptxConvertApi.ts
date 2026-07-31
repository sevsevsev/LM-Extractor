import type { IncomingMessage } from 'http';
import { convertPptxBufferToPdf } from './libreOfficeConverter.js';
import type { ApiResult } from './apiCore.js';

function errorResult(error: unknown): ApiResult {
  const message = error instanceof Error ? error.message : 'Unknown server error';
  return { status: 500, body: { error: message } };
}

/**
 * Convert raw PPTX body → PDF bytes (base64 JSON) for the browser PDF pipeline.
 * Expects `express.raw` body (Buffer) and optional `?filename=`.
 */
export async function handlePptxToPdfRequest(
  rawBody: unknown,
  filenameHint = 'presentation.pptx'
): Promise<ApiResult> {
  try {
    let bytes: Uint8Array | null = null;

    if (Buffer.isBuffer(rawBody)) {
      bytes = new Uint8Array(rawBody);
    } else if (rawBody instanceof Uint8Array) {
      bytes = rawBody;
    } else if (rawBody && typeof rawBody === 'object' && 'data' in rawBody) {
      const data = (rawBody as { data?: unknown }).data;
      if (typeof data === 'string') {
        bytes = new Uint8Array(Buffer.from(data, 'base64'));
      }
    }

    if (!bytes || bytes.byteLength === 0) {
      return {
        status: 400,
        body: { error: 'Request must include raw PPTX bytes or { data: base64 }.' },
      };
    }

    const result = await convertPptxBufferToPdf(bytes, filenameHint);
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

/** Read raw body from a Node IncomingMessage when not using express.raw. */
export async function readRawBody(req: IncomingMessage, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limitBytes) {
      throw new Error(`Request body exceeds ${limitBytes} bytes.`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
