import { sweepDeletedSeries } from '@/lib/deleted-series';

export const dynamic = 'force-dynamic';

/**
 * Daily Vercel cron purging soft-deleted series past the retention window
 * ("Recover a deleted series"). Schedule lives in `vercel.json`. Vercel injects
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
  const purged = await sweepDeletedSeries();
  return Response.json({ purged });
}
