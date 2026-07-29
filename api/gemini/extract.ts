import { handleExtractRequest } from '../../server/apiCore.js';
import type { FnRequest, FnResponse } from '../../server/fnTypes.js';

export default async function handler(req: FnRequest, res: FnResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const result = await handleExtractRequest(req.body);
  res.status(result.status).json(result.body);
}
