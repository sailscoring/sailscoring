// @vitest-environment node

/**
 * CLI ranking methods (#209), routed at the real route handlers
 * (requireWorkspace mocked, real DB): create → set (config + slug) → get →
 * standings round-trip through `/api/v1/rankings`.
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

import { requireWorkspace } from '@/lib/auth/require-workspace';
import {
  GET as rankingsGET,
  POST as rankingsPOST,
} from '@/app/api/v1/rankings/route';
import {
  GET as rankingGET,
  PUT as rankingPUT,
} from '@/app/api/v1/rankings/[id]/route';
import { GET as standingsGET } from '@/app/api/v1/rankings/[id]/standings/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('CLI ranking methods (#209)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let client: SailscoringClient;

  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const wrap = async (res: Response) => ({ status: res.status, text: () => res.text() });
    const req = () => new Request(url, { method: init.method, headers: init.headers, body: init.body });
    const noParams = { params: Promise.resolve({}) };
    if (init.method === 'GET' && pathname === '/api/v1/rankings') {
      return wrap(await rankingsGET(req() as Parameters<typeof rankingsGET>[0], noParams));
    }
    if (init.method === 'POST' && pathname === '/api/v1/rankings') {
      return wrap(await rankingsPOST(req() as Parameters<typeof rankingsPOST>[0], noParams));
    }
    const one = /^\/api\/v1\/rankings\/([^/]+)$/.exec(pathname);
    if (init.method === 'GET' && one) {
      return wrap(await rankingGET(req() as Parameters<typeof rankingGET>[0], { params: Promise.resolve({ id: one[1] }) }));
    }
    if (init.method === 'PUT' && one) {
      return wrap(await rankingPUT(req() as Parameters<typeof rankingPUT>[0], { params: Promise.resolve({ id: one[1] }) }));
    }
    const std = /^\/api\/v1\/rankings\/([^/]+)\/standings$/.exec(pathname);
    if (init.method === 'GET' && std) {
      return wrap(await standingsGET(req() as Parameters<typeof standingsGET>[0], { params: Promise.resolve({ id: std[1] }) }));
    }
    throw new Error(`unexpected ${init.method} ${pathname}`);
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_rk_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'RankCli', slug: `rk-${workspaceId.slice(7, 17)}`, createdAt: new Date(),
    });
    const ctx: WorkspaceContext = {
      userId: 'rk-user', email: 'rk@sailscoring.test', workspaceId,
      workspaceSlug: `rk-${workspaceId.slice(7, 17)}`, role: 'owner',
      features: ['rankings'],
    };
    mockedRequire.mockResolvedValue(ctx);
    client = new SailscoringClient({ baseUrl: 'http://localhost', token: 't', fetch: transport });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('create, set config + slug, read back, standings', async () => {
    const created = await client.createRanking('Season 2025 (Senior)');
    expect(created.published).toBe(false);

    const seriesId = uuid();
    const identityId = uuid();
    const config = {
      buckets: [
        { id: 'national', name: 'National', seriesIds: [seriesId], countBest: 1, requiredMin: 1 },
      ],
      nationality: 'IRL',
      recomputePlaces: true,
      fleet: 'Senior',
      adjustments: [
        { identityId, seriesId, place: 11.5, note: 'Worlds team duty — averaged' },
      ],
    };
    const updated = await client.putRanking(created.id, {
      name: created.name,
      config,
      published: false,
      slug: 'senior-2025',
    });
    expect(updated.slug).toBe('senior-2025');
    expect(updated.config).toEqual(config);

    const fetched = await client.getRanking(created.id);
    expect(fetched.config).toEqual(config);
    const all = await client.listRankings();
    expect(all.items.map((r) => r.id)).toContain(created.id);

    // The config references a series that doesn't exist: an empty but
    // well-formed ladder, not an error.
    const standings = (await client.rankingStandings(created.id)) as {
      result: { rows: unknown[] };
      includedSeries: unknown[];
    };
    expect(standings.result.rows).toEqual([]);
    expect(standings.includedSeries).toEqual([]);
  });
});
