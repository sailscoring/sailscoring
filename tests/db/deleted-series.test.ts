/**
 * DB-backed test for the soft-delete / Trash flow ("Recover a deleted series"),
 * driving the real handlers against Postgres.
 *
 * Covers the round-trip: delete (tombstone + hard delete) → Trash list →
 * recover (re-create under the original id, including revision history) → and
 * the terminal permanent-delete and retention sweep.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { captureRevision, listRevisions } from '@/lib/revision-log';
import { deleteSeries } from '@/lib/api-handlers/series';
import { listTrash, purgeFromTrash, restoreFromTrash } from '@/lib/api-handlers/trash';
import { listTombstones, sweepDeletedSeries } from '@/lib/deleted-series';
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import type { Competitor, Fleet, Race, Series } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid(): string {
  return crypto.randomUUID();
}

function makeSeries(id: string, archived = true): Series {
  const now = Date.now();
  return {
    id,
    name: 'Trash Series',
    venue: 'HYC',
    startDate: '2026-06-01',
    endDate: '2026-06-30',
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
    enabledCompetitorFields: [],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    archived,
  };
}

function makeFleet(seriesId: string): Fleet {
  return { id: uuid(), seriesId, name: 'Fleet A', displayOrder: 0, scoringSystem: 'scratch' };
}

function makeRace(seriesId: string, n: number): Race {
  return { id: uuid(), seriesId, raceNumber: n, name: null, date: '2026-06-02', createdAt: Date.now() };
}

function makeCompetitor(seriesId: string, fleetIds: string[], sailNumber: string): Competitor {
  return {
    id: uuid(),
    seriesId,
    fleetIds,
    sailNumber,
    names: [`Boat ${sailNumber}`],
    boatName: '',
    boatClass: '',
    clubs: [],
    gender: '',
    age: null,
    createdAt: Date.now(),
  } as Competitor;
}

describe.skipIf(skip)('soft delete / Trash', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let actor: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });

    workspaceId = `org_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Trash workspace',
      slug: `trash-${workspaceId.slice(4, 12)}`,
      createdAt: new Date(),
    });

    actor = `usr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.user).values({
      id: actor, name: 'Mark', email: `mark-${actor}@example.test`,
      emailVerified: true, createdAt: new Date(), updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.deletedSeries).where(eq(schema.deletedSeries.workspaceId, workspaceId));
      await db.delete(schema.seriesRevision).where(eq(schema.seriesRevision.workspaceId, workspaceId));
      await db.delete(schema.series).where(eq(schema.series.workspaceId, workspaceId));
      await db.delete(schema.activityLog).where(eq(schema.activityLog.workspaceId, workspaceId));
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (actor) await db.delete(schema.user).where(eq(schema.user.id, actor));
    await sql?.end();
  });

  function ctx(userId = actor): WorkspaceContext {
    return {
      userId,
      email: 'x@example.test',
      workspaceId,
      workspaceSlug: 'trash-ws',
      role: 'owner',
      features: [],
    };
  }

  /** Rewrite a tombstone's snapshot in place, as if the series had been
   *  deleted while an older format version was current. */
  async function rewriteSnapshot(
    tombstoneId: string,
    edit: (file: Record<string, unknown>) => void,
  ): Promise<void> {
    const [row] = await db
      .select({ snapshotGz: schema.deletedSeries.snapshotGz })
      .from(schema.deletedSeries)
      .where(eq(schema.deletedSeries.id, tombstoneId));
    const file = JSON.parse(zstdDecompressSync(row.snapshotGz).toString('utf-8'));
    edit(file);
    await db
      .update(schema.deletedSeries)
      .set({ snapshotGz: zstdCompressSync(Buffer.from(JSON.stringify(file))) })
      .where(eq(schema.deletedSeries.id, tombstoneId));
  }

  async function activityActions(): Promise<string[]> {
    const rows = await db
      .select({ action: schema.activityLog.action })
      .from(schema.activityLog)
      .where(eq(schema.activityLog.workspaceId, workspaceId));
    return rows.map((r) => r.action);
  }

  test('delete tombstones the series, then recover restores it losslessly', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));
    const fleet = makeFleet(seriesId);
    await repos.fleets.save(fleet);
    await repos.races.save(makeRace(seriesId, 1));
    await repos.competitors.save(makeCompetitor(seriesId, [fleet.id], 'A1'));
    await repos.competitors.save(makeCompetitor(seriesId, [fleet.id], 'B2'));
    await captureRevision(ctx(), seriesId, { kind: 'named', label: 'checkpoint' });

    // Delete → tombstone + hard delete.
    await deleteSeries(ctx(), seriesId);

    expect(await repos.series.get(seriesId)).toBeUndefined();
    expect(await repos.competitors.listBySeries(seriesId)).toHaveLength(0);
    expect(await repos.races.listBySeries(seriesId)).toHaveLength(0);

    // Tombstone is in the Trash.
    const trash = await listTombstones(workspaceId);
    const entry = trash.find((t) => t.seriesId === seriesId);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Trash Series');
    expect(entry!.hadPublication).toBe(false);
    expect(entry!.actor?.id).toBe(actor);

    // Recover → series back under the same id, archived, with its data + history.
    const { seriesId: restoredId } = await restoreFromTrash(ctx(), entry!.id);
    expect(restoredId).toBe(seriesId);

    const restored = await repos.series.get(seriesId);
    expect(restored).toBeDefined();
    expect(restored!.archived).toBe(true);

    const comps = await repos.competitors.listBySeries(seriesId);
    expect(comps.map((c) => c.sailNumber).sort()).toEqual(['A1', 'B2']);
    expect(await repos.fleets.listBySeries(seriesId)).toHaveLength(1);
    expect(await repos.races.listBySeries(seriesId)).toHaveLength(1);

    // The revision history rode along.
    const revs = await listRevisions(ctx(), seriesId);
    expect(revs.some((r) => r.kind === 'named' && r.label === 'checkpoint')).toBe(true);

    // The tombstone is consumed.
    expect((await listTombstones(workspaceId)).some((t) => t.seriesId === seriesId)).toBe(false);

    const actions = await activityActions();
    expect(actions).toContain('series.deleted');
    expect(actions).toContain('series.restored');
  });

  test('recover brings a snapshot from an older format version forward', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));
    const fleet = makeFleet(seriesId);
    await repos.fleets.save(fleet);
    await repos.competitors.save({ ...makeCompetitor(seriesId, [fleet.id], 'A1'), clubs: ['HYC'] });
    await deleteSeries(ctx(), seriesId);

    // A v46 file stored one `club` per competitor; v47 reads it as `clubs`.
    const entry = (await listTombstones(workspaceId)).find((t) => t.seriesId === seriesId)!;
    await rewriteSnapshot(entry.id, (file) => {
      file.formatVersion = 46;
      for (const c of file.competitors as Record<string, unknown>[]) {
        c.club = (c.clubs as string[])[0];
        delete c.clubs;
      }
    });

    await restoreFromTrash(ctx(), entry.id);

    const [comp] = await repos.competitors.listBySeries(seriesId);
    expect(comp.clubs).toEqual(['HYC']);
  });

  test('recover refuses a snapshot that scores with a setting that is gone, and keeps it in the Trash', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));
    await deleteSeries(ctx(), seriesId);

    // A v57 split-fleet series, partway through qualifying, carrying scores
    // in a way v58 no longer supports.
    const ilca7 = JSON.parse(
      readFileSync(
        join(__dirname, '../fixtures/split-fleets-published/ilca7-men-worlds-2026.sailscoring.json'),
        'utf-8',
      ),
    );
    const entry = (await listTombstones(workspaceId)).find((t) => t.seriesId === seriesId)!;
    await rewriteSnapshot(entry.id, (file) => {
      file.formatVersion = 57;
      file.races = [
        { name: 'Q1 · Yellow', starts: [{ stage: 'qualifying', stageRaceNumber: 1 }], finishes: [{}] },
      ];
      file.splitFleets = {
        config: { ...ilca7.splitFleets.config, carry: 'net-plus-net' },
        rounds: [{ stage: 'qualifying' }],
      };
    });

    const attempt = restoreFromTrash(ctx(), entry.id);
    await expect(attempt).rejects.toBeInstanceOf(BadRequestError);
    await expect(attempt).rejects.toThrow(/how scores carry \("net-plus-net"\)/);

    expect(await repos.series.get(seriesId)).toBeUndefined();
    expect((await listTombstones(workspaceId)).some((t) => t.id === entry.id)).toBe(true);
  });

  test('permanent delete drops the tombstone for good', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));
    await deleteSeries(ctx(), seriesId);

    const entry = (await listTombstones(workspaceId)).find((t) => t.seriesId === seriesId);
    expect(entry).toBeDefined();

    await purgeFromTrash(ctx(), entry!.id);

    expect((await listTombstones(workspaceId)).some((t) => t.seriesId === seriesId)).toBe(false);
    expect(await repos.series.get(seriesId)).toBeUndefined();
    expect(await activityActions()).toContain('series.purged');
  });

  test('the retention sweep purges tombstones past the window', async () => {
    const repos = createRepos({ workspaceId });
    const seriesId = uuid();
    await repos.series.save(makeSeries(seriesId));
    await deleteSeries(ctx(), seriesId);

    const entry = (await listTombstones(workspaceId)).find((t) => t.seriesId === seriesId)!;

    // Nothing is old enough yet.
    await sweepDeletedSeries();
    expect((await listTombstones(workspaceId)).some((t) => t.id === entry.id)).toBe(true);

    // Backdate it past the 30-day window, then sweep.
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await db
      .update(schema.deletedSeries)
      .set({ deletedAt: old })
      .where(
        and(
          eq(schema.deletedSeries.id, entry.id),
          eq(schema.deletedSeries.workspaceId, workspaceId),
        ),
      );

    const purged = await sweepDeletedSeries();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect((await listTombstones(workspaceId)).some((t) => t.id === entry.id)).toBe(false);
  });
});
