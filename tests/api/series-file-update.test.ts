// @vitest-environment node

/**
 * Updating a series in place from a `.sailscoring` file
 * (`PUT /api/v1/series/{id}/file`, `updateSeriesFromFile`): the replay
 * deletes the series' children and writes the file's, so it has to be
 * all-or-nothing, and a file whose series is marked final must still replay —
 * the final status is applied after the data it locks, never before.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import * as series from '@/lib/api-handlers/series';
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import { buildSeriesFile, updateSeriesFromFile, type SeriesFile, type SeriesFileRepos } from '@/lib/series-file';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { requireWorkspace } from '@/lib/auth/require-workspace';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

/** A repository whose writes run `check` first. The repositories are class
 *  instances, so a spread would drop their methods. */
function guardWrites<T extends object>(repo: T, check: () => Promise<void>): T {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (prop === 'save' || prop === 'saveMany') {
        return async (...args: unknown[]) => {
          await check();
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
}

describe.skipIf(skip)('updating a series from a file', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_upd_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Update',
      slug: `upd-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'upd-ws',
      role: 'owner',
      features: [],
    };
    mockedRequire.mockResolvedValue(ctx);
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  /** Seed a small provisional series and return its id and its file. */
  async function seed(name: string): Promise<{ id: string; file: SeriesFile }> {
    const id = uuid();
    await series.putSeries(ctx, id, {
      id,
      name,
      venue: 'HYC',
      startDate: '2026-05-01',
      endDate: '2026-05-31',
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      createdAt: Date.now(),
      lastSavedAt: null,
      lastModifiedAt: Date.now(),
      scoringMode: 'handicap' as const,
      discardThresholds: [],
      dnfScoring: 'startingArea' as const,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: true,
      publishRatingCalculations: true,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const,
      subdivisionAxes: [],
    });
    const fleetId = uuid();
    await fleets.putFleet(ctx, id, fleetId, {
      id: fleetId, seriesId: id, name: 'IRC', displayOrder: 0, scoringSystem: 'irc' as const,
    });
    for (const sail of ['101', '202']) {
      const compId = uuid();
      await competitors.putCompetitor(ctx, id, compId, {
        id: compId, seriesId: id, fleetIds: [fleetId], sailNumber: sail,
        names: [`Helm ${sail}`], clubs: ['HYC'], gender: '' as const, age: null, createdAt: Date.now(),
      });
    }
    const raceId = uuid();
    await races.putRace(ctx, id, raceId, {
      id: raceId, seriesId: id, raceNumber: 1, date: '2026-05-04', createdAt: Date.now(),
    });
    const file = await buildSeriesFile(id, seriesFileReposFor({ workspaceId }));
    return { id, file };
  }

  function markedFinal(file: SeriesFile, finalisedAt: number): SeriesFile {
    return { ...file, series: { ...file.series, resultsStatus: 'final', finalisedAt } };
  }

  async function children(id: string) {
    const repos = seriesFileReposFor({ workspaceId });
    return {
      competitors: (await repos.competitorRepo.listBySeries(id)).length,
      races: (await repos.raceRepo.listBySeries(id)).length,
    };
  }

  test('a file marked final replays over a provisional series, and leaves it final', async () => {
    const { id, file } = await seed('Final File League');
    const finalisedAt = Date.parse('2026-06-01T12:00:00Z');

    await series.putSeriesFile(ctx, id, { content: JSON.stringify(markedFinal(file, finalisedAt)) });

    expect(await children(id)).toEqual({ competitors: 2, races: 1 });
    const row = await seriesFileReposFor({ workspaceId }).seriesRepo.get(id);
    expect(row?.resultsStatus).toBe('final');
    expect(row?.finalisedAt).toBe(finalisedAt);
  });

  test('the series stays provisional until every child is written', async () => {
    // Repositories without a transaction, whose child writes are refused once
    // the series is final — the write surface a client replaying the file
    // through per-entity requests meets.
    const { id, file } = await seed('Ordering League');
    const base = seriesFileReposFor({ workspaceId });
    const refuseIfFinal = async () => {
      if ((await base.seriesRepo.get(id))?.resultsStatus === 'final') throw new Error('series-final');
    };
    const guarded: SeriesFileRepos = {
      ...base,
      runInTransaction: undefined,
      fleetRepo: guardWrites(base.fleetRepo, refuseIfFinal),
      competitorRepo: guardWrites(base.competitorRepo, refuseIfFinal),
      raceRepo: guardWrites(base.raceRepo, refuseIfFinal),
      raceStartRepo: guardWrites(base.raceStartRepo, refuseIfFinal),
      finishRepo: guardWrites(base.finishRepo, refuseIfFinal),
    };

    await updateSeriesFromFile(id, markedFinal(file, Date.now()), guarded);

    expect(await children(id)).toEqual({ competitors: 2, races: 1 });
    expect((await base.seriesRepo.get(id))?.resultsStatus).toBe('final');
  });

  test('a replay that fails part-way leaves the series as it was', async () => {
    const { id, file } = await seed('Rollback League');
    const broken: SeriesFile = {
      ...file,
      series: { ...file.series, name: 'Rollback League (renamed)' },
      // The last competitor is refused by the database, after the delete and
      // the series save have both run.
      competitors: file.competitors.map((c, i) =>
        i === file.competitors.length - 1 ? { ...c, sailNumber: null as unknown as string } : c,
      ),
    };

    await expect(
      series.putSeriesFile(ctx, id, { content: JSON.stringify(broken) }),
    ).rejects.toThrow();

    expect(await children(id)).toEqual({ competitors: 2, races: 1 });
    expect((await seriesFileReposFor({ workspaceId }).seriesRepo.get(id))?.name).toBe('Rollback League');
  });
});
