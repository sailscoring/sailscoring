// @vitest-environment node

/**
 * Publishing to a club's own web server, which rides along with publishing
 * on Sail Scoring: every page a publish builds that has an FTP path is
 * uploaded there, as the page just published, with links between pages
 * rebuilt for the club's site and root-relative URLs made absolute.
 *
 * The scupper relay is stood in for by a recording uploader.
 *
 * Skipped when DATABASE_URL is unset.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres, { type Sql } from 'postgres';

import * as schema from '@/lib/db/schema';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import * as series from '@/lib/api-handlers/series';
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as finishes from '@/lib/api-handlers/finishes';
import * as raceStarts from '@/lib/api-handlers/race-starts';
import * as splitFleets from '@/lib/api-handlers/split-fleets';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import { putFtpServer } from '@/lib/api-handlers/ftp-servers';
import { publishSeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml } from '@/lib/blob-storage';
import { listActivity } from '@/lib/activity-log';
import { createRepos } from '@/lib/postgres-repository';
import { fleetPageKey } from '@/lib/publish-pages';
import type { FtpUploader, FtpUploadResult } from '@/lib/scupper';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — uploading to the club site', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  const fleetIds: Record<string, string> = {};
  const serverId = uuid();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  // What reached the "server", and what it answers next.
  let uploads: { host: string; path: string; html: string }[] = [];
  let answers: FtpUploadResult[] = [];
  const upload: FtpUploader = async (server, path, html) => {
    uploads.push({ host: server.host, path, html });
    return answers.shift() ?? { ok: true };
  };
  const opts = { ftpUpload: upload, ftpSleep: () => Promise.resolve() };

  async function setPaths(paths: Record<string, string>) {
    await createRepos({ workspaceId }).series.setPublishPrefs(seriesId, { ftpPaths: paths });
  }

  beforeAll(async () => {
    // Root-relative URLs are made absolute against the app's own.
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.sailscoring.test';
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_ftp_${uuid().replace(/-/g, '')}`;
    const slug = `ftp-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({ id: workspaceId, name: 'FTP Club', slug, createdAt: new Date() });
    ctx = {
      userId: 'ftp-user', email: 'ftp@sailscoring.test', workspaceId,
      workspaceSlug: slug, role: 'owner', features: ['ftp-upload', 'schedule-page'],
    };
    await putFtpServer(ctx, serverId, {
      id: serverId, host: 'ftp.club.ie', port: 21, username: 'scorer', password: 's3cret', ftps: false, version: 1,
    });

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Frostbites', venue: 'HYC',
      startDate: '2026-11-01', endDate: '',
      // A library logo, which the published page references root-relative.
      venueLogoUrl: '/logos/club-burgee', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    for (const [i, name] of ['Fast', 'Slow'].entries()) {
      const id = uuid();
      fleetIds[name] = id;
      await fleets.putFleet(ctx, seriesId, id, { id, seriesId, name, displayOrder: i, scoringSystem: 'scratch' as const });
    }
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, { id: raceId, seriesId, raceNumber: 1, date: '2026-11-01', createdAt: Date.now() });
    // The schedule names Fast's start alone, so it links the race to Fast's page.
    const startId = uuid();
    await raceStarts.putRaceStart(ctx, raceId, startId, {
      id: startId, raceId, fleetIds: [fleetIds.Fast], startTime: '11:00:00',
    });
    for (const [i, fleet] of ['Fast', 'Slow'].entries()) {
      const competitorId = uuid();
      await competitors.putCompetitor(ctx, seriesId, competitorId, {
        id: competitorId, seriesId, fleetIds: [fleetIds[fleet]], sailNumber: `${i + 1}`, names: [`Helm ${i + 1}`],
        clubs: [], gender: '' as const, age: null, createdAt: Date.now(),
      });
      const finishId = uuid();
      await finishes.putFinish(ctx, raceId, finishId, {
        id: finishId, raceId, competitorId, sortOrder: i + 1, tiedWithPrevious: false, resultCode: null,
        startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
        redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
      });
    }
  });

  beforeEach(() => {
    uploads = [];
    answers = [];
  });

  afterAll(async () => {
    if (appUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = appUrl;
    if (workspaceId) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  test('a series with no FTP paths publishes on Sail Scoring alone', async () => {
    const result = await publishSeries(ctx, seriesId, { fleets: ['Fast'] }, opts);
    expect(result.ftp).toBeUndefined();
    expect(uploads).toEqual([]);
  });

  test('the pages a publish builds go to their paths; the rest stay here', async () => {
    await setPaths({
      [fleetPageKey(fleetIds.Fast)]: '/public_html/results/fast.html',
      schedule: '/public_html/results/schedule.html',
    });
    const result = await publishSeries(ctx, seriesId, { fleets: ['Fast', 'Slow', 'Schedule'] }, opts);

    expect(uploads.map((u) => [u.host, u.path])).toEqual([
      ['ftp.club.ie', '/public_html/results/fast.html'],
      ['ftp.club.ie', '/public_html/results/schedule.html'],
    ]);
    expect(result.ftp).toEqual({
      host: 'ftp.club.ie',
      uploaded: [
        { fleetName: 'Fast', path: '/public_html/results/fast.html' },
        { fleetName: 'Schedule', path: '/public_html/results/schedule.html' },
      ],
      failed: null,
      notAttempted: [],
      unmapped: [{ fleetName: 'Slow' }],
    });

    // The page as published, with the library logo pointing back at the app.
    const published = (await getPublishedBySeries(seriesId))!;
    const fastPage = published.pages.find((p) => p.fleetName === 'Fast')!;
    const html = (await readPublishedHtml(fastPage.blobUrl))!;
    expect(html).toContain('src="/logos/club-burgee"');
    expect(uploads[0].html).toBe(
      html.replace('src="/logos/club-burgee"', 'src="https://app.sailscoring.test/logos/club-burgee"'),
    );

    // The schedule links the race to the Fast page's copy on the club site,
    // where on Sail Scoring it links the Fast page there.
    const schedulePage = published.pages.find((p) => p.isSchedule)!;
    expect(await readPublishedHtml(schedulePage.blobUrl)).toContain('href="fast">Results</a>');
    expect(uploads[1].html).toContain('href="fast.html">Results</a>');
  });

  test('the upload is recorded, without counting as an edit', async () => {
    const before = (await createRepos({ workspaceId }).series.get(seriesId))!;
    await publishSeries(ctx, seriesId, { fleets: ['Fast'] }, opts);
    const after = (await createRepos({ workspaceId }).series.get(seriesId))!;
    expect(after.version).toBe(before.version);
    expect(after.ftpServerId).toBe(serverId);
    expect(after.ftpHost).toBe('ftp.club.ie');
    expect(after.ftpLastUploadedAt).toBeGreaterThan(0);

    const { items } = await listActivity({ workspaceId, seriesId, page: { limit: 50, cursor: null } });
    expect(items.find((i) => i.action === 'publish.ftp-uploaded')?.summary).toBe(
      'Uploaded 1 page to ftp.club.ie',
    );
  });

  test('publishing unchanged results uploads again — the way to retry', async () => {
    await publishSeries(ctx, seriesId, { fleets: ['Fast'] }, opts);
    uploads = [];
    const result = await publishSeries(ctx, seriesId, { fleets: ['Fast'] }, opts);
    expect(uploads.map((u) => u.path)).toEqual(['/public_html/results/fast.html']);
    expect(result.ftp?.uploaded).toHaveLength(1);
  });

  test('a failing page is retried, then the run stops; the publication stands', async () => {
    const busy = { ok: false as const, error: 'FTP error: 421 Too many connections', retryable: true };
    answers = [busy, busy, busy];
    const result = await publishSeries(ctx, seriesId, { fleets: ['Fast', 'Schedule'] }, opts);

    // Three goes at Fast, none at the schedule.
    expect(uploads.map((u) => u.path)).toEqual([
      '/public_html/results/fast.html',
      '/public_html/results/fast.html',
      '/public_html/results/fast.html',
    ]);
    expect(result.ftp).toMatchObject({
      uploaded: [],
      failed: { fleetName: 'Fast', path: '/public_html/results/fast.html', error: busy.error },
      notAttempted: [{ fleetName: 'Schedule', path: '/public_html/results/schedule.html' }],
    });
    expect(result.pages.map((p) => p.fleetName)).toContain('Fast');
  });

  test('with several servers and none chosen, nothing is sent', async () => {
    await createRepos({ workspaceId }).series.setPublishPrefs(seriesId, { ftpServerId: null as unknown as undefined, ftpHost: '' });
    const second = uuid();
    await putFtpServer(ctx, second, {
      id: second, host: 'ftp.other.ie', port: 21, username: 'scorer', password: 'x', ftps: false, version: 1,
    });
    const result = await publishSeries(ctx, seriesId, { fleets: ['Fast'] }, opts);
    expect(uploads).toEqual([]);
    expect(result.ftp).toMatchObject({
      host: null,
      uploaded: [],
      notAttempted: [{ fleetName: 'Fast', path: '/public_html/results/fast.html' }],
    });
    await createRepos({ workspaceId }).ftpServers.delete(second);
  });

  test('a link to a page with no copy on the club site goes to Sail Scoring', async () => {
    await setPaths({ schedule: '/public_html/results/schedule.html' });
    await publishSeries(ctx, seriesId, { fleets: ['Schedule'] }, opts);
    expect(uploads.map((u) => u.path)).toEqual(['/public_html/results/schedule.html']);
    expect(uploads[0].html).toContain(
      `href="https://app.sailscoring.test/p/${ctx.workspaceSlug}/frostbites/fast">Results</a>`,
    );
  });

  test('a workspace without the feature never uploads', async () => {
    const result = await publishSeries({ ...ctx, features: ['schedule-page'] }, seriesId, { fleets: ['Fast'] }, opts);
    expect(result.ftp).toBeUndefined();
    expect(uploads).toEqual([]);
  });
});

describe.skipIf(skip)('publish handler — a championship on the club site', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  const uploads: { path: string; html: string }[] = [];
  const upload: FtpUploader = async (_server, path, html) => {
    uploads.push({ path, html });
    return { ok: true };
  };

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_ftc_${uuid().replace(/-/g, '')}`;
    const slug = `ftc-${workspaceId.slice(8, 18)}`;
    await db.insert(schema.organization).values({ id: workspaceId, name: 'FTP Worlds', slug, createdAt: new Date() });
    ctx = {
      userId: 'ftc-user', email: 'ftc@sailscoring.test', workspaceId,
      workspaceSlug: slug, role: 'owner', features: ['ftp-upload', 'split-fleets'],
    };
    const serverId = uuid();
    await putFtpServer(ctx, serverId, {
      id: serverId, host: 'ftp.club.ie', port: 21, username: 'scorer', password: 's3cret', ftps: false, version: 1,
    });

    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Worlds', venue: 'Dun Laoghaire',
      startDate: '2026-08-23', endDate: '2026-08-30',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const, discardThresholds: [], dnfScoring: 'startingArea' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    const competitorIds: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const id = uuid();
      await competitors.putCompetitor(ctx, seriesId, id, {
        id, seriesId, fleetIds: [], sailNumber: `IRL ${i}`, names: [`Helm ${i}`], clubs: [],
        gender: '' as const, age: null, createdAt: Date.now(),
      });
      competitorIds.push(id);
    }
    await splitFleets.putSplitFleetState(ctx, seriesId, { config: defaultSplitFleetConfig(2), rounds: [] });
    await splitFleets.commitSplitRound(ctx, seriesId, {
      stage: 'qualifying', fromStageRace: 1, method: 'rank-pattern', basis: null,
      fleets: [{ label: 'Yellow', color: '#f5c518' }, { label: 'Blue', color: '#1e6fd9' }],
      assignments: Object.fromEntries(competitorIds.map((id, i) => [id, i % 2])),
      overrideCompetitorIds: [], stageRaceNumbers: [1], date: '2026-08-24', deleteFleetIds: [],
    });
    const [race] = await createRepos({ workspaceId }).races.listBySeries(seriesId);
    for (const [i, competitorId] of competitorIds.entries()) {
      const finishId = uuid();
      await finishes.putFinish(ctx, race.id, finishId, {
        id: finishId, raceId: race.id, competitorId, sortOrder: i + 1, tiedWithPrevious: false, resultCode: null,
        startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
        redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    await sql?.end();
  });

  test('the standings link the race results’ copy on the club site', async () => {
    await createRepos({ workspaceId }).series.setPublishPrefs(seriesId, {
      ftpPaths: {
        championship: '/public_html/worlds/standings.html',
        'race-results': '/public_html/worlds/races/all.html',
      },
    });
    const result = await publishSeries(ctx, seriesId, {}, { ftpUpload: upload });
    expect(result.ftp?.uploaded.map((p) => p.fleetName)).toEqual(['Championship', 'Race results']);

    const published = (await getPublishedBySeries(seriesId))!;
    const standings = published.pages.find((p) => p.fleetName === 'Championship')!;
    const publishedHtml = (await readPublishedHtml(standings.blobUrl))!;
    expect(publishedHtml).toMatch(/href="race-results#/);

    const ftpHtml = uploads.find((u) => u.path === '/public_html/worlds/standings.html')!.html;
    expect(ftpHtml).toMatch(/href="races\/all\.html#/);
    expect(ftpHtml).not.toMatch(/href="race-results#/);
  });
});
