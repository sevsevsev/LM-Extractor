import { handleCritiqueRequest } from '../../server/apiCore';
import type { FnRequest, FnResponse } from '../_types';

export default async function handler(req: FnRequest, res: FnResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const result = await handleCritiqueRequest(req.body);
  res.status(result.status).json(result.body);
}
