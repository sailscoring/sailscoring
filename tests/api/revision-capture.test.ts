// @vitest-environment node

/**
 * Every handler that changes a series must leave a revision behind.
 *
 * The failure this covers: a handler that logs activity but captures no
 * revision leaves the state it produced with no snapshot to restore, and its
 * activity entry stranded until some later, unrelated edit creates a revision
 * that swallows it. `tests/api-handler-revision-capture.test.ts` guards the
 * shape of the source; this drives the real handlers and checks the rows.
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
import * as trash from '@/lib/api-handlers/trash';
import { pushCompetitorsToRrsOrg } from '@/lib/api-handlers/rrs-org';
import { listRevisions, getRevisionSnapshot } from '@/lib/revision-log';
import { buildSeriesFile } from '@/lib/series-file';
import { seriesFileReposFor } from '@/lib/postgres-repository';
import type { RevisionEntry } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

const ACTOR = 'usr_revision_capture_actor';
const EVENT_UUID = 'd17854ef-f55f-4ab6-8429-3f55527b6e9f';

function sampleSeries(id: string, name = 'Autumn League') {
  return {
    id,
    name,
    venue: 'HYC',
    startDate: '2026-09-05',
    endDate: '2026-10-24',
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

describe.skipIf(skip)('series mutations capture revisions', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let prevUrl: string | undefined;

  /**
   * Handler captures run through `captureRevisionAfter`. Outside a request
   * scope `after()` is unavailable, so it falls back to a floating
   * fire-and-forget capture — poll rather than assume it has landed by the
   * time the handler returns.
   */
  async function revisionsFor(seriesId: string, atLeast = 1): Promise<RevisionEntry[]> {
    const actor = { workspaceId, userId: ACTOR };
    for (let attempt = 0; attempt < 60; attempt++) {
      const items = await listRevisions(actor, seriesId);
      if (items.length >= atLeast) return items;
      await new Promise((r) => setTimeout(r, 50));
    }
    return listRevisions(actor, seriesId);
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_rev_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Revision capture',
      slug: `revcap-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    await db.insert(schema.user).values({
      id: ACTOR,
      name: 'Scorer',
      email: 'revision-capture@sailscoring.test',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // copySeries verifies membership of the target workspace before copying.
    await db.insert(schema.member).values({
      id: `mem_${uuid().replace(/-/g, '')}`,
      organizationId: workspaceId,
      userId: ACTOR,
      role: 'owner',
      createdAt: new Date(),
    });
    ctx = {
      userId: ACTOR,
      email: 'revision-capture@sailscoring.test',
      workspaceId,
      workspaceSlug: `revcap-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: ['rrs-import'],
    };
    prevUrl = process.env.RRS_ORG_API_URL;
    process.env.RRS_ORG_API_URL = 'https://rrs-org.test/api/competitors';
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await db.delete(schema.user).where(eq(schema.user.id, ACTOR));
    await sql?.end();
    if (prevUrl === undefined) delete process.env.RRS_ORG_API_URL;
    else process.env.RRS_ORG_API_URL = prevUrl;
  });

  test('an rrs.org push snapshots the settings it just stored', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    const before = await revisionsFor(id);

    await pushCompetitorsToRrsOrg(ctx, id, {
      eventUuid: EVENT_UUID,
      divisionSource: 'none',
      competitors: [
        {
          competitor_id: 'c1',
          sail_number: '14302',
          country_code: 'IRL',
          first_name: 'Kevin',
          last_name: 'Donnelly',
          boat_name: 'Mistral Behaving',
          boat_class: 'GP14',
          division: '',
          club_name: '',
          email: '',
          phone: '',
          mna_code: 'IRL',
          mna_number: '',
        },
      ],
    });

    const after = await revisionsFor(id, before.length + 1);
    expect(after.length).toBe(before.length + 1);
    expect(after[0].summary).toBe('Pushed 1 competitors to rrs.org');

    // The point of the revision: the push settings are recoverable from it.
    const snapshot = await getRevisionSnapshot({ workspaceId, userId: ACTOR }, after[0].id);
    expect(snapshot?.series.rrsOrgPush).toEqual({
      eventUuid: EVENT_UUID,
      divisionSource: 'none',
    });
  });

  test('marking the results final pins the state that was declared final', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id));
    const before = await revisionsFor(id);

    await series.setSeriesResultsStatus(ctx, id, { status: 'final' });

    const after = await revisionsFor(id, before.length + 1);
    expect(after[0].summary).toBe('Marked the results final');
    const snapshot = await getRevisionSnapshot({ workspaceId, userId: ACTOR }, after[0].id);
    expect(snapshot?.series.resultsStatus).toBe('final');
  });

  test('an imported series starts with a restorable baseline', async () => {
    const sourceId = uuid();
    await series.putSeries(ctx, sourceId, sampleSeries(sourceId, 'Import Source'));
    const file = await buildSeriesFile(sourceId, seriesFileReposFor({ workspaceId }));

    const { id } = await series.importSeries(ctx, { content: JSON.stringify(file) });

    const revisions = await revisionsFor(id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].summary).toBe('Imported series “Import Source”');
    expect(revisions[0].hasSnapshot).toBe(true);
  });

  test('a duplicated series starts with a restorable baseline', async () => {
    const sourceId = uuid();
    await series.putSeries(ctx, sourceId, sampleSeries(sourceId, 'Copy Source'));

    const { id } = await series.copySeries(ctx, sourceId, {});

    const revisions = await revisionsFor(id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].summary).toBe('Duplicated series “Copy Source” as “Copy of Copy Source”');
    expect(revisions[0].hasSnapshot).toBe(true);
  });

  test('a follow-on series starts with a restorable baseline', async () => {
    const sourceId = uuid();
    await series.putSeries(ctx, sourceId, sampleSeries(sourceId, 'Spring League 2026'));

    const { id } = await series.createFollowOnSeries(ctx, sourceId, { name: 'Spring League 2027' });

    const revisions = await revisionsFor(id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].summary).toContain('Created follow-on series “Spring League 2027”');
    expect(revisions[0].hasSnapshot).toBe(true);
  });

  test('a series recovered from the trash keeps its history rather than gaining a baseline', async () => {
    const id = uuid();
    await series.putSeries(ctx, id, sampleSeries(id, 'Deleted Then Recovered'));
    // Settle the create's floating capture before deleting — the tombstone
    // embeds whatever history exists at that moment.
    await revisionsFor(id);
    await series.setSeriesArchived(ctx, id, { archived: true });
    await series.deleteSeries(ctx, id);

    const { items } = await trash.listTrash(ctx);
    const tombstone = items.find((t) => t.seriesId === id);
    expect(tombstone).toBeDefined();

    await trash.restoreFromTrash(ctx, tombstone!.id);

    // Recovery is lossless: the tombstone carries the revision history and
    // re-imports it, so the recovered series is restorable without a fresh
    // baseline being captured on top.
    const revisions = await revisionsFor(id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].summary).toBe('Created the series');
    expect(revisions[0].hasSnapshot).toBe(true);
  });
});
