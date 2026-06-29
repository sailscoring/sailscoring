// @vitest-environment node

/**
 * Integration tests for `importSeries` / `POST /api/v1/series/import`
 * (ADR-009 M2): a .sailscoring file is imported as a new series with fresh
 * ids and a disambiguated name; bad content is a 400; an Idempotency-Key
 * replay imports only once.
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
import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { buildSeriesFile } from '@/lib/series-file';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { POST as importRoute } from '@/app/api/v1/series/import/route';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('series import (ADR-009 M2)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_imp_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Import',
      slug: `imp-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'test-user',
      email: 'test@sailscoring.test',
      workspaceId,
      workspaceSlug: 'imp-ws',
      role: 'owner',
      features: [],
    };
    mockedRequire.mockResolvedValue(ctx);
  });

  afterAll(async () => {
    if (workspaceId) {
      // Series, races, competitors, fleets, idempotency_keys all FK the org
      // with onDelete cascade, so one delete clears the lot.
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  /** Seed a small series and return the `.sailscoring` text for it. */
  async function seedSeriesFile(name: string): Promise<{ srcId: string; content: string }> {
    const srcId = uuid();
    await series.putSeries(ctx, srcId, {
      id: srcId,
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
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'startingArea' as const,
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: true,
      publishRatingCalculations: true,
      enabledCompetitorFields: ['boatName', 'club'],
      primaryPersonLabel: 'helm' as const,
      subdivisionAxes: [],
    });
    const fleetId = uuid();
    await fleets.putFleet(ctx, srcId, fleetId, {
      id: fleetId, seriesId: srcId, name: 'IRC', displayOrder: 0,
      scoringSystem: 'irc' as const,
    });
    for (const sail of ['101', '202']) {
      const compId = uuid();
      await competitors.putCompetitor(ctx, srcId, compId, {
        id: compId, seriesId: srcId, fleetIds: [fleetId],
        sailNumber: sail, name: `Helm ${sail}`, club: 'HYC',
        gender: '' as const, age: null, createdAt: Date.now(),
      });
    }
    const raceId = uuid();
    await races.putRace(ctx, srcId, raceId, {
      id: raceId, seriesId: srcId, raceNumber: 1, date: '2026-05-04', createdAt: Date.now(),
    });

    const file = await buildSeriesFile(srcId, seriesFileReposFor({ workspaceId }));
    return { srcId, content: JSON.stringify(file) };
  }

  test('imports a file as a new series with fresh ids and a disambiguated name', async () => {
    const { srcId, content } = await seedSeriesFile('Autumn League');

    const { id } = await series.importSeries(ctx, { content });
    expect(id).not.toBe(srcId);

    const repos = seriesFileReposFor({ workspaceId });
    const imported = await repos.seriesRepo.get(id);
    expect(imported).toBeTruthy();
    // Same name already present in this workspace → disambiguated.
    expect(imported!.name).not.toBe('Autumn League');
    expect(imported!.name).toContain('Autumn League');

    expect((await repos.fleetRepo.listBySeries(id)).length).toBe(1);
    expect((await repos.competitorRepo.listBySeries(id)).length).toBe(2);
    expect((await repos.raceRepo.listBySeries(id)).length).toBe(1);
  });

  test('rejects invalid file content with a 400 (BadRequestError)', async () => {
    await expect(series.importSeries(ctx, { content: 'not json' })).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(
      series.importSeries(ctx, { content: JSON.stringify({ formatVersion: 999 }) }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test('Idempotency-Key replay imports the file only once', async () => {
    const { content } = await seedSeriesFile('Winter Frostbite');

    const key = `imp-${uuid()}`;
    const make = () =>
      new Request('http://localhost/api/v1/series/import', {
        method: 'POST',
        headers: { 'idempotency-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ content }),
      });

    const first = await importRoute(
      make() as Parameters<typeof importRoute>[0],
      { params: Promise.resolve({}) },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { id: string };

    const second = await importRoute(
      make() as Parameters<typeof importRoute>[0],
      { params: Promise.resolve({}) },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { id: string };

    // Replay returns the same id, and the second POST imported nothing: only
    // the source series plus a single import carry the name (a duplicate
    // import would make three).
    expect(secondBody.id).toBe(firstBody.id);
    const matches = (await seriesFileReposFor({ workspaceId }).listSeriesNames()).filter(
      (n) => n.startsWith('Winter Frostbite'),
    );
    expect(matches.length).toBe(2);
  });
});
