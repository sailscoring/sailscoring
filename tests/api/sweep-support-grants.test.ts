// @vitest-environment node

/**
 * The hourly support-grant sweep route: locked to Vercel's cron secret, and
 * when it runs it closes exactly the grants whose time is up. The lifecycle
 * itself is covered in tests/db/support-grants.test.ts; this exercises the
 * route around it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { GET } from '@/app/api/cron/sweep-support-grants/route';
import { joinAsSupport } from '@/lib/support-grants';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const originalSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

function request(authorization?: string): Request {
  return new Request('http://localhost/api/cron/sweep-support-grants', {
    headers: authorization ? { authorization } : {},
  });
}

describe('sweep-support-grants route: access', () => {
  test('503 when CRON_SECRET is unset, so a misconfigured deploy is loudly broken', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(request('Bearer anything'));
    expect(res.status).toBe(503);
  });

  test('401 without the cron bearer token', async () => {
    process.env.CRON_SECRET = 'sweep-test-secret';
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('Bearer wrong'))).status).toBe(401);
  });
});

describe.skipIf(skip)('sweep-support-grants route: sweeping', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    const stamp = crypto.randomUUID().replace(/-/g, '');
    orgId = `org_${stamp}`;
    userId = `usr_${stamp}`;
    await db.insert(schema.organization).values({
      id: orgId,
      name: 'sweep route',
      slug: `sweep-route-${stamp.slice(0, 8)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.user).values({
      id: userId,
      name: 'Sweep Route',
      email: `sweep-route-${stamp.slice(0, 8)}@sailscoring.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, userId));
    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));
    await sql?.end();
  });

  test('closes an overdue grant and reports it', async () => {
    process.env.CRON_SECRET = 'sweep-test-secret';
    const [{ email }] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    // Granted two hours ago for one hour: due.
    await joinAsSupport(db, {
      orgSlugOrId: orgId,
      email,
      hours: 1,
      now: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    const res = await GET(request('Bearer sweep-test-secret'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      released: number;
      grants: Array<{ workspace: string; user: string; how: string }>;
    };
    expect(body.released).toBeGreaterThanOrEqual(1);
    expect(body.grants).toContainEqual({
      workspace: `sweep-route-${orgId.slice(4, 12)}`,
      user: email,
      how: 'expired',
    });

    const remaining = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(eq(schema.member.organizationId, orgId));
    expect(remaining).toHaveLength(0);
  });
});
