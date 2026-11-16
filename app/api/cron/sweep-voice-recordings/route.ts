import { sweepExpiredRecordings } from '@/lib/voice/server/recording-store';

export const dynamic = 'force-dynamic';

/**
 * Daily Vercel cron deleting voice recordings past their retention date
 * (ADR-017): what was said on the committee boat is kept for a stated time
 * and no longer. Schedule lives in `vercel.json`. Vercel injects
 * `Authorization: Bearer ${CRON_SECRET}` on scheduled invocations; any other
 * caller is rejected so the endpoint can't be used to force DB load from
 * outside.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: 'cron-secret-missing' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const deleted = await sweepExpiredRecordings();
  return Response.json({ deleted });
}
