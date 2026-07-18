// @vitest-environment node

/**
 * Combined published pages (#255) through the publish handler: a publishing
 * group's page publishes alongside (or instead of) the member fleets' pages,
 * and a previously-published standalone page whose fleet a group now
 * suppresses is retracted — removed from the publication and its blob
 * deleted — rather than carried stale.
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
import * as fleets from '@/lib/api-handlers/fleets';
import * as competitors from '@/lib/api-handlers/competitors';
import * as races from '@/lib/api-handlers/races';
import * as subSeriesApi from '@/lib/api-handlers/sub-series';
import { publishSeries } from '@/lib/api-handlers/publish';
import { getPublishedBySeries } from '@/lib/published-repository';
import { readPublishedHtml } from '@/lib/blob-storage';
import { createRepos } from '@/lib/postgres-repository';
import type { PublishingGroup } from '@/lib/types';

const DATABASE_URL = process.env.DATABASE_URL;
const skip = !DATABASE_URL;

function uuid() {
  return crypto.randomUUID();
}

describe.skipIf(skip)('publish handler — combined pages (#255)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;
  const fleetIds: string[] = [];

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_grp_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Groups',
      slug: `grp-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'grp-user',
      email: 'grp@sailscoring.test',
      workspaceId,
      workspaceSlug: `grp-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };

    // Two-fleet series, one competitor per fleet, one race — publishable.
    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Group League', venue: 'HYC',
      startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    let n = 0;
    for (const fleetName of ['Cruisers', 'Whitesails']) {
      const fleetId = uuid();
      fleetIds.push(fleetId);
      await fleets.putFleet(ctx, seriesId, fleetId, {
        id: fleetId, seriesId, name: fleetName, displayOrder: n++,
        scoringSystem: 'scratch' as const,
      });
      const compId = uuid();
      await competitors.putCompetitor(ctx, seriesId, compId, {
        id: compId, seriesId, fleetIds: [fleetId], sailNumber: `${n}`,
        names: [`${fleetName} boat`], club: 'HYC', gender: '' as const, age: null,
        createdAt: Date.now(),
      });
    }
    const raceId = uuid();
    await races.putRace(ctx, seriesId, raceId, {
      id: raceId, seriesId, raceNumber: 1, date: '2026-07-04', createdAt: Date.now(),
    });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function setGroups(groups: PublishingGroup[], publishIndividualFleetPages = true) {
    const repos = createRepos({ workspaceId });
    const current = (await repos.series.get(seriesId))!;
    await repos.series.save({ ...current, publishingGroups: groups, publishIndividualFleetPages });
  }

  test('publishes fleet pages, then a group page alongside them', async () => {
    const first = await publishSeries(ctx, seriesId, {});
    expect(first.pages.map((p) => p.fleetName)).toEqual(['Cruisers', 'Whitesails']);

    await setGroups([{
      id: uuid(), name: 'Overall', fleetMode: 'all', fleetIds: [],
      detail: 'standings',
    }]);
    const second = await publishSeries(ctx, seriesId, {});
    expect(second.pages.map((p) => p.fleetName)).toEqual([
      'Overall', 'Cruisers', 'Whitesails',
    ]);
    expect(second.pages[0].url.endsWith('/overall')).toBe(true);

    // The stored combined page carries both fleets' sections.
    const stored = (await getPublishedBySeries(seriesId))!;
    const overall = stored.pages.find((p) => p.fleetName === 'Overall')!;
    const html = await readPublishedHtml(overall.blobUrl);
    expect(html).toContain('<h2>Overall</h2>');
    expect(html).toContain('<h2>Cruisers</h2>');
    expect(html).toContain('<h2>Whitesails</h2>');
  });

  test('switching individual fleet pages off retracts the published standalone pages', async () => {
    const before = (await getPublishedBySeries(seriesId))!;
    const standalone = before.pages.filter((p) => p.fleetName !== 'Overall');
    expect(standalone).toHaveLength(2);

    await setGroups([{
      id: uuid(), name: 'Overall', fleetMode: 'all', fleetIds: [],
      detail: 'standings',
    }], false);
    const result = await publishSeries(ctx, seriesId, {});
    expect(result.pages.map((p) => p.fleetName)).toEqual(['Overall']);

    // The retracted pages' blobs are gone (db-backed storage in tests).
    for (const page of standalone) {
      expect(await readPublishedHtml(page.blobUrl)).toBeNull();
    }
  });

  test('a suppressed fleet stays retracted across selective re-publish', async () => {
    // Publish only the group page; the suppressed fleets must not resurface.
    const result = await publishSeries(ctx, seriesId, { fleets: ['Overall'] });
    expect(result.pages.map((p) => p.fleetName)).toEqual(['Overall']);
  });
});

describe.skipIf(skip)('publish handler — combined pages on a block series (#255)', () => {
  let sql!: Sql;
  let db!: PostgresJsDatabase<typeof schema>;
  let workspaceId: string;
  let ctx: WorkspaceContext;
  let seriesId: string;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    db = drizzle(sql, { schema });
    workspaceId = `org_blk_${uuid().replace(/-/g, '')}`;
    await db.insert(schema.organization).values({
      id: workspaceId,
      name: 'Blocks',
      slug: `blk-${workspaceId.slice(8, 18)}`,
      createdAt: new Date(),
    });
    ctx = {
      userId: 'blk-user',
      email: 'blk@sailscoring.test',
      workspaceId,
      workspaceSlug: `blk-${workspaceId.slice(8, 18)}`,
      role: 'owner',
      features: [],
    };

    // Two fleets, one competitor each, two races split into two blocks.
    seriesId = uuid();
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Block League', venue: 'HYC',
      startDate: '2026-07-01', endDate: '2026-07-31',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch' as const,
      discardThresholds: [], dnfScoring: 'seriesEntries' as const,
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: false,
      enabledCompetitorFields: ['boatName'],
      primaryPersonLabel: 'helm' as const, subdivisionAxes: [],
    });
    let n = 0;
    for (const fleetName of ['Cruisers', 'Whitesails']) {
      const fleetId = uuid();
      await fleets.putFleet(ctx, seriesId, fleetId, {
        id: fleetId, seriesId, name: fleetName, displayOrder: n++,
        scoringSystem: 'scratch' as const,
      });
      const compId = uuid();
      await competitors.putCompetitor(ctx, seriesId, compId, {
        id: compId, seriesId, fleetIds: [fleetId], sailNumber: `${n}`,
        names: [`${fleetName} boat`], club: 'HYC', gender: '' as const, age: null,
        createdAt: Date.now(),
      });
    }
    const raceIds: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const raceId = uuid();
      raceIds.push(raceId);
      await races.putRace(ctx, seriesId, raceId, {
        id: raceId, seriesId, raceNumber: i, date: `2026-07-0${i + 3}`, createdAt: Date.now(),
      });
    }
    await subSeriesApi.createSubSeries(ctx, seriesId, { name: 'Winter', raceIds: [raceIds[0]] });
    await subSeriesApi.createSubSeries(ctx, seriesId, { name: 'Spring', raceIds: [raceIds[1]] });
  });

  afterAll(async () => {
    if (workspaceId) {
      await db.delete(schema.organization).where(eq(schema.organization.id, workspaceId));
    }
    await sql?.end();
  });

  async function setGroups(groups: PublishingGroup[], publishIndividualFleetPages = true) {
    const repos = createRepos({ workspaceId });
    const current = (await repos.series.get(seriesId))!;
    await repos.series.save({ ...current, publishingGroups: groups, publishIndividualFleetPages });
  }

  test('an Overall group publishes one combined page per block, at {block}/overall', async () => {
    await setGroups([{
      id: uuid(), name: 'Overall', fleetMode: 'all', fleetIds: [],
      detail: 'standings',
    }]);
    const result = await publishSeries(ctx, seriesId, {});
    const keys = result.pages.map((p) => `${p.subSeriesName}/${p.fleetName}`);
    expect(keys).toEqual([
      'Winter/Overall', 'Winter/Cruisers', 'Winter/Whitesails',
      'Spring/Overall', 'Spring/Cruisers', 'Spring/Whitesails',
    ]);
    const winterOverall = result.pages[0];
    expect(winterOverall.url.endsWith('/winter/overall')).toBe(true);
  });

  test('toggle off retracts per block, only where the block group page is live', async () => {
    await setGroups([{
      id: uuid(), name: 'Overall', fleetMode: 'all', fleetIds: [],
      detail: 'standings',
    }], false);
    const result = await publishSeries(ctx, seriesId, {});
    expect(result.pages.map((p) => `${p.subSeriesName}/${p.fleetName}`)).toEqual([
      'Winter/Overall', 'Spring/Overall',
    ]);

    // The retracted block pages' blobs are gone (db-backed storage in tests).
    const stored = (await getPublishedBySeries(seriesId))!;
    expect(stored.pages).toHaveLength(2);
  });
});
