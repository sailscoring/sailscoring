// @vitest-environment node

/**
 * Rate-limit guard for the magic-link send endpoint. Configured in
 * lib/auth.ts at 5 sends / 600s per IP, backed by the Postgres
 * `rate_limit` table (Better Auth's database-backed limiter).
 *
 * Skipped when DATABASE_URL is unset, or when the E2E server-mode
 * opt-out is on (which the same lib/auth.ts config respects).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { auth } from '@/lib/auth';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL || process.env.E2E_DISABLE_RATE_LIMIT === '1';

describe.skipIf(skip)('magic-link rate limiting', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const cleanupKeys: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    for (const key of cleanupKeys) {
      await db.delete(schema.rateLimit).where(eq(schema.rateLimit.key, key));
    }
    await sql?.end();
  });

  // 10.0.0.0/8 is private — guaranteed not to collide with real
  // forwarded IPs. A unique IP per test isolates the test from any
  // rate-limit rows left by a prior run.
  function uniqueIp(): string {
    const a = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const c = Math.floor(Math.random() * 256);
    const ip = `10.${a}.${b}.${c}`;
    cleanupKeys.push(`${ip}|/sign-in/magic-link`);
    return ip;
  }

  async function postMagicLink(ip: string, email: string): Promise<Response> {
    return auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify({ email, callbackURL: '/' }),
      }),
    );
  }

  test('returns 429 once an IP exceeds the cap', async () => {
    const ip = uniqueIp();
    const email = `rl-${Date.now()}@sailscoring.test`;

    for (let i = 0; i < 5; i++) {
      const res = await postMagicLink(ip, email);
      expect(res.status, `request ${i + 1} of 5`).not.toBe(429);
    }

    const blocked = await postMagicLink(ip, email);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { message?: string };
    expect(body.message).toMatch(/too many/i);
  });

  test('the limit is per-IP, so a different client is unaffected', async () => {
    const ipA = uniqueIp();
    const ipB = uniqueIp();
    const email = `rl-iso-${Date.now()}@sailscoring.test`;

    for (let i = 0; i < 5; i++) await postMagicLink(ipA, email);
    expect((await postMagicLink(ipA, email)).status).toBe(429);

    expect((await postMagicLink(ipB, email)).status).not.toBe(429);
  });
});
