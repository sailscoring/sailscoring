// @vitest-environment node

/**
 * getCareerArc enriches an identity's arc with each series' finishing position
 * by loading and scoring the series through the real engine, and (public =
 * public) includes only series with a live publication. The part pure tests
 * can't reach is that round-trip: seed a scored, published mini-series in the
 * DB, link a competitor to an identity, and assert the computed rank / fleet
 * size — plus that an unpublished series is dropped from the public arc.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { getCareerArc } from '@/lib/career-arc';
import * as schema from '@/lib/db/schema';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const uuid = () => crypto.randomUUID();

describe.skipIf(skip)('getCareerArc placements', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  let identityId!: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_arc_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'arc-test',
      slug: `arc-${workspaceId.slice(8, 16)}`,
      createdAt: new Date(),
    });

    identityId = uuid();
    await db.insert(schema.competitorIdentities).values({
      id: identityId,
      workspaceId,
      label: 'Aoife Murphy',
      sailNumber: 'IRL1200',
      club: 'RCYC',
    });

    // A scored series: one scratch fleet, two boats, one race. The star (sort
    // order 0) wins; the filler is second.
    const scoredSeries = uuid();
    const fleetId = uuid();
    const raceId = uuid();
    const star = uuid();
    const filler = uuid();
    await db.insert(schema.series).values({
      id: scoredSeries,
      workspaceId,
      name: 'IODAI Leinsters 2018',
      startDate: '2018-05-01',
      displayOrder: 1,
    });
    await db.insert(schema.fleets).values({
      id: fleetId,
      seriesId: scoredSeries,
      workspaceId,
      name: 'Main Fleet',
      displayOrder: 0,
      scoringSystem: 'scratch',
    });
    await db.insert(schema.competitors).values([
      {
        id: star,
        seriesId: scoredSeries,
        workspaceId,
        fleetIds: [fleetId],
        sailNumber: 'IRL1200',
        name: 'Aoife Murphy',
        club: 'RCYC',
        gender: '',
        age: null,
        identityId,
      },
      {
        id: filler,
        seriesId: scoredSeries,
        workspaceId,
        fleetIds: [fleetId],
        sailNumber: 'IRL1300',
        name: 'Other Sailor',
        club: 'NYC',
        gender: '',
        age: null,
      },
    ]);
    await db.insert(schema.races).values({
      id: raceId,
      seriesId: scoredSeries,
      workspaceId,
      raceNumber: 1,
      date: '2018-05-01',
    });
    await db.insert(schema.finishes).values([
      { id: uuid(), raceId, competitorId: star, sortOrder: 0 },
      { id: uuid(), raceId, competitorId: filler, sortOrder: 1 },
    ]);

    // Publish the scored series so its timeline entry deep-links to results.
    await db.insert(schema.publishedSeries).values({
      id: uuid(),
      workspaceId,
      seriesId: scoredSeries,
      slug: 'leinsters-2018',
      pages: [],
      contentHash: 'x',
      publishedVersion: 1,
    });

    // A second, race-less series the same sailor entered — not yet rankable.
    const emptySeries = uuid();
    await db.insert(schema.series).values({
      id: emptySeries,
      workspaceId,
      name: 'IODAI Munsters 2019',
      startDate: '2019-05-01',
      displayOrder: 2,
    });
    await db.insert(schema.competitors).values({
      id: uuid(),
      seriesId: emptySeries,
      workspaceId,
      fleetIds: [],
      sailNumber: 'IRL1200',
      name: 'Aoife Murphy',
      club: 'RCYC',
      gender: '',
      age: null,
      identityId,
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('includes only published series, enriched with rank and fleet size', async () => {
    const arc = await getCareerArc(workspaceId, identityId);
    expect(arc).not.toBeNull();
    // Only the published "Leinsters 2018" surfaces; the unpublished, race-less
    // "Munsters 2019" is the club's "not public", so it's dropped entirely.
    expect(arc!.entries).toHaveLength(1);

    const scored = arc!.entries[0];
    expect(scored.seriesName).toBe('IODAI Leinsters 2018');
    expect(scored.rank).toBe(1);
    expect(scored.fleetSize).toBe(2);
    expect(scored.fleetName).toBeNull(); // single-fleet series
    expect(scored.publishedSlug).toBe('leinsters-2018');
    // The year span reflects only the published entries.
    expect(arc!.firstYear).toBe(2018);
    expect(arc!.lastYear).toBe(2018);
  });

  test('returns an empty arc when the identity has nothing published', async () => {
    const id = uuid();
    await db.insert(schema.competitorIdentities).values({
      id,
      workspaceId,
      label: 'Unpublished Only',
      sailNumber: 'IRL9000',
      club: null,
    });
    const unpublished = uuid();
    await db.insert(schema.series).values({
      id: unpublished,
      workspaceId,
      name: 'IODAI Westerns 2020',
      startDate: '2020-05-01',
      displayOrder: 9,
    });
    await db.insert(schema.competitors).values({
      id: uuid(),
      seriesId: unpublished,
      workspaceId,
      fleetIds: [],
      sailNumber: 'IRL9000',
      name: 'Unpublished Only',
      club: '',
      gender: '',
      age: null,
      identityId: id,
    });

    const arc = await getCareerArc(workspaceId, id);
    expect(arc).not.toBeNull();
    expect(arc!.entries).toHaveLength(0);
    expect(arc!.firstYear).toBeNull();
    expect(arc!.lastYear).toBeNull();
  });

  test('returns null for an unknown identity', async () => {
    expect(await getCareerArc(workspaceId, uuid())).toBeNull();
  });
});
