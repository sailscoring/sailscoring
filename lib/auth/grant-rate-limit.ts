import 'server-only';
import { sql } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { rateLimit } from '@/lib/db/schema/auth';

/**
 * Per-grant rate limits for calls made with an OAuth access token (ADR-016
 * §4): an app, for one user, gets so many calls a minute, wherever they come
 * from. A fixed window, counted in Better Auth's `rate_limit` table under
 * keys of our own (`oauth-grant:…`), so the count holds across function
 * instances as the sign-in limits do.
 *
 * The CLI's ceiling is far higher, for the bulk imports it exists for; an
 * outside app's is generous for an app polling or writing a race day, and
 * low enough to catch a runaway loop.
 */

const WINDOW_MS = 60_000;
export const APP_CALLS_PER_MINUTE = 120;
export const CLI_CALLS_PER_MINUTE = 1200;

/** Seconds until the caller may try again, when this call is over the limit;
 *  null when it's allowed. Counts the call either way. */
export async function consumeGrantRateLimit(
  grant: { clientId: string; userId: string; firstParty: boolean },
  now = Date.now(),
): Promise<number | null> {
  // The e2e suite's switch for the sign-in limits applies here too.
  if (process.env.E2E_DISABLE_RATE_LIMIT === '1') return null;
  const key = `oauth-grant:${grant.clientId}:${grant.userId}`;
  const windowStart = now - WINDOW_MS;
  const [row] = await getDb()
    .insert(rateLimit)
    .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      // `last_request` holds the start of the current window here.
      set: {
        count: sql`case when ${rateLimit.lastRequest} < ${windowStart} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when ${rateLimit.lastRequest} < ${windowStart} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning({ count: rateLimit.count, windowStartedAt: rateLimit.lastRequest });
  const max = grant.firstParty ? CLI_CALLS_PER_MINUTE : APP_CALLS_PER_MINUTE;
  if (row.count <= max) return null;
  return Math.max(1, Math.ceil((row.windowStartedAt + WINDOW_MS - now) / 1000));
}
