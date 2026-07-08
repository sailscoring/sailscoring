// @vitest-environment node

/**
 * Integration test for `seedFeatureSample` — the on-enable feature demo seeding
 * (see `setWorkspaceFeature`). Focuses on the sub-series sample, since it is the
 * one that exercises the seed adapter's full sub-series persistence (fleet
 * scoping, per-fleet race exclusions, DNC handling, and the two-pass
 * `continueFrom` write). Skipped when DATABASE_URL is unset; runs against the
 * local/CI Postgres.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { seedFeatureSample } from '@/lib/sample-series/seed';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('seedFeatureSample', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_fsseed_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Feature Sample Seed Test',
      slug: `f-${workspaceId.slice(11, 21)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('seeds the sub-series demo, grouped under a "Samples" category', async () => {
    const seeded = await seedFeatureSample('sub-series', workspaceId, db);
    expect(seeded).toBe(true);

    const [series] = await db
      .select()
      .from(schema.series)
      .where(
        and(
          eq(schema.series.workspaceId, workspaceId),
          eq(schema.series.name, 'Sample Club League 2026'),
        ),
      );
    expect(series).toBeDefined();

    const [cat] = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, workspaceId));
    expect(cat.name).toBe('Samples');
    expect(series.categoryId).toBe(cat.id);
  });

  test('persists the full sub-series shape the adapter used to drop', async () => {
    const [series] = await db
      .select({ id: schema.series.id })
      .from(schema.series)
      .where(
        and(
          eq(schema.series.workspaceId, workspaceId),
          eq(schema.series.name, 'Sample Club League 2026'),
        ),
      );

    const rows = await db
      .select()
      .from(schema.subSeries)
      .where(eq(schema.subSeries.seriesId, series.id))
      .orderBy(schema.subSeries.displayOrder);
    expect(rows.map((r) => r.name)).toEqual([
      'Season Overall',
      'Spring Series',
      'Summer Series',
      'Cruisers 1 Championship',
    ]);

    const spring = rows.find((r) => r.name === 'Spring Series')!;
    const summer = rows.find((r) => r.name === 'Summer Series')!;
    const champ = rows.find((r) => r.name === 'Cruisers 1 Championship')!;

    // Fleet scoping round-trips (one fleet id) on the championship only.
    expect(champ.fleetIds).toHaveLength(1);
    expect(summer.fleetIds).toBeNull();
    // excludeDncOnlyCompetitors round-trips: true on the blocks, false on Overall.
    expect(spring.excludeDncOnlyCompetitors).toBe(true);
    expect(rows.find((r) => r.name === 'Season Overall')!.excludeDncOnlyCompetitors).toBe(false);
    // The two-pass write patched continueFrom to Spring's *minted* id.
    expect(summer.startingHandicapSource).toBe('continue');
    expect(summer.continueFromSubSeriesId).toBe(spring.id);

    // The per-fleet race exclusion lands on the join row's excludedFleetIds.
    const membership = await db
      .select()
      .from(schema.subSeriesRaces)
      .where(inArray(schema.subSeriesRaces.subSeriesId, rows.map((r) => r.id)));
    const withExclusion = membership.filter((m) => (m.excludedFleetIds ?? []).length > 0);
    expect(withExclusion).toHaveLength(1);
    expect(withExclusion[0].subSeriesId).toBe(champ.id);
    expect(withExclusion[0].excludedFleetIds).toEqual(champ.fleetIds);
  });

  test('returns false for a feature with no demo sample', async () => {
    const seeded = await seedFeatureSample('prizes', workspaceId, db);
    expect(seeded).toBe(false);
  });
});
