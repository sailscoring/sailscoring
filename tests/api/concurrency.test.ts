// @vitest-environment node

/**
 * ADR-008 Phase 4 Track 4a — optimistic concurrency.
 *
 * Drives a single row through two repository instances simulating two
 * tabs/devices. Confirms that:
 *   - the first save with `expectedVersion` matching the DB version
 *     succeeds and returns the bumped version;
 *   - a second save with the now-stale version throws `ConflictError`,
 *     carrying the expected and current versions in the detail;
 *   - retrying with the fresh version succeeds.
 *
 * Coverage spans the four interesting row shapes:
 *   - top-level (Series),
 *   - workspace-scoped child (Competitor),
 *   - workspace-scoped child (Race),
 *   - race-scoped leaf via parent-race tenancy (Finish).
 *
 * Skipped when DATABASE_URL is unset; runs against the service container
 * in integration-tests.yml.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { ConflictError } from '@/lib/repository';
import type { Competitor, Finish, Race, Series } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

function makeSeries(id: string = uuid()): Series {
  const now = Date.now();
  return {
    id,
    name: `Concurrency ${id.slice(0, 8)}`,
    venue: '',
    startDate: '',
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: now,
    lastSavedAt: null,
    lastModifiedAt: now,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: [],
    primaryPersonLabel: 'competitor',
    subdivisionLabel: 'Division',
  };
}

describe.skipIf(skip)('optimistic concurrency (CAS via expectedVersion)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspace: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspace = `org_cas_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspace,
      name: 'CAS',
      slug: `cas-${workspace.slice(8, 18)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspace) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspace));
    }
    await sql?.end();
  });

  test('Series.save: matching expectedVersion succeeds; stale throws; retry with fresh succeeds', async () => {
    // Two repository instances — same workspace, distinct objects, simulating
    // two tabs reading the same row at the same time.
    const tabA = createRepos({ db, workspaceId: workspace });
    const tabB = createRepos({ db, workspaceId: workspace });

    // Both tabs see the same v1 of the row.
    const initial = await tabA.series.save(makeSeries());
    expect(initial.version).toBe(1);
    const inB = await tabB.series.get(initial.id);
    expect(inB?.version).toBe(1);

    // Tab A saves first with expectedVersion=1 — succeeds, row jumps to v2.
    const updatedByA = await tabA.series.save(
      { ...initial, name: 'a-edit' },
      { expectedVersion: 1 },
    );
    expect(updatedByA.version).toBe(2);
    expect(updatedByA.name).toBe('a-edit');

    // Tab B still thinks the row is at v1. Its save must conflict.
    let thrown: unknown;
    try {
      await tabB.series.save(
        { ...inB!, name: 'b-edit' },
        { expectedVersion: 1 },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConflictError);
    expect((thrown as ConflictError).detail).toMatchObject({
      expectedVersion: 1,
      currentVersion: 2,
    });
    // Phase 6 added `updatedAt` to the conflict envelope; Phase 7 will add `actor`.
    expect((thrown as ConflictError).detail?.updatedAt).toBeTypeOf('string');

    // Re-read; retry; succeeds.
    const fresh = await tabB.series.get(initial.id);
    expect(fresh?.version).toBe(2);
    const updatedByB = await tabB.series.save(
      { ...fresh!, name: 'b-edit' },
      { expectedVersion: 2 },
    );
    expect(updatedByB.version).toBe(3);
    expect(updatedByB.name).toBe('b-edit');

    await tabA.series.delete(initial.id);
  });

  test('Series.save: omitted expectedVersion is unconditional (authoritative path)', async () => {
    const repos = createRepos({ db, workspaceId: workspace });
    const initial = await repos.series.save(makeSeries());
    expect(initial.version).toBe(1);

    // No expectedVersion → upsert path → succeeds even if a concurrent edit
    // bumped the row in between (here we manually bump via another save).
    await repos.series.save({ ...initial, name: 'first' });
    const second = await repos.series.save({ ...initial, name: 'second' });
    expect(second.version).toBe(3);
    expect(second.name).toBe('second');

    await repos.series.delete(initial.id);
  });

  test('Competitor.save CAS: stale expectedVersion throws ConflictError', async () => {
    const setup = createRepos({ db, workspaceId: workspace });
    const s = await setup.series.save(makeSeries());
    const fleet = uuid();
    await setup.fleets.save({
      id: fleet, seriesId: s.id, name: 'Default', displayOrder: 0, scoringSystem: 'scratch',
    });
    const c: Competitor = {
      id: uuid(), seriesId: s.id, fleetIds: [fleet], sailNumber: '1', name: 'Boat',
      club: '', gender: '', age: null, createdAt: Date.now(),
    };
    const created = await setup.competitors.save(c);
    expect(created.version).toBe(1);

    // Race two updates.
    const updated = await setup.competitors.save(
      { ...created, name: 'first edit' },
      { expectedVersion: 1 },
    );
    expect(updated.version).toBe(2);

    let thrown: unknown;
    try {
      await setup.competitors.save(
        { ...created, name: 'stale edit' },
        { expectedVersion: 1 },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConflictError);
    expect((thrown as ConflictError).detail).toMatchObject({
      expectedVersion: 1,
      currentVersion: 2,
    });

    await setup.series.delete(s.id);
  });

  test('Race.save CAS: stale expectedVersion throws ConflictError', async () => {
    const repos = createRepos({ db, workspaceId: workspace });
    const s = await repos.series.save(makeSeries());
    const r: Race = {
      id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    };
    const created = await repos.races.save(r);
    expect(created.version).toBe(1);

    await repos.races.save({ ...created, date: '2026-04-02' }, { expectedVersion: 1 });

    let thrown: unknown;
    try {
      await repos.races.save({ ...created, date: '2026-04-03' }, { expectedVersion: 1 });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConflictError);
    expect((thrown as ConflictError).detail).toMatchObject({
      expectedVersion: 1,
      currentVersion: 2,
    });

    await repos.series.delete(s.id);
  });

  test('Finish.save CAS: tenancy via parent race; stale expectedVersion throws ConflictError', async () => {
    const repos = createRepos({ db, workspaceId: workspace });
    const s = await repos.series.save(makeSeries());
    const fleet = uuid();
    await repos.fleets.save({
      id: fleet, seriesId: s.id, name: 'Default', displayOrder: 0, scoringSystem: 'scratch',
    });
    const competitor: Competitor = {
      id: uuid(), seriesId: s.id, fleetIds: [fleet], sailNumber: '1', name: 'Boat',
      club: '', gender: '', age: null, createdAt: Date.now(),
    };
    await repos.competitors.save(competitor);
    const race: Race = {
      id: uuid(), seriesId: s.id, raceNumber: 1, date: '2026-04-01', createdAt: Date.now(),
    };
    await repos.races.save(race);

    const finish: Finish = {
      id: uuid(), raceId: race.id, competitorId: competitor.id,
      sortOrder: 1, finishTime: '12:34:56', resultCode: null,
      startPresent: null, penaltyCode: null, penaltyOverride: null,
      redressMethod: null, redressExcludeRaces: null, redressIncludeRaces: null,
      tiedWithPrevious: false, redressIncludeAllLater: false, redressPoints: null,
    };
    const created = await repos.finishes.save(finish);
    expect(created.version).toBe(1);

    await repos.finishes.save(
      { ...created, finishTime: '12:35:00' },
      { expectedVersion: 1 },
    );

    let thrown: unknown;
    try {
      await repos.finishes.save(
        { ...created, finishTime: '12:36:00' },
        { expectedVersion: 1 },
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ConflictError);
    expect((thrown as ConflictError).detail).toMatchObject({
      expectedVersion: 1,
      currentVersion: 2,
    });

    await repos.series.delete(s.id);
  });
});
