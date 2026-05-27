// @vitest-environment node

/**
 * Archive (read-only) + scorer-defined categories (#154). Calls the
 * /api/v1 handler functions directly with a synthesised WorkspaceContext,
 * mirroring tests/api/handlers.test.ts. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import {
  ArchivedError,
  BadRequestError,
  NotFoundError,
} from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as categories from '@/lib/api-handlers/categories';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: 'test-user',
    email: 'test@sailscoring.test',
    workspaceId,
    workspaceSlug: 'test-ws',
    role: 'owner',
    features: [],
  };
}

function sampleSeries(id: string) {
  return {
    id,
    name: `Series ${id.slice(0, 8)}`,
    venue: 'HYC',
    startDate: '2026-04-01',
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSnapshotId: null,
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    snapshotHistory: [],
    scoringMode: 'handicap' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    publishRatingCalculations: true,
    enabledCompetitorFields: ['boatName', 'club'],
    primaryPersonLabel: 'helm' as const,
    subdivisionLabel: 'Division',
  };
}

describe.skipIf(skip)('archive + categories (#154)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspace: string;
  let ctx: WorkspaceContext;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspace = `org_ac_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspace,
      name: 'AC',
      slug: `ac-${workspace.slice(7, 17)}`,
      createdAt: new Date(),
    });
    ctx = ctxFor(workspace);
  });

  afterAll(async () => {
    if (workspace) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspace));
    }
    await sql?.end();
  });

  // ─── Archive read-only ───────────────────────────────────────────────────

  test('archive toggle round-trips and gates edits', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));

    // Toggle on.
    const archived = await series.setSeriesArchived(ctx, id, { archived: true });
    expect(archived.archived).toBe(true);
    expect((await series.getSeries(ctx, id)).archived).toBe(true);

    // Edits to the series and its children are rejected while archived.
    await expect(
      series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ArchivedError);
    await expect(series.touchSeries(ctx, id)).rejects.toBeInstanceOf(ArchivedError);
    const fleetId = uuid();
    await expect(
      fleets.putFleet(ctx, id, fleetId, {
        id: fleetId, seriesId: id, name: 'F', displayOrder: 0, scoringSystem: 'irc' as const,
      }),
    ).rejects.toBeInstanceOf(ArchivedError);

    // Unarchive restores writability.
    await series.setSeriesArchived(ctx, id, { archived: false });
    const renamed = await series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Renamed' });
    expect(renamed.name).toBe('Renamed');

    // Clean up via archive-then-delete.
    await series.setSeriesArchived(ctx, id, { archived: true });
    await series.deleteSeries(ctx, id);
  });

  test('delete requires the series to be archived first', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));

    await expect(series.deleteSeries(ctx, id)).rejects.toBeInstanceOf(BadRequestError);

    await series.setSeriesArchived(ctx, id, { archived: true });
    await series.deleteSeries(ctx, id); // now allowed
    await expect(series.getSeries(ctx, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  // ─── Categories ─────────────────────────────────────────────────────────

  test('category CRUD, ordering, and case-insensitive dedup', async () => {
    const a = await categories.createCategory(ctx, { name: 'Autumn' });
    const b = await categories.createCategory(ctx, { name: 'Spring' });
    expect((await categories.listCategories(ctx)).items.map((c) => c.name)).toEqual([
      'Autumn',
      'Spring',
    ]);

    // Case-insensitive duplicate is rejected.
    await expect(
      categories.createCategory(ctx, { name: 'autumn' }),
    ).rejects.toBeInstanceOf(BadRequestError);

    // Rename + reorder.
    await categories.renameCategory(ctx, a.id, { name: 'Autumn League' });
    await categories.reorderCategories(ctx, { orderedIds: [b.id, a.id] });
    expect((await categories.listCategories(ctx)).items.map((c) => c.name)).toEqual([
      'Spring',
      'Autumn League',
    ]);

    await categories.deleteCategory(ctx, a.id);
    await categories.deleteCategory(ctx, b.id);
    expect((await categories.listCategories(ctx)).items).toHaveLength(0);
  });

  test('moving a series to a category, and delete drops it to Uncategorized', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    const cat = await categories.createCategory(ctx, { name: 'Club racing' });

    const moved = await series.setSeriesCategory(ctx, id, { categoryId: cat.id });
    expect(moved.categoryId).toBe(cat.id);

    // Unknown category id is rejected.
    await expect(
      series.setSeriesCategory(ctx, id, { categoryId: uuid() }),
    ).rejects.toBeInstanceOf(BadRequestError);

    // Deleting the category drops the series back to Uncategorized (null) via
    // the ON DELETE SET NULL, not a cascade delete of the series.
    await categories.deleteCategory(ctx, cat.id);
    expect((await series.getSeries(ctx, id)).categoryId).toBeNull();

    // Moving is an edit, so it's blocked while archived; null clears it.
    await series.setSeriesArchived(ctx, id, { archived: true });
    await expect(
      series.setSeriesCategory(ctx, id, { categoryId: null }),
    ).rejects.toBeInstanceOf(ArchivedError);

    await series.deleteSeries(ctx, id);
  });
});
