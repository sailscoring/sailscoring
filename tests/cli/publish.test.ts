// @vitest-environment node

/**
 * ADR-009 M3.1 — drives the CLI's publish orchestration (`runPublish`) over a
 * real `SailscoringClient` routed at the real publish/import route handlers
 * (requireWorkspace mocked, real DB; published HTML uses the published_blobs
 * Postgres fallback). Covers the IODAI case: several series co-published under
 * one slug, and the import→publish chain.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
import { buildSeriesFile } from '@/lib/series-file';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { getPublishedGroupByWorkspaceSlug } from '@/lib/published-repository';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { POST as importRoute } from '@/app/api/v1/series/import/route';
import { POST as publishRoute } from '@/app/api/v1/series/[id]/publish/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';
import { runImport } from '@/cli/import-runner';
import { runPublish } from '@/cli/publish-runner';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('CLI publish (ADR-009 M3.1)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let tmp: string;
  let client: SailscoringClient;

  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const pub = /^\/api\/v1\/series\/([^/]+)\/publish$/.exec(pathname);
    if (init.method === 'POST' && pub) {
      const req = new Request(url, { method: 'POST', headers: init.headers, body: init.body });
      const res = await publishRoute(req as Parameters<typeof publishRoute>[0], {
        params: Promise.resolve({ id: pub[1] }),
      });
      return { status: res.status, text: () => res.text() };
    }
    if (init.method === 'POST' && pathname === '/api/v1/series/import') {
      const req = new Request(url, { method: 'POST', headers: init.headers, body: init.body });
      const res = await importRoute(req as Parameters<typeof importRoute>[0], {
        params: Promise.resolve({}),
      });
      return { status: res.status, text: () => res.text() };
    }
    throw new Error(`unexpected ${init.method} ${pathname}`);
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_pub_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Pub',
      slug: `pub-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'pub-user',
      email: 'pub@sailscoring.test',
      workspaceId,
      workspaceSlug: `pub-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };
    mockedRequire.mockResolvedValue(ctx);
    tmp = await mkdtemp(join(tmpdir(), 'sailscoring-pub-'));
    client = new SailscoringClient({ baseUrl: 'http://localhost', token: 't', fetch: transport });
  });

  afterAll(async () => {
    if (workspaceId) {
      // published_blobs has no workspace FK; clear by key (keys embed the slug).
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await sql?.end();
  });

  /** Seed a series with the given fleet names (1 competitor each) and one race;
   *  returns the series id (and writes its file when `toFile`). */
  async function seedSeries(name: string, fleetNames: string[], toFile?: boolean): Promise<string> {
    const srcId = uuid();
    await series.putSeries(ctx, srcId, {
      id: srcId, name, venue: 'HYC', startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'handicap' as const,
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'startingArea' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      publishRatingCalculations: true, enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    let n = 0;
    for (const fleetName of fleetNames) {
      const fleetId = uuid();
      await fleets.putFleet(ctx, srcId, fleetId, {
        id: fleetId, seriesId: srcId, name: fleetName, displayOrder: n++,
        scoringSystem: 'scratch' as const,
      });
      const compId = uuid();
      await competitors.putCompetitor(ctx, srcId, compId, {
        id: compId, seriesId: srcId, fleetIds: [fleetId], sailNumber: `${n}`,
        name: `${fleetName} boat`, club: 'HYC', gender: '' as const, age: null,
        createdAt: Date.now(),
      });
    }
    const raceId = uuid();
    await races.putRace(ctx, srcId, raceId, {
      id: raceId, seriesId: srcId, raceNumber: 1, date: '2026-07-04', createdAt: Date.now(),
    });
    if (toFile) {
      const file = await buildSeriesFile(srcId, seriesFileReposFor({ workspaceId }));
      await writeFile(join(tmp, `${name.replace(/\s+/g, '-')}.sailscoring`), JSON.stringify(file), 'utf8');
    }
    return srcId;
  }

  test('co-publishes 3 series / 4 fleets under one shared slug', async () => {
    const a = await seedSeries('IODAI Gold Fleet', ['Gold', 'Silver']);
    const b = await seedSeries('IODAI U17', ['U17']);
    const c = await seedSeries('IODAI Optimist', ['Optimist']);

    const results = await runPublish({
      seriesIds: [a, b, c],
      client,
      slug: '2026-iodai',
    });

    expect(results.every((r) => r.status === 'published')).toBe(true);
    expect(results.every((r) => r.slug === '2026-iodai')).toBe(true);

    const group = await getPublishedGroupByWorkspaceSlug(workspaceId, '2026-iodai');
    expect(group.length).toBe(3); // three contributing series
    const totalPages = group.reduce((sum, p) => sum + p.pages.length, 0);
    expect(totalPages).toBe(4); // Gold, Silver, U17, Optimist
  });

  test('resume-on-failure: a bad series id fails but the rest publish', async () => {
    const real = await seedSeries('Standalone Series', ['Fleet A']);

    const results = await runPublish({
      seriesIds: [real, 'does-not-exist', real],
      client,
      slug: 'standalone',
    });

    expect(results[0].status).toBe('published');
    expect(results[1].status).toBe('failed');
    // The third re-publishes the same series (frozen slug) — still ok.
    expect(results[2].status).toBe('published');
  });

  test('import → publish chain co-publishes the imported series', async () => {
    await seedSeries('Chain One', ['Cruisers'], true);
    await seedSeries('Chain Two', ['One Designs'], true);
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(tmp))
      .filter((f) => f.startsWith('Chain'))
      .map((f) => join(tmp, f));

    const imported = await runImport({ files, client });
    expect(imported.every((r) => r.status === 'imported')).toBe(true);

    const published = await runPublish({
      seriesIds: imported.map((r) => r.id!),
      client,
      slug: 'chain-regatta',
    });
    expect(published.every((r) => r.status === 'published')).toBe(true);

    const group = await getPublishedGroupByWorkspaceSlug(workspaceId, 'chain-regatta');
    expect(group.length).toBe(2);
  });
});
