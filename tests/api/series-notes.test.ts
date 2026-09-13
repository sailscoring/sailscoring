// @vitest-environment node

/**
 * The published-page notes endpoint (#581). The note that goes out on a
 * results page used to be written through the general series PUT, which
 * carries the whole row and refuses a finalised series — so a scorer
 * publishing a final result could reach the note field and not save it. These
 * drive the real handler: the note lands on a finalised series, it counts as
 * an edit, and it says what it was. Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import { getActivityFeed } from '@/lib/api-handlers/activity';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

const ACTOR = 'usr_series_notes_actor';

function uuid() {
  return crypto.randomUUID();
}

function ctxFor(workspaceId: string): WorkspaceContext {
  return {
    userId: ACTOR,
    email: 'notes-scorer@sailscoring.test',
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
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
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
    subdivisionAxes: [],
  };
}

describe.skipIf(skip)('published-page notes (#581)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspace: string;
  let ctx: WorkspaceContext;

  async function newSeries() {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    return id;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspace = `org_note_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspace,
      name: 'Series notes',
      slug: `notew-${workspace.slice(9, 19)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.user).values({
      id: ACTOR,
      name: 'Scorer',
      email: 'notes-scorer@sailscoring.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ctx = ctxFor(workspace);
  });

  afterAll(async () => {
    if (workspace) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspace));
    }
    await db.delete(schema.user).where(eq(schema.user.id, ACTOR));
    await sql?.end();
  });

  test('writes the note, and counts as an edit', async () => {
    const id = await newSeries();
    const before = await series.getSeries(ctx, id);

    const saved = await series.setSeriesNotes(ctx, id, {
      seriesNote: 'Corrected 16:40 — Q1 finish order revised',
    });

    expect(saved.seriesNote).toBe('Corrected 16:40 — Q1 finish order revised');
    // A note changes what goes out, so the publish indicators should count it.
    expect(saved.version!).toBeGreaterThan(before.version!);

    const params = new URLSearchParams();
    params.set('seriesId', id);
    const { items } = await getActivityFeed(ctx, params);
    expect(items[0].summary).toBe('Edited the note on the published pages');
  });

  test('touches nothing else on the row', async () => {
    const id = await newSeries();
    await series.setSeriesNotes(ctx, id, { seriesNote: 'A note' });
    await series.setSeriesNotes(ctx, id, {
      pageNotes: [{ page: 'fleet:one', text: 'Just this page', updatedAt: Date.now() }],
    });

    const saved = await series.getSeries(ctx, id);
    // The second write named only pageNotes, so the series note survives it —
    // the point of not carrying the whole row.
    expect(saved.seriesNote).toBe('A note');
    expect(saved.pageNotes).toHaveLength(1);
    expect(saved.name).toBe(sampleSeries(id).name);
  });

  test('works on a finalised series, which the general save refuses', async () => {
    const id = await newSeries();
    await series.setSeriesResultsStatus(ctx, id, { status: 'final' });

    // The row save bounces — final results are settled results.
    await expect(series.putSeries(ctx, id, sampleSeries(id))).rejects.toThrow();

    // The note does not: publishing finalised results is allowed, so
    // annotating what goes out has to be too.
    const saved = await series.setSeriesNotes(ctx, id, {
      seriesNote: 'Final — corrected after protest 4',
    });
    expect(saved.seriesNote).toBe('Final — corrected after protest 4');
  });

  test('a note that changes nothing is not an edit', async () => {
    const id = await newSeries();
    await series.setSeriesNotes(ctx, id, { seriesNote: 'Unchanged' });
    const before = await series.getSeries(ctx, id);

    const saved = await series.setSeriesNotes(ctx, id, { seriesNote: 'Unchanged' });
    expect(saved.version).toBe(before.version);
  });

  test('is refused on an archived series', async () => {
    const id = await newSeries();
    await series.setSeriesArchived(ctx, id, { archived: true });
    await expect(
      series.setSeriesNotes(ctx, id, { seriesNote: 'Nope' }),
    ).rejects.toThrow();
    await series.setSeriesArchived(ctx, id, { archived: false });
  });
});
