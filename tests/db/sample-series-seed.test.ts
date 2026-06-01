// @vitest-environment node

/**
 * Integration test for `seedSampleSeries` — the new-workspace seeding used by
 * the sign-up hook (`lib/auth.ts`) and `provision-org pre-create-user`.
 * Skipped when DATABASE_URL is unset; runs against the local/CI Postgres.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { seedSampleSeries } from '@/lib/sample-series/seed';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('seedSampleSeries', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_seed_${crypto.randomUUID().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Seed Test',
      slug: `s-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    await seedSampleSeries(workspaceId, db);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function seriesByName(name: string) {
    const [row] = await db
      .select()
      .from(schema.series)
      .where(and(eq(schema.series.workspaceId, workspaceId), eq(schema.series.name, name)));
    return row;
  }

  async function counts(seriesId: string) {
    const fleets = await db.select().from(schema.fleets).where(eq(schema.fleets.seriesId, seriesId));
    const competitors = await db
      .select()
      .from(schema.competitors)
      .where(eq(schema.competitors.seriesId, seriesId));
    const races = await db.select().from(schema.races).where(eq(schema.races.seriesId, seriesId));
    return { fleets: fleets.length, competitors: competitors.length, races: races.length };
  }

  test('creates exactly the two sample series, appended in order', async () => {
    const all = await db
      .select({ name: schema.series.name, displayOrder: schema.series.displayOrder })
      .from(schema.series)
      .where(eq(schema.series.workspaceId, workspaceId));
    expect(all).toHaveLength(2);
    const ordered = [...all].sort((a, b) => a.displayOrder - b.displayOrder).map((s) => s.name);
    expect(ordered).toEqual(['Sample Junior Regatta 2026', 'Sample Tuesday Evening League 2026']);
  });

  test('groups both samples under a seeded "Samples" category', async () => {
    const cats = await db
      .select()
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, workspaceId));
    expect(cats).toHaveLength(1);
    expect(cats[0].name).toBe('Samples');

    const seriesRows = await db
      .select({ categoryId: schema.series.categoryId })
      .from(schema.series)
      .where(eq(schema.series.workspaceId, workspaceId));
    expect(seriesRows).toHaveLength(2);
    expect(seriesRows.every((s) => s.categoryId === cats[0].id)).toBe(true);
  });

  test('regatta series has the expected fleets, competitors, and races', async () => {
    const s = await seriesByName('Sample Junior Regatta 2026');
    expect(s.scoringMode).toBe('scratch');
    expect(await counts(s.id)).toEqual({ fleets: 6, competitors: 110, races: 8 });
  });

  test('club series has 6 IRC+ECHO fleets, 45 boats, 6 races, with finishes written', async () => {
    const s = await seriesByName('Sample Tuesday Evening League 2026');
    expect(s.scoringMode).toBe('handicap');
    expect(await counts(s.id)).toEqual({ fleets: 6, competitors: 45, races: 6 });

    // Finishes reach the DB (a row per boat per race == 45 × 6).
    const raceRows = await db.select({ id: schema.races.id }).from(schema.races).where(eq(schema.races.seriesId, s.id));
    let finishCount = 0;
    for (const r of raceRows) {
      const fs = await db.select().from(schema.finishes).where(eq(schema.finishes.raceId, r.id));
      finishCount += fs.length;
    }
    expect(finishCount).toBe(45 * 6);
  });
});
