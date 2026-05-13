// @vitest-environment node

/**
 * Issue #126: daily sweep keeps `idempotency_keys` bounded by deleting
 * rows older than the replay window. Also exercises the new FK by
 * confirming an org delete cascades.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import {
  IDEMPOTENCY_TTL_MS,
  sweepIdempotency,
} from '@/lib/api-handlers/sweep-idempotency';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('sweepIdempotency', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_sweep_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'sweep',
      slug: `sweep-${workspaceId.slice(10, 18)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('deletes rows older than the TTL and leaves fresh rows alone', async () => {
    const now = new Date();
    const oldKey = `old-${uuid()}`;
    const freshKey = `fresh-${uuid()}`;

    await db.insert(schema.idempotencyKeys).values([
      {
        workspaceId,
        key: oldKey,
        status: 200,
        body: { stale: true },
        createdAt: new Date(now.getTime() - IDEMPOTENCY_TTL_MS - 60_000),
      },
      {
        workspaceId,
        key: freshKey,
        status: 200,
        body: { stale: false },
        createdAt: new Date(now.getTime() - 30_000),
      },
    ]);

    const deleted = await sweepIdempotency(now);
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await db
      .select({ key: schema.idempotencyKeys.key })
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.workspaceId, workspaceId));
    const keys = remaining.map((r) => r.key);
    expect(keys).toContain(freshKey);
    expect(keys).not.toContain(oldKey);

    await db
      .delete(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.workspaceId, workspaceId),
          eq(schema.idempotencyKeys.key, freshKey),
        ),
      );
  });

  test('deleting an organization cascades to its idempotency rows', async () => {
    const orgId = `org_casc_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: orgId,
      name: 'cascade',
      slug: `cascade-${orgId.slice(9, 17)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.idempotencyKeys).values({
      workspaceId: orgId,
      key: `k-${uuid()}`,
      status: 204,
      body: null,
    });

    await db.delete(schema.organization).where(eq(schema.organization.id, orgId));

    const remaining = await db
      .select({ key: schema.idempotencyKeys.key })
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.workspaceId, orgId));
    expect(remaining).toHaveLength(0);
  });
});
