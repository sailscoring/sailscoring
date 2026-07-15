// @vitest-environment node

/**
 * Ranking handlers (#209): the public-URL slug rules on `putRanking` against
 * a real Postgres — choosable while the ranking is private (format and
 * per-workspace uniqueness enforced), frozen once published. Skipped when
 * DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRanking, putRanking } from '@/lib/api-handlers/rankings';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import type { RankingConfig } from '@/lib/ranking';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('putRanking slug rules (#209)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let orgId: string;
  const slug = `rank-${uuid().slice(0, 8)}`;

  const ctx = (): WorkspaceContext => ({
    userId: 'usr_x',
    email: 'x@sailscoring.test',
    workspaceId: orgId,
    workspaceSlug: slug,
    role: 'owner',
    features: ['rankings'],
  });

  const config: RankingConfig = {
    buckets: [
      { id: 'b1', name: 'All', seriesIds: [], countBest: 1, requiredMin: 1 },
    ],
  };

  const update = (over: {
    published?: boolean;
    slug?: string;
    name?: string;
  }) => ({
    name: over.name ?? 'Season Ladder',
    config,
    published: over.published ?? false,
    ...(over.slug !== undefined ? { slug: over.slug } : {}),
  });

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    orgId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: orgId,
      name: 'Slug Rules Club',
      slug,
      createdAt: new Date(),
      metadata: null,
    });
  });

  afterAll(async () => {
    if (orgId)
      await db
        .delete(schema.organization)
        .where(eq(schema.organization.id, orgId));
    await sql?.end();
  });

  test('a private ranking can choose its slug; publish freezes it', async () => {
    const created = await createRanking(ctx(), { name: 'Season Ladder' });
    expect(created.slug).toBeTruthy();

    const renamed = await putRanking(
      ctx(),
      created.id,
      update({ slug: 'junior-ladder' }),
    );
    expect(renamed.slug).toBe('junior-ladder');

    const published = await putRanking(
      ctx(),
      created.id,
      update({ published: true, slug: 'junior-ladder' }),
    );
    expect(published.published).toBe(true);

    // Resubmitting the unchanged slug is a no-op, not a violation…
    await putRanking(
      ctx(),
      created.id,
      update({ published: true, slug: 'junior-ladder' }),
    );
    // …but changing it while published is rejected.
    await expect(
      putRanking(ctx(), created.id, update({ published: true, slug: 'other' })),
    ).rejects.toThrow(/fixed while the ranking is published/);

    // Unpublishing unfreezes it again.
    await putRanking(ctx(), created.id, update({ published: false }));
    const rechosen = await putRanking(
      ctx(),
      created.id,
      update({ slug: 'senior-ladder' }),
    );
    expect(rechosen.slug).toBe('senior-ladder');
  });

  test('slug format and per-workspace uniqueness are enforced', async () => {
    const a = await createRanking(ctx(), { name: 'Ladder A' });
    const b = await createRanking(ctx(), { name: 'Ladder B' });

    await expect(
      putRanking(ctx(), a.id, update({ name: 'Ladder A', slug: 'Bad Slug!' })),
    ).rejects.toThrow(/invalid slug/);

    await putRanking(ctx(), a.id, update({ name: 'Ladder A', slug: 'taken' }));
    await expect(
      putRanking(ctx(), b.id, update({ name: 'Ladder B', slug: 'taken' })),
    ).rejects.toThrow(/already uses that slug/);
  });
});
