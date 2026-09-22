import type { FnRequest } from './fnTypes.js';

/**
 * Read a serverless request's body as bytes when the platform did not parse it for us.
 *
 * Vercel's Node helpers parse `req.body` by content type and return `undefined` for anything that
 * is not JSON, form-urlencoded, text or `application/octet-stream`. A PPTX upload sent under its
 * own OOXML content type therefore arrived as no body at all, and the convert route answered 400
 * before LibreOffice was ever reached — the failure Severin's hosted run hit on 2026-09-22, where
 * every deck fell back to text-only.
 *
 * The client now sends `application/octet-stream`, so `req.body` is a Buffer on the platforms that
 * parse it. This is the backstop for the ones that do not: an unconsumed request is an async
 * iterable of chunks. If the platform already drained the stream, this yields nothing and the
 * caller reports a 400 that names what it did receive.
 */
export async function readRawRequestBody(req: FnRequest): Promise<Uint8Array | null> {
  const iterable = req as unknown as AsyncIterable<Uint8Array | string>;
  if (typeof (iterable as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== 'function') {
    return null;
  }
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of iterable) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk));
    }
  } catch {
    return null;
  }
  if (!chunks.length) return null;
  const joined = Buffer.concat(chunks);
  return joined.byteLength ? new Uint8Array(joined) : null;
}

/** What the handler actually received, for a 400 that diagnoses itself. */
export function describeReceivedBody(req: FnRequest): string {
  const headers = (req as { headers?: Record<string, unknown> }).headers ?? {};
  const contentType = headers['content-type'] ?? headers['Content-Type'];
  const bodyType = req.body === undefined ? 'undefined' : req.body === null ? 'null' : typeof req.body;
  return `content-type ${JSON.stringify(contentType ?? 'none')}, body ${bodyType}`;
}
