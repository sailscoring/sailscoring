// @vitest-environment node

/**
 * Per-grant rate limits for OAuth access tokens (ADR-016 §4).
 *
 * Skipped when DATABASE_URL is unset; CI provides it.
 */
import { afterAll, describe, expect, test } from 'vitest';
import { like } from 'drizzle-orm';

import { APP_CALLS_PER_MINUTE, consumeGrantRateLimit } from '@/lib/auth/grant-rate-limit';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('per-grant rate limits', () => {
  const clientId = `rate-test-${crypto.randomUUID()}`;

  afterAll(async () => {
    await getDb().delete(schema.rateLimit).where(like(schema.rateLimit.key, `oauth-grant:${clientId}:%`));
  });

  test('an app is allowed its calls a minute, then told how long to wait', async () => {
    const grant = { clientId, userId: 'u1', firstParty: false };
    const start = 1_000_000_000_000;
    for (let i = 0; i < APP_CALLS_PER_MINUTE; i++) {
      expect(await consumeGrantRateLimit(grant, start + i)).toBeNull();
    }
    expect(await consumeGrantRateLimit(grant, start + 20_000)).toBe(40);
    // Another user of the same app has a count of their own.
    expect(await consumeGrantRateLimit({ ...grant, userId: 'u2' }, start + 20_000)).toBeNull();
    // A new window starts afresh.
    expect(await consumeGrantRateLimit(grant, start + 61_000)).toBeNull();
  });

  test('the CLI’s ceiling is far higher', async () => {
    const cli = { clientId, userId: 'cli-user', firstParty: true };
    const start = 2_000_000_000_000;
    for (let i = 0; i <= APP_CALLS_PER_MINUTE; i++) await consumeGrantRateLimit(cli, start + i);
    expect(await consumeGrantRateLimit(cli, start + 500)).toBeNull();
  });
});
