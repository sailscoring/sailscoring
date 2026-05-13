import { sweepIdempotency } from '@/lib/api-handlers/sweep-idempotency';

export const dynamic = 'force-dynamic';

/**
 * Daily Vercel cron to bound `idempotency_keys` (issue #126). Schedule lives
 * in `vercel.json`. Vercel injects `Authorization: Bearer ${CRON_SECRET}` on
 * scheduled invocations; we reject any other caller so the endpoint can't be
 * used to force load on the DB from outside.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: 'cron-secret-missing' },
      { status: 503 },
    );
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const deleted = await sweepIdempotency();
  return Response.json({ deleted });
}
