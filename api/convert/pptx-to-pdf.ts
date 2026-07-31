import { handlePptxToPdfRequest } from '../../server/pptxConvertApi.js';
import type { FnRequest, FnResponse } from '../../server/fnTypes.js';

/**
 * Vercel/serverless PPTX→PDF via LibreOffice WASM.
 * Note: cold start + ~250MB WASM may exceed typical serverless limits; prefer local Express.
 */
export default async function handler(req: FnRequest, res: FnResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const filename =
    typeof req.query?.filename === 'string' ? req.query.filename : 'presentation.pptx';
  const result = await handlePptxToPdfRequest(req.body, filename);
  res.status(result.status).json(result.body);
}
