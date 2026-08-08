// @vitest-environment node

/**
 * Session lifetime guard. `lib/auth.ts` sets `session.expiresIn` to 90 days
 * so a scorer who uses a machine one evening a week isn't found lapsed on
 * race night.
 *
 * This exists because the original 7-day lifetime was never a decision — it
 * was Better Auth's default, in force because no `session` block existed and
 * nothing asserted otherwise. Both halves are checked: the session row the
 * server keeps, and the cookie Max-Age the browser honours. They come from
 * the same config value, and a drift between them would sign users out with
 * a live session still on record.
 *
 * Skipped when DATABASE_URL is unset; CI provides it. Locally run with
 * `pnpm test:unit:db tests/auth/session-lifetime.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, like } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { auth } from '@/lib/auth';

const DATABASE_URL = process.env.DATABASE_URL;

const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

describe.skipIf(!DATABASE_URL)('session lifetime', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  const cleanupEmails: string[] = [];
  const cleanupRateLimitKeys: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    // Signing up would otherwise seed the two sample series into the new
    // personal workspace — irrelevant here and slow.
    process.env.E2E_DISABLE_SAMPLE_SEED = '1';
  });

  afterAll(async () => {
    for (const email of cleanupEmails) {
      const [row] = await db
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);
      if (row) {
        // session + member cascade from the user row; the personal workspace
        // the sign-up hook creates does not, so clear it by membership first.
        const memberships = await db
          .select({ organizationId: schema.member.organizationId })
          .from(schema.member)
          .where(eq(schema.member.userId, row.id));
        await db.delete(schema.user).where(eq(schema.user.id, row.id));
        for (const m of memberships) {
          await db
            .delete(schema.organization)
            .where(eq(schema.organization.id, m.organizationId));
        }
      }
      await db
        .delete(schema.verification)
        .where(like(schema.verification.value, `%${email}%`));
    }
    for (const key of cleanupRateLimitKeys) {
      await db.delete(schema.rateLimit).where(eq(schema.rateLimit.key, key));
    }
    await sql?.end();
  });

  /** 10.0.0.0/8 is private, so a per-test address can't collide with a real
   *  forwarded IP or with rate-limit rows left by an earlier run. */
  function uniqueIp(): string {
    const octet = () => Math.floor(Math.random() * 256);
    const ip = `10.${octet()}.${octet()}.${octet()}`;
    cleanupRateLimitKeys.push(`${ip}|/sign-in/magic-link`);
    cleanupRateLimitKeys.push(`${ip}|/magic-link/verify`);
    return ip;
  }

  /** Full magic-link sign-in: request a link, read the token straight out of
   *  `verification` (the plugin stores it unhashed by default), verify it. */
  async function signIn(email: string, ip: string): Promise<Response> {
    const sent = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email, callbackURL: '/' }),
      }),
    );
    expect(sent.status).toBe(200);

    const [row] = await db
      .select({ identifier: schema.verification.identifier })
      .from(schema.verification)
      .where(like(schema.verification.value, `%${email}%`))
      .limit(1);
    expect(row, 'magic-link token was not stored').toBeDefined();

    return auth.handler(
      new Request(
        `http://localhost:3000/api/auth/magic-link/verify?token=${row.identifier}&callbackURL=/`,
        { headers: { 'x-forwarded-for': ip } },
      ),
    );
  }

  test('a new session lasts 90 days, on the row and in the cookie', async () => {
    const email = `lifetime-${Date.now()}@sailscoring.test`;
    cleanupEmails.push(email);
    const signedInAt = Date.now();

    const res = await signIn(email, uniqueIp());
    expect(res.status).toBe(302);

    // The cookie the browser honours.
    const setCookie = res.headers.get('set-cookie') ?? '';
    const maxAge = /session_token=[^;]*;[^,]*?Max-Age=(\d+)/i.exec(setCookie);
    expect(maxAge, `no session cookie in: ${setCookie}`).not.toBeNull();
    expect(Number(maxAge![1])).toBe(NINETY_DAYS_SECONDS);

    // The row the server trusts. Allow a minute of slack for test runtime.
    const [user] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email))
      .limit(1);
    expect(user).toBeDefined();

    const [session] = await db
      .select({ expiresAt: schema.session.expiresAt })
      .from(schema.session)
      .where(eq(schema.session.userId, user.id))
      .limit(1);
    expect(session).toBeDefined();

    // `signedInAt` is stamped before the request, so the measured lifetime
    // runs a little long by however much the sign-in took.
    const lifetimeSeconds = (session.expiresAt.getTime() - signedInAt) / 1000;
    expect(lifetimeSeconds).toBeGreaterThan(NINETY_DAYS_SECONDS - 60);
    expect(lifetimeSeconds).toBeLessThan(NINETY_DAYS_SECONDS + 60);
  });
});
