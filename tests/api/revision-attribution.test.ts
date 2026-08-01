// @vitest-environment node

/**
 * Activity-to-revision attribution (#354).
 *
 * History used to bucket activity into a revision by timestamp — everything
 * since the previous revision — so an entry no revision covered was absorbed by
 * whatever edit came next, however much later, and that revision then described
 * itself with changes its snapshot doesn't contain. Attribution is now stamped
 * at capture time; these tests hold the seam that does it.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as races from '@/lib/api-handlers/races';
import { getActivityFeed } from '@/lib/api-handlers/activity';
import { listRevisions } from '@/lib/revision-log';
import type { ActivityEntry } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

const ACTOR = 'usr_revision_attribution_actor';

function sampleSeries(id: string) {
  return {
    id,
    name: `Attribution ${id.slice(0, 8)}`,
    venue: 'HYC',
    startDate: '2026-05-02',
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: Date.now(),
    lastSavedAt: null,
    lastModifiedAt: Date.now(),
    scoringMode: 'scratch' as const,
    discardThresholds: [],
    dnfScoring: 'seriesEntries' as const,
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: false,
    enabledCompetitorFields: ['boatName'],
    primaryPersonLabel: 'helm' as const,
    subdivisionAxes: [],
  };
}

describe.skipIf(skip)('activity is attributed to the revision that captured it', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  async function feed(seriesId: string): Promise<ActivityEntry[]> {
    const params = new URLSearchParams();
    params.set('seriesId', seriesId);
    const { items } = await getActivityFeed(ctx, params);
    return items;
  }

  /** Handler captures run through `captureRevisionAfter`, which falls back to a
   *  floating promise outside a request scope — poll for the attribution. */
  async function attributed(seriesId: string, action: string): Promise<ActivityEntry> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const entry = (await feed(seriesId)).find((e) => e.action === action);
      if (entry?.revisionId) return entry;
      await new Promise((r) => setTimeout(r, 50));
    }
    const entry = (await feed(seriesId)).find((e) => e.action === action);
    if (!entry) throw new Error(`no activity entry for ${action}`);
    return entry;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_attr_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Attribution',
      slug: `attr-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.user).values({
      id: ACTOR,
      name: 'Scorer',
      email: 'attribution@sailscoring.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    ctx = {
      userId: ACTOR,
      email: 'attribution@sailscoring.test',
      workspaceId,
      workspaceSlug: `attr-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await db.delete(schema.user).where(eq(schema.user.id, ACTOR));
    await sql?.end();
  });

  test('a tracked change points at the revision holding its snapshot', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));

    const entry = await attributed(id, 'series.created');
    const revisions = await listRevisions({ workspaceId, userId: ACTOR }, id);
    expect(entry.revisionId).toBe(revisions[0].id);
  });

  test('changes sharing a revision session all point at that one revision', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    await attributed(id, 'series.created');

    const raceId = uuid();
    await races.putRace(ctx, id, raceId, {
      id: raceId,
      seriesId: id,
      raceNumber: 1,
      date: '2026-05-02',
      createdAt: Date.now(),
    });
    await attributed(id, 'race.added');

    const revisions = await listRevisions({ workspaceId, userId: ACTOR }, id);
    const entries = await feed(id);
    // Every entry resolves to a revision that exists, and none is left for a
    // later unrelated edit to adopt.
    const ids = new Set(revisions.map((r) => r.id));
    for (const e of entries) {
      expect(e.revisionId, `${e.action} is unattributed`).not.toBeNull();
      expect(ids.has(e.revisionId!), `${e.action} points at a missing revision`).toBe(true);
    }
  });

  test('a change that snapshots nothing stays unattributed, and a later edit does not adopt it', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    await attributed(id, 'series.created');

    // Filing a series in a category stores nothing recoverable, so it captures
    // no revision by design.
    const categoryId = uuid();
    await db.insert(schema.categories).values({
      id: categoryId,
      workspaceId,
      name: 'Autumn',
      displayOrder: 0,
    });
    await series.setSeriesCategory(ctx, id, { categoryId });

    // An unrelated later edit — the kind that used to swallow everything back
    // to the previous revision.
    const raceId = uuid();
    await races.putRace(ctx, id, raceId, {
      id: raceId,
      seriesId: id,
      raceNumber: 1,
      date: '2026-05-02',
      createdAt: Date.now(),
    });
    const laterEdit = await attributed(id, 'race.added');

    const recategorized = (await feed(id)).find((e) => e.action === 'series.recategorized');
    expect(recategorized).toBeDefined();
    expect(recategorized!.revisionId).toBeNull();
    expect(laterEdit.revisionId).not.toBe(recategorized!.revisionId);
  });

  test('coalesced per-row writes stay one entry, attributed to their revision', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    await series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Renamed' });
    await series.putSeries(ctx, id, { ...sampleSeries(id), name: 'Renamed twice' });

    const entry = await attributed(id, 'series.updated');
    // Coalescing survives attribution: two edits are still one entry, not one
    // row per revision capture.
    expect(entry.count).toBe(2);
    const revisions = await listRevisions({ workspaceId, userId: ACTOR }, id);
    expect(revisions.map((r) => r.id)).toContain(entry.revisionId);
  });
});
