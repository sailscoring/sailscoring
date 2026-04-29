import 'server-only';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

/**
 * Idempotency-Key support. Phase 5 wraps every write endpoint to look
 * up the key before invoking the handler, and to write the response on
 * the way out. The structure landed in PR #1's schema; this is the
 * library code that uses it.
 *
 * TTL cleanup is deferred (cron in Phase 4 territory).
 */

export const IDEMPOTENCY_HEADER = 'idempotency-key';

export interface IdempotencyHit {
  status: number;
  body: unknown;
}

export async function lookupIdempotency(
  workspaceId: string,
  key: string,
): Promise<IdempotencyHit | null> {
  const [row] = await getDb()
    .select({ status: schema.idempotencyKeys.status, body: schema.idempotencyKeys.body })
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.workspaceId, workspaceId),
        eq(schema.idempotencyKeys.key, key),
      ),
    )
    .limit(1);
  return row ? { status: row.status, body: row.body } : null;
}

export async function storeIdempotency(
  workspaceId: string,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await getDb()
    .insert(schema.idempotencyKeys)
    .values({ workspaceId, key, status, body })
    .onConflictDoNothing();
}

export function readIdempotencyKey(req: { headers: Headers }): string | null {
  const v = req.headers.get(IDEMPOTENCY_HEADER);
  return v && v.trim().length > 0 ? v.trim() : null;
}
