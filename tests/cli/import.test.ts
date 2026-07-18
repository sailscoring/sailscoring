// @vitest-environment node

/**
 * ADR-009 M3 — drives the CLI's bulk-import orchestration (`runImport`) over
 * a real `SailscoringClient` whose transport is routed at the real
 * `POST /api/v1/series/import` handler (requireWorkspace mocked, real DB). So
 * this exercises the full path: runner → client → endpoint → Postgres.
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
import { buildSeriesFile } from '@/lib/series-file';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { POST as importRoute } from '@/app/api/v1/series/import/route';
import { SailscoringClient, type FetchLike } from '@/cli/client';
import { runImport } from '@/cli/import-runner';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const mockedRequire = requireWorkspace as ReturnType<typeof vi.fn>;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('CLI bulk import (ADR-009 M3)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let tmp: string;
  let client: SailscoringClient;

  // Route the client's fetch at the real import route handler.
  const transport: FetchLike = async (url, init) => {
    const { pathname } = new URL(url);
    if (init.method === 'POST' && pathname === '/api/v1/series/import') {
      const req = new Request(url, {
        method: 'POST',
        headers: init.headers,
        body: init.body,
      });
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
    workspaceId = `org_cli_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'CLI',
      slug: `cli-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'cli-user',
      email: 'cli@sailscoring.test',
      workspaceId,
      workspaceSlug: 'cli-ws',
      role: 'owner',
      features: [],
    };
    mockedRequire.mockResolvedValue(ctx);
    tmp = await mkdtemp(join(tmpdir(), 'sailscoring-cli-'));
    client = new SailscoringClient({ baseUrl: 'http://localhost', token: 't', fetch: transport });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    if (tmp) await rm(tmp, { recursive: true, force: true });
    await sql?.end();
  });

  /** Seed a series and write its `.sailscoring` file into the temp dir. */
  async function seedFile(name: string): Promise<string> {
    const srcId = uuid();
    await series.putSeries(ctx, srcId, {
      id: srcId, name, venue: 'HYC', startDate: '2026-06-01', endDate: '2026-06-30',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'handicap' as const,
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      dnfScoring: 'startingArea' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
      publishRatingCalculations: true, enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const fleetId = uuid();
    await fleets.putFleet(ctx, srcId, fleetId, {
      id: fleetId, seriesId: srcId, name: 'IRC', displayOrder: 0, scoringSystem: 'irc' as const,
    });
    const compId = uuid();
    await competitors.putCompetitor(ctx, srcId, compId, {
      id: compId, seriesId: srcId, fleetIds: [fleetId], sailNumber: '1',
      names: [`Boat ${name}`], club: 'HYC', gender: '' as const, age: null, createdAt: Date.now(),
    });
    const file = await buildSeriesFile(srcId, seriesFileReposFor({ workspaceId }));
    const path = join(tmp, `${name.replace(/\s+/g, '-')}.sailscoring`);
    await writeFile(path, JSON.stringify(file), 'utf8');
    return path;
  }

  async function seriesCount(): Promise<number> {
    return (await seriesFileReposFor({ workspaceId }).seriesRepo.list()).length;
  }

  test('imports every file and is idempotent on a re-run', async () => {
    const files = await Promise.all([
      seedFile('Alpha League'),
      seedFile('Bravo League'),
      seedFile('Charlie League'),
    ]);
    const before = await seriesCount();

    const first = await runImport({ files, client, concurrency: 2 });
    expect(first.every((r) => r.status === 'imported')).toBe(true);
    expect(new Set(first.map((r) => r.id)).size).toBe(3);
    expect(await seriesCount()).toBe(before + 3);

    // Re-run: same content → same Idempotency-Key → server replays, no new rows.
    const second = await runImport({ files, client, concurrency: 2 });
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect(await seriesCount()).toBe(before + 3);
  });

  test('resume-on-failure: a malformed file fails but the batch continues', async () => {
    const good = await seedFile('Delta League');
    const bad = join(tmp, 'broken.sailscoring');
    await writeFile(bad, 'not a valid sailscoring file', 'utf8');
    const good2 = await seedFile('Echo League');
    const before = await seriesCount();

    const results = await runImport({ files: [good, bad, good2], client, concurrency: 1 });

    expect(results.find((r) => r.file === bad)?.status).toBe('failed');
    expect(results.filter((r) => r.status === 'imported').length).toBe(2);
    // Only the two good files landed.
    expect(await seriesCount()).toBe(before + 2);
  });
});
