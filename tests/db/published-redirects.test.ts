/**
 * The static public-URL redirect table (ADR-011): operator-maintained rows
 * the `/p/` route consults only after everything else 404s. Route wiring is
 * a thin 301; the lookup contract is what's worth pinning here.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { getPublishedRedirect } from '@/lib/published-repository';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('published redirects', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_redir_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'redirects-test',
      slug: `redir-${workspaceId.slice(10, 18)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  test('looks up a moved path, missing paths return null', async () => {
    await db.insert(schema.publishedRedirects).values({
      workspaceId,
      fromPath: '2026-westerns/standings',
      toPath: '2026/westerns/standings',
    });
    expect(
      await getPublishedRedirect(workspaceId, '2026-westerns/standings'),
    ).toBe('2026/westerns/standings');
    expect(await getPublishedRedirect(workspaceId, '2026-westerns')).toBeNull();
  });

  test('one row per (workspace, from-path); an upsert re-targets it', async () => {
    await db
      .insert(schema.publishedRedirects)
      .values({ workspaceId, fromPath: 'old', toPath: 'new-a' })
      .onConflictDoUpdate({
        target: [
          schema.publishedRedirects.workspaceId,
          schema.publishedRedirects.fromPath,
        ],
        set: { toPath: 'new-a' },
      });
    await db
      .insert(schema.publishedRedirects)
      .values({ workspaceId, fromPath: 'old', toPath: 'new-b' })
      .onConflictDoUpdate({
        target: [
          schema.publishedRedirects.workspaceId,
          schema.publishedRedirects.fromPath,
        ],
        set: { toPath: 'new-b' },
      });
    expect(await getPublishedRedirect(workspaceId, 'old')).toBe('new-b');
  });
});
