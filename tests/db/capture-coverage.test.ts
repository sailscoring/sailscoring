/**
 * Regression guard for the capture-seam audit (#166): the scoring-data
 * mutations that the UI actually uses — including the *flat* delete endpoints
 * and single edits that previously recorded nothing — now record an activity
 * entry (and, via the same `trackChange` seam, capture a revision).
 *
 * Activity is written synchronously, so it's asserted here deterministically;
 * the deferred revision capture is covered by revision-log.test.ts.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { listActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { putCompetitor, deleteCompetitorFlat } from '@/lib/api-handlers/competitors';
import { deleteRaceFlat } from '@/lib/api-handlers/races';
import { deleteFleetFlat } from '@/lib/api-handlers/fleets';
import { putRaceStart } from '@/lib/api-handlers/race-starts';
import { bulkPutRaceRatingOverrides } from '@/lib/api-handlers/race-rating-overrides';
import type { Competitor, Fleet, Race, Series } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const uuid = () => crypto.randomUUID();

function makeSeries(id: string): Series {
  const now = Date.now();
  return {
    id, name: 'Capture Series', venue: 'HYC', startDate: '2026-06-01', endDate: '2026-06-30',
    venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: now,
    lastSavedAt: null, lastModifiedAt: now, scoringMode: 'scratch', discardThresholds: [],
    dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
    enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
  };
}
function makeFleet(seriesId: string): Fleet {
  return { id: uuid(), seriesId, name: 'Fleet A', displayOrder: 0, scoringSystem: 'scratch' };
}
function makeRace(seriesId: string, n: number): Race {
  return { id: uuid(), seriesId, raceNumber: n, name: null, date: '2026-06-02', createdAt: Date.now() };
}
function makeCompetitor(seriesId: string, sail: string): Competitor {
  return {
    id: uuid(), seriesId, fleetIds: [], sailNumber: sail, name: `Boat ${sail}`, crewName: '',
    boatName: '', boatClass: '', club: '', gender: '', age: null, createdAt: Date.now(),
  } as Competitor;
}

describe.skipIf(skip)('capture coverage', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Capture WS', slug: `cap-${workspaceId.slice(4, 12)}`, createdAt: new Date(),
    });
    userId = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values({
      id: userId, name: 'Mark', email: `m-${userId}@example.test`, emailVerified: true,
      createdAt: new Date(), updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.activityLog).where(eq(schema.activityLog.workspaceId, workspaceId));
      await db.delete(schema.seriesRevision).where(eq(schema.seriesRevision.workspaceId, workspaceId));
      await db.delete(schema.series).where(eq(schema.series.workspaceId, workspaceId));
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
    await sql?.end();
  });

  function ctx(): WorkspaceContext {
    return { userId, email: 'm@example.test', workspaceId, workspaceSlug: 'cap', role: 'owner', features: [] };
  }

  test('flat deletes and single edits record activity (previously silent)', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));
    const fleet = makeFleet(seriesId);
    await repos.fleets.save(fleet);
    const race = makeRace(seriesId, 1);
    await repos.races.save(race);
    const compA = makeCompetitor(seriesId, 'A1');
    const compB = makeCompetitor(seriesId, 'B2');
    await repos.competitors.save(compA);
    await repos.competitors.save(compB);

    // Single competitor edit (putCompetitor).
    await putCompetitor(ctx(), seriesId, compA.id, { ...compA, name: 'Renamed' });
    // Flat competitor delete (the UI path).
    await deleteCompetitorFlat(ctx(), compB.id);
    // Per-race start config.
    const startId = uuid();
    await putRaceStart(ctx(), race.id, startId, { id: startId, raceId: race.id, fleetIds: [fleet.id], startTime: '10:00:00' });
    // Per-race rating override.
    await bulkPutRaceRatingOverrides(ctx(), race.id, {
      overrides: [{ id: uuid(), raceId: race.id, competitorId: compA.id, field: 'ircTcc', value: 1.02 }],
    });
    // Flat fleet delete and flat race delete.
    await deleteFleetFlat(ctx(), fleet.id);
    await deleteRaceFlat(ctx(), race.id);

    const { items } = await listActivity({ workspaceId, seriesId, page: { cursor: null, limit: 100 } });
    const actions = new Set(items.map((i) => i.action));
    expect(actions).toContain('competitor.updated');
    expect(actions).toContain('competitor.deleted');
    expect(actions).toContain('starts.updated');
    expect(actions).toContain('ratings.updated');
    expect(actions).toContain('fleet.deleted');
    expect(actions).toContain('race.deleted');
  });
});
