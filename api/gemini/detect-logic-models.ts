import { handleDetectLogicModelGroupsRequest } from '../../server/apiCore.js';
import type { FnRequest, FnResponse } from '../../server/fnTypes.js';

/** POST body: `{ previewImages, textTrack, sourceFormat }` (see DetectLogicModelGroupsInput). */
export default async function handler(req: FnRequest, res: FnResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const result = await handleDetectLogicModelGroupsRequest(req.body);
  res.status(result.status).json(result.body);
}
