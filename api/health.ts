import { getApiKey } from '../server/apiCore';
import type { FnRequest, FnResponse } from './_types';

export default function handler(_req: FnRequest, res: FnResponse): void {
  res.status(200).json({
    ok: true,
    configured: Boolean(getApiKey()),
    mode: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
  });
}
