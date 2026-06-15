// @vitest-environment node

/**
 * `clear-idempotency` removes Idempotency-Key replay rows for a workspace so a
 * re-import of a byte-identical file runs fresh rather than replaying a dead
 * series id. Resolves the workspace by slug or id; --key narrows to one row.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { clearIdempotency } from '@/scripts/clear-idempotency';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

describe.skipIf(skip)('clearIdempotency', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  let slug!: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_clr_${uuid()}`;
    slug = `clr-${workspaceId.slice(8, 16)}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'clear-idem',
      slug,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function seed(keys: string[]) {
    await db.insert(schema.idempotencyKeys).values(
      keys.map((key) => ({ workspaceId, key, status: 200, body: { id: key } })),
    );
  }

  async function remaining(): Promise<string[]> {
    const rows = await db
      .select({ key: schema.idempotencyKeys.key })
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.workspaceId, workspaceId));
    return rows.map((r) => r.key);
  }

  test('clears all rows for a workspace resolved by slug', async () => {
    await seed(['a', 'b', 'c']);
    const { cleared, workspaceId: resolved } = await clearIdempotency(db, {
      workspaceSlugOrId: slug,
    });
    expect(resolved).toBe(workspaceId);
    expect(cleared).toBe(3);
    expect(await remaining()).toEqual([]);
  });

  test('clears a single row when --key is given, resolved by id', async () => {
    await seed(['keep-1', 'drop-1', 'keep-2']);
    const { cleared } = await clearIdempotency(db, {
      workspaceSlugOrId: workspaceId,
      key: 'drop-1',
    });
    expect(cleared).toBe(1);
    expect((await remaining()).sort()).toEqual(['keep-1', 'keep-2']);
    await db.delete(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.workspaceId, workspaceId));
  });

  test('throws for an unknown workspace', async () => {
    await expect(
      clearIdempotency(db, { workspaceSlugOrId: 'no-such-workspace' }),
    ).rejects.toThrow(/not found/);
  });
});
