// @vitest-environment node

/**
 * ADR-009 M3.2 — CLI categorise + archive, driven over a real
 * `SailscoringClient` routed at the real category/archive route handlers
 * (requireWorkspace mocked, real DB).
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
import { createRepos } from '@/lib/postgres-repository';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { GET as categoriesGET, POST as categoriesPOST } from '@/app/api/v1/categories/route';
import { POST as categoryRoute } from '@/app/api/v1/series/[id]/category/route';
import { POST as archiveRoute } from '@/app/api/v1/series/[id]/archive/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';
import { findOrCreateCategory, runPerSeries } from '@/cli/series-ops';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('CLI categorise + archive (ADR-009 M3.2)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let client: SailscoringClient;

  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    const mk = () => new Request(url, { method: init.method, headers: init.headers, body: init.body });
    const wrap = async (res: Response) => ({ status: res.status, text: () => res.text() });

    if (pathname === '/api/v1/categories') {
      const route = init.method === 'GET' ? categoriesGET : categoriesPOST;
      return wrap(await route(mk() as Parameters<typeof route>[0], { params: Promise.resolve({}) }));
    }
    const cat = /^\/api\/v1\/series\/([^/]+)\/category$/.exec(pathname);
    if (cat && init.method === 'POST') {
      return wrap(await categoryRoute(mk() as Parameters<typeof categoryRoute>[0], { params: Promise.resolve({ id: cat[1] }) }));
    }
    const arch = /^\/api\/v1\/series\/([^/]+)\/archive$/.exec(pathname);
    if (arch && init.method === 'POST') {
      return wrap(await archiveRoute(mk() as Parameters<typeof archiveRoute>[0], { params: Promise.resolve({ id: arch[1] }) }));
    }
    throw new Error(`unexpected ${init.method} ${pathname}`);
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_ops_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Ops', slug: `ops-${workspaceId.slice(8, 18)}`, createdAt: new Date(),
    });
    ctx = {
      userId: 'ops-user', email: 'ops@sailscoring.test', workspaceId,
      workspaceSlug: `ops-${workspaceId.slice(8, 18)}`, role: 'owner', features: [],
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

  async function seedSeries(name: string): Promise<string> {
    const id = uuid();
    await series.putSeries(ctx, id, {
      id, name, venue: 'HYC', startDate: '2026-08-01', endDate: '2026-08-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'handicap' as const,
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'startingArea' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      publishRatingCalculations: true, enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    return id;
  }

  test('categorise: find-or-create is idempotent and sets the category', async () => {
    const a = await seedSeries('Series A');
    const b = await seedSeries('Series B');

    const catId = await findOrCreateCategory(client, 'Nationals 2026');
    const results = await runPerSeries([a, b], (id) => client.setSeriesCategory(id, catId));
    expect(results.every((r) => r.status === 'ok')).toBe(true);

    const repos = createRepos({ workspaceId });
    expect((await repos.series.get(a))!.categoryId).toBe(catId);
    expect((await repos.series.get(b))!.categoryId).toBe(catId);

    // Same name again → same id, no duplicate category row.
    const again = await findOrCreateCategory(client, 'nationals 2026'); // case-insensitive
    expect(again).toBe(catId);
    const cats = (await client.listCategories()).items.filter(
      (c) => c.name.toLowerCase() === 'nationals 2026',
    );
    expect(cats.length).toBe(1);
  });

  test('archive then unarchive flips the flag', async () => {
    const a = await seedSeries('Archive Me');
    const repos = createRepos({ workspaceId });

    await runPerSeries([a], (id) => client.setSeriesArchived(id, true));
    expect((await repos.series.get(a))!.archived).toBe(true);

    await runPerSeries([a], (id) => client.setSeriesArchived(id, false));
    expect((await repos.series.get(a))!.archived).toBe(false);
  });

  test('categorising an archived series is rejected (categorise before archive)', async () => {
    const a = await seedSeries('Locked');
    const catId = await findOrCreateCategory(client, 'Locked Cat');

    await runPerSeries([a], (id) => client.setSeriesArchived(id, true));
    const results = await runPerSeries([a], (id) => client.setSeriesCategory(id, catId));
    expect(results[0].status).toBe('failed');
  });
});
