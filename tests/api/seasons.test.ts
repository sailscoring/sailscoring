/**
 * Workspace seasons management (ADR-011): defined seasons union the derived
 * ones, the current flag round-trips, and the adopt helper pins year-named
 * categories onto published folders.
 */
import { randomUUID as uuid } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as seasons from '@/lib/api-handlers/seasons';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as schema from '@/lib/db/schema';
import { upsertPublishedFolder } from '@/lib/published-repository';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

describe.skipIf(skip)('workspace seasons', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId!: string;
  let ctx!: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_seasons_${uuid().replace(/-/g, '')}`;
    ctx = {
      userId: 'seasons-user',
      email: 'seasons@sailscoring.test',
      workspaceId,
      workspaceSlug: 'seasons-ws',
      role: 'owner',
      features: [],
    };
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'seasons-test',
      slug: `seasons-${workspaceId.slice(12, 20)}`,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  test('defined seasons union derived ones; current round-trips', async () => {
    const created = await seasons.createSeason(ctx, { label: '2027' });
    expect(created.items.map((s) => s.label)).toContain('2027');
    // The only season is current by default (newest label).
    expect(created.items.find((s) => s.label === '2027')?.current).toBe(true);

    await seasons.createSeason(ctx, { label: '2026-27' });
    // Newest label sorts first and is current until one is flagged.
    const flipped = await seasons.setCurrentSeason(ctx, { label: '2026-27' });
    expect(flipped.items.find((s) => s.label === '2026-27')?.current).toBe(true);
    expect(flipped.items.find((s) => s.label === '2027')?.current).toBe(false);

    await expect(
      seasons.createSeason(ctx, { label: '2027' }),
    ).rejects.toThrowError(/already exists/);
    await expect(
      seasons.setCurrentSeason(ctx, { label: '1999' }),
    ).rejects.toThrowError(/no such season/);
  });

  test('a folder season pin surfaces in the list with its folder counted', async () => {
    const seriesId = uuid();
    await db.insert(schema.series).values({
      id: seriesId,
      workspaceId,
      name: 'Pinned Series',
      displayOrder: 0,
      version: 1,
    });
    await db.insert(schema.publishedSeries).values({
      id: uuid(),
      workspaceId,
      seriesId,
      slug: 'pinned-open-week',
      pages: [],
      contentHash: 'x',
      publishedVersion: 1,
    });
    await upsertPublishedFolder(workspaceId, 'pinned-open-week', {
      season: '2025',
    });

    const listed = await seasons.listSeasons(ctx);
    expect(
      listed.items.find((s) => s.label === '2025')?.folderCount,
    ).toBe(1);
  });
});
