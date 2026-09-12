// @vitest-environment node

/**
 * Recording an FTP upload.
 *
 * The upload itself runs in the browser against the scupper relay, so this
 * handler is the only account of it the server ever gets. It has to do both
 * halves: store where each page went, and record the upload as a publishing
 * act — an activity entry, a pinned `publish` revision, and a seal on the
 * open editing session.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import { recordFtpUpload } from '@/lib/api-handlers/publish';
import { listActivity } from '@/lib/activity-log';
import { listRevisions } from '@/lib/revision-log';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('recording an FTP upload', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;

  async function makeSeries(name: string): Promise<string> {
    const id = uuid();
    await series.putSeries(ctx, id, {
      id, name, venue: 'HYC',
      startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    return id;
  }

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_ftu_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'FTP Upload',
      slug: `ftu-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'ftu-user',
      email: 'ftu@sailscoring.test',
      workspaceId,
      workspaceSlug: `ftu-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  test('stores the provenance and stamps the version the upload reflects', async () => {
    const id = await makeSeries('Uploaded Series');
    const serverId = uuid();
    const before = (await series.getSeries(ctx, id))!;

    const saved = await recordFtpUpload(ctx, id, {
      serverId,
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/cruisers.html' },
      excluded: ['prizes'],
      pageCount: 1,
    });

    expect(saved.ftpServerId).toBe(serverId);
    expect(saved.ftpHost).toBe('results.hyc.ie');
    expect(saved.ftpPaths).toEqual({ 'fleet:a': '/web/cruisers.html' });
    expect(saved.ftpPagesExcluded).toEqual(['prizes']);
    expect(saved.ftpLastUploadedAt).toBeGreaterThan(0);
    // The version this upload reflects is the live one: the record doesn't
    // bump it, so there is no write of its own to account for — and the
    // "N edits since" count reads zero straight after an upload.
    expect(saved.ftpUploadedVersion).toBe(before.version);
    expect(saved.version).toBe(before.version);
  });

  test('merges paths but replaces the exclusions', async () => {
    const id = await makeSeries('Merged Paths Series');
    await recordFtpUpload(ctx, id, {
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/a.html', 'fleet:b': '/web/b.html' },
      excluded: ['prizes', 'entries'],
      pageCount: 2,
    });

    // A second upload of one page only. Its sibling keeps the path its own
    // upload used; the tick state is whatever it is now, not the union.
    const saved = await recordFtpUpload(ctx, id, {
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/cruisers.html' },
      excluded: ['prizes'],
      pageCount: 1,
    });

    expect(saved.ftpPaths).toEqual({
      'fleet:a': '/web/cruisers.html',
      'fleet:b': '/web/b.html',
    });
    expect(saved.ftpPagesExcluded).toEqual(['prizes']);
  });

  test('records the upload in the activity feed', async () => {
    const id = await makeSeries('Logged Upload Series');
    await recordFtpUpload(ctx, id, {
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/a.html' },
      excluded: [],
      pageCount: 3,
    });

    const { items } = await listActivity({
      workspaceId,
      seriesId: id,
      page: { limit: 50, cursor: null },
    });
    expect(items[0].action).toBe('publish.ftp-uploaded');
    expect(items[0].summary).toBe('Uploaded 3 pages to results.hyc.ie');
    // Not an "Updated series settings" row, which is all this used to leave.
    expect(items.map((i) => i.action)).not.toContain('series.updated');
  });

  test('counts a single page in the singular', async () => {
    const id = await makeSeries('One Page Series');
    await recordFtpUpload(ctx, id, {
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/a.html' },
      excluded: [],
      pageCount: 1,
    });

    const { items } = await listActivity({
      workspaceId,
      seriesId: id,
      page: { limit: 50, cursor: null },
    });
    expect(items[0].summary).toBe('Uploaded 1 page to results.hyc.ie');
  });

  test('pins a publish revision naming the host', async () => {
    const id = await makeSeries('Pinned Upload Series');
    await recordFtpUpload(ctx, id, {
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/a.html' },
      excluded: [],
      pageCount: 2,
    });

    const revisions = await listRevisions(ctx, id);
    const pinned = revisions.find((r) => r.kind === 'publish');
    expect(pinned).toBeDefined();
    expect(pinned!.label).toBe('Uploaded 2 pages to results.hyc.ie');
  });

  test('seals the open session, so later edits start a fresh version', async () => {
    const id = await makeSeries('Sealed Session Series');
    await recordFtpUpload(ctx, id, {
      host: 'results.hyc.ie',
      paths: { 'fleet:a': '/web/a.html' },
      excluded: [],
      pageCount: 1,
    });

    // An edit after the upload. Without the seal it would coalesce into the
    // auto revision that was open before the upload, putting a change the
    // upload didn't carry inside a version that predates it.
    const current = (await series.getSeries(ctx, id))!;
    await series.putSeries(ctx, id, { ...current, venue: 'Howth' });

    // Polled: an auto revision is captured after the response flushes, and
    // outside a request scope that becomes a floating promise with no handle
    // to await.
    await expect
      .poll(async () => {
        const revisions = await listRevisions(ctx, id);
        // Newest first, so a fresh revision sits above the pinned publish one
        // rather than the edit having folded in underneath it.
        return revisions.findIndex((r) => r.kind === 'publish');
      })
      .toBeGreaterThan(0);
  });

  test('a missing series is a 404', async () => {
    await expect(
      recordFtpUpload(ctx, uuid(), {
        host: 'results.hyc.ie',
        paths: {},
        excluded: [],
        pageCount: 1,
      }),
    ).rejects.toThrow();
  });
});
