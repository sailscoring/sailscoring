import { getDb } from '@/lib/db/client';
import { sweepExpiredSupportGrants } from '@/lib/support-grants';

export const dynamic = 'force-dynamic';

/**
 * Hourly Vercel cron closing support grants whose time is up, so that
 * `support join --hours 24` means 24 hours whether or not anyone remembers
 * to leave. Schedule lives in `vercel.json`. Vercel injects
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
  const closed = await sweepExpiredSupportGrants(getDb());
  return Response.json({
    released: closed.length,
    grants: closed.map(({ grant, how }) => ({
      workspace: grant.org.slug,
      user: grant.user.email,
      how,
    })),
  });
}
