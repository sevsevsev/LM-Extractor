import { getApiKey } from '../server/apiCore.js';
import type { FnRequest, FnResponse } from '../server/fnTypes.js';

export default function handler(_req: FnRequest, res: FnResponse): void {
  res.status(200).json({
    ok: true,
    configured: Boolean(getApiKey()),
    mode: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
  });
}
