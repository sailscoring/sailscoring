import 'server-only';
import { lt } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

/**
 * The Idempotency-Key replay window only needs to cover client retries of
 * a single in-flight request — autosave/finish-entry retries happen within
 * seconds. An hour is well past that and leaves a wide safety margin for
 * cron jitter. The daily sweep deletes anything older.
 */
export const IDEMPOTENCY_TTL_MS = 60 * 60 * 1000;

export async function sweepIdempotency(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_TTL_MS);
  const result = await getDb()
    .delete(schema.idempotencyKeys)
    .where(lt(schema.idempotencyKeys.createdAt, cutoff))
    .returning({ key: schema.idempotencyKeys.key });
  return result.length;
}
