// @vitest-environment node

/**
 * ADR-009 — `series reorder` drives the workspace series display order (and the
 * order of contributing series on a shared-slug published index). Routes the
 * real SailscoringClient at the real reorder/list handlers with requireWorkspace
 * mocked and a real DB. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';

vi.mock('@/lib/auth/require-workspace', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/require-workspace')>();
  return { ...original, requireWorkspace: vi.fn() };
});

import * as series from '@/lib/api-handlers/series';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { POST as reorderRoute } from '@/app/api/v1/series/reorder/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;
const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;
const uuid = () => crypto.randomUUID();

describe.skipIf(skip)('series reorder (ADR-009)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let client: SailscoringClient;
  const ids: string[] = [];

  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    if (init.method === 'POST' && pathname === '/api/v1/series/reorder') {
      const res = await reorderRoute(
        new Request(url, init) as Parameters<typeof reorderRoute>[0],
        { params: Promise.resolve({}) },
      );
      return { status: res.status, text: () => res.text() };
    }
    throw new Error(`unexpected ${init.method} ${pathname}`);
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    process.env.DATABASE_URL = DATABASE_URL;
    workspaceId = `org_ro_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId, name: 'Reorder', slug: `ro-${workspaceId.slice(7, 17)}`, createdAt: new Date(),
    });
    ctx = {
      userId: 'ro-user', email: 'ro@sailscoring.test', workspaceId,
      workspaceSlug: `ro-${workspaceId.slice(7, 17)}`, role: 'owner', features: [],
    };
    mockedRequire.mockResolvedValue(ctx);
    client = new SailscoringClient({ baseUrl: 'http://localhost', token: 't', fetch: transport });

    // Three series, created in order A, B, C (display order 0, 1, 2).
    for (const name of ['A', 'B', 'C']) {
      const id = uuid();
      ids.push(id);
      await series.putSeries(ctx, id, {
        id, name, venue: '', startDate: '2026-10-01', endDate: '2026-10-02',
        venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
        createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
        scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'startingArea' as const,
        ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
        publishRatingCalculations: true, enabledCompetitorFields: ['boatName'],
        primaryPersonLabel: 'helm' as const, subdivisionLabel: 'Division',
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function orderByName(): Promise<string[]> {
    const rows = await db
      .select({ name: schema.series.name, order: schema.series.displayOrder })
      .from(schema.series)
      .where(eq(schema.series.workspaceId, workspaceId))
      .orderBy(schema.series.displayOrder);
    return rows.map((r) => r.name);
  }

  test('rewrites display order to the submitted id sequence', async () => {
    const [a, b, c] = ids;
    await client.reorderSeries([c, a, b]);
    expect(await orderByName()).toEqual(['C', 'A', 'B']);
  });
});
