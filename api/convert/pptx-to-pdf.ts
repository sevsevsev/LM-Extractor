import {
  handlePptxToPdfRequest,
  handlePptxConvertProbeRequest,
  coercePptxRequestBytes,
} from '../../server/pptxConvertApi.js';
import { readRawRequestBody, describeReceivedBody } from '../../server/rawBody.js';
import type { FnRequest, FnResponse } from '../../server/fnTypes.js';

/**
 * Vercel/serverless PPTX→PDF via LibreOffice WASM.
 *
 * The ~237MB of WASM this needs is only present if vercel.json's `includeFiles` puts it in this
 * function's bundle — nothing imports those files by path, so tracing alone leaves them out and
 * every conversion fails. `GET` on this same route reports whether they made it.
 */
export default async function handler(req: FnRequest, res: FnResponse): Promise<void> {
  if (req.method === 'GET') {
    const probe = handlePptxConvertProbeRequest();
    res.status(probe.status).json(probe.body);
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const filename =
    typeof req.query?.filename === 'string' ? req.query.filename : 'presentation.pptx';

  // The host parses the body by content type and leaves it `undefined` for the ones it does not
  // know. Take what it parsed if there is anything usable, and otherwise read the request stream
  // ourselves rather than reporting an empty upload the client cannot explain.
  const parsed = coercePptxRequestBytes(req.body);
  const bytes = parsed ?? (await readRawRequestBody(req));

  const result = await handlePptxToPdfRequest(bytes, filename, {}, describeReceivedBody(req));
  res.status(result.status).json(result.body);
}
