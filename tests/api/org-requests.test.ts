// @vitest-environment node

/**
 * Self-service org-creation request handlers (#153, iteration 3). Drives the
 * handlers against a real Postgres: submit, the one-open-request rule, and the
 * caller's latest-request lookup. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { getMyOrgRequest, submitOrgRequest } from '@/lib/api-handlers/org-requests';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('org-creation requests (#153)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let userId: string;
  const email = `req-${uuid()}@sailscoring.test`;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    userId = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values({
      id: userId,
      name: 'Requester',
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
    await sql?.end();
  });

  test('submit records a pending request and surfaces it to the requester', async () => {
    const actor = { userId, email };
    expect((await getMyOrgRequest(userId)).request).toBeNull();

    const created = await submitOrgRequest(actor, {
      requestedName: 'Howth YC Panel',
      note: 'Cruiser series scoring panel',
    });
    expect(created).toMatchObject({
      requestedName: 'Howth YC Panel',
      note: 'Cruiser series scoring panel',
      status: 'pending',
    });

    const { request } = await getMyOrgRequest(userId);
    expect(request?.id).toBe(created.id);
    expect(request?.status).toBe('pending');
  });

  test('a second request while one is pending is rejected', async () => {
    await expect(
      submitOrgRequest({ userId, email }, { requestedName: 'Another One' }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('validation rejects an empty name', async () => {
    // Clear the pending row so the validation error, not the one-pending rule,
    // is what fires.
    await db.delete(schema.orgRequest).where(eq(schema.orgRequest.userId, userId));
    await expect(
      submitOrgRequest({ userId, email }, { requestedName: '   ' }),
    ).rejects.toThrow();
  });
});
