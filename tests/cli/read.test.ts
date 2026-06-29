// @vitest-environment node

/**
 * ADR-009 M4 — the CLI client's read methods, routed at the real GET route
 * handlers (requireWorkspace mocked, real DB). Confirms whoami, series
 * list/get, child lists, and standings round-trip through `/api/v1`.
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
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { GET as workspaceGET } from '@/app/api/v1/workspace/route';
import { GET as seriesListGET } from '@/app/api/v1/series/route';
import { GET as seriesGetGET } from '@/app/api/v1/series/[id]/route';
import { GET as competitorsGET } from '@/app/api/v1/series/[id]/competitors/route';
import { GET as standingsGET } from '@/app/api/v1/series/[id]/standings/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('CLI read methods (ADR-009 M4)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let client: SailscoringClient;
  let seriesId: string;

  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const wrap = async (res: Response) => ({ status: res.status, text: () => res.text() });
    const noParams = { params: Promise.resolve({}) };
    if (init.method === 'GET' && pathname === '/api/v1/workspace') {
      return wrap(await workspaceGET(new Request(url) as Parameters<typeof workspaceGET>[0], noParams));
    }
    if (init.method === 'GET' && pathname === '/api/v1/series') {
      return wrap(await seriesListGET(new Request(url) as Parameters<typeof seriesListGET>[0], noParams));
    }
    const get = /^\/api\/v1\/series\/([^/]+)$/.exec(pathname);
    if (init.method === 'GET' && get) {
      return wrap(await seriesGetGET(new Request(url) as Parameters<typeof seriesGetGET>[0], { params: Promise.resolve({ id: get[1] }) }));
    }
    const comp = /^\/api\/v1\/series\/([^/]+)\/competitors$/.exec(pathname);
    if (init.method === 'GET' && comp) {
      return wrap(await competitorsGET(new Request(url) as Parameters<typeof competitorsGET>[0], { params: Promise.resolve({ id: comp[1] }) }));
    }
    const std = /^\/api\/v1\/series\/([^/]+)\/standings$/.exec(pathname);
    if (init.method === 'GET' && std) {
      return wrap(await standingsGET(new Request(url) as Parameters<typeof standingsGET>[0], { params: Promise.resolve({ id: std[1] }) }));
    }
    throw new Error(`unexpected ${init.method} ${pathname}`);
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_rd_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Read', slug: `rd-${workspaceId.slice(7, 17)}`, createdAt: new Date(),
    });
    ctx = {
      userId: 'rd-user', email: 'rd@sailscoring.test', workspaceId,
      workspaceSlug: `rd-${workspaceId.slice(7, 17)}`, role: 'owner', features: ['logo-library'],
    };
    mockedRequire.mockResolvedValue(ctx);
    client = new SailscoringClient({ baseUrl: 'http://localhost', token: 't', fetch: transport });

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Read Series', venue: 'HYC', startDate: '2026-10-01', endDate: '2026-10-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'startingArea' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      publishRatingCalculations: true, enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const fleetId = uuid();
    await fleets.putFleet(ctx, seriesId, fleetId, {
      id: fleetId, seriesId, name: 'IRC', displayOrder: 0, scoringSystem: 'scratch' as const,
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, seriesId, compId, {
      id: compId, seriesId, fleetIds: [fleetId], sailNumber: '999', name: 'Read Boat',
      club: 'HYC', gender: '' as const, age: null, createdAt: Date.now(),
    });
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-10-04', createdAt: Date.now(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('whoami returns the resolved identity', async () => {
    const me = (await client.whoami()) as { workspaceSlug: string; role: string; features: string[] };
    expect(me.workspaceSlug).toBe(ctx.workspaceSlug);
    expect(me.role).toBe('owner');
    expect(me.features).toContain('logo-library');
  });

  test('series list/get and competitor list round-trip', async () => {
    const list = (await client.listSeries()) as { items: { id: string }[] };
    expect(list.items.some((s) => s.id === seriesId)).toBe(true);

    const one = (await client.getSeries(seriesId)) as { name: string };
    expect(one.name).toBe('Read Series');

    const comps = (await client.listCompetitors(seriesId)) as { sailNumber: string }[];
    expect(comps.map((c) => c.sailNumber)).toContain('999');
  });

  test('standings returns the public export', async () => {
    const standings = (await client.getStandings(seriesId)) as {
      series: { name: string };
      standings: unknown[];
    };
    expect(standings.series.name).toBe('Read Series');
    expect(Array.isArray(standings.standings)).toBe(true);
  });
});
