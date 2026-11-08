// @vitest-environment node

/**
 * High-point scoring at the API boundary: a series refuses to score high point
 * what it can't score yet — its own codes that add to a place, a penalty
 * already recorded, a split-fleet format — and once high point, a finish
 * refuses a penalty and the series refuses a split-fleet format.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as races from '@/lib/api-handlers/races';
import * as series from '@/lib/api-handlers/series';
import { putSplitFleetConfig } from '@/lib/api-handlers/split-fleets';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import { bulkPutFinishes, putFinish } from '@/lib/api-handlers/finishes';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { Series, SeriesScoringCode } from '@/lib/types';
import { createOrg, preCreateUser } from '@/scripts/provision-org';

const DATABASE_URL = process.env.DATABASE_URL;
const uuid = () => crypto.randomUUID();

const TLE: SeriesScoringCode = {
  code: 'TLE',
  description: 'Time limit expired (SI 16.1)',
  kind: 'replace',
  rule: { type: 'placeAfter', base: 'finishers', plus: 1 },
  capAtDnf: true,
  discardable: true,
};
const SOP: SeriesScoringCode = {
  code: 'SOP',
  description: 'Failed to sign out (SI 19.1)',
  kind: 'add',
  rule: { type: 'addPoints', points: 2 },
  discardable: true,
};

describe.skipIf(!DATABASE_URL)('high point at the API', () => {
  let owner!: WorkspaceContext;
  let userId = '';
  const seriesId = uuid();
  const otherSeriesId = uuid();
  const fleetId = uuid();
  const raceId = uuid();
  const otherRaceId = uuid();
  const boat = uuid();

  const seriesBody = (id: string, over: Partial<Series> = {}) => ({
    id, name: 'Frostbites', venue: '', startDate: '2026-11-01', endDate: '',
    venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
    createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
    scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
    ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true,
    enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
    ...over,
  });
  const finish = (race: string, over: Record<string, unknown>) => ({
    id: uuid(), raceId: race, competitorId: boat, sortOrder: null, tiedWithPrevious: false,
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null,
    redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null,
    redressIncludeAllLater: false, redressPoints: null, ...over,
  });

  beforeAll(async () => {
    const db = getDb();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await createOrg(db, { name: `High point ${stamp}`, enabledFeatures: ['finish-submissions'] });
    const u = await preCreateUser(db, { email: `high-point-${stamp}@sailscoring.test`, name: 'Sam Scorer' });
    userId = u.userId;
    owner = {
      workspaceId: org.id, workspaceSlug: org.slug, features: ['finish-submissions'],
      userId: u.userId, email: u.email, role: 'owner',
    };
    await series.putSeries(owner, seriesId, seriesBody(seriesId));
    await series.putSeries(owner, otherSeriesId, seriesBody(otherSeriesId));
    for (const [sid, rid] of [[seriesId, raceId], [otherSeriesId, otherRaceId]] as const) {
      const fid = sid === seriesId ? fleetId : uuid();
      await fleets.bulkPutFleets(owner, sid, { fleets: [{ id: fid, seriesId: sid, name: 'ILCA 7', displayOrder: 0, scoringSystem: 'scratch' }] });
      const cid = sid === seriesId ? boat : uuid();
      await competitors.putCompetitor(owner, sid, cid, {
        id: cid, seriesId: sid, fleetIds: [fid], sailNumber: '1001', names: ['A Helm'], clubs: [], gender: '', age: null, createdAt: Date.now(),
      });
      await races.generateRaces(owner, sid, {
        races: [{ id: rid, seriesId: sid, raceNumber: 1, name: null, date: '2026-11-01', createdAt: Date.now() }],
        starts: [{ id: uuid(), raceId: rid, fleetIds: [fid], startTime: '10:48:00' }],
      });
    }
  });

  afterAll(async () => {
    const db = getDb();
    if (owner) await db.delete(schema.organization).where(eq(schema.organization.id, owner.workspaceId));
    if (userId) await db.delete(schema.user).where(eq(schema.user.id, userId));
  });

  const HIGH_POINT: Partial<Series> = { pointsSystem: 'highPoint', highPointFormula: 'boatsBeaten' };

  test('a series with its own code that adds to a place can’t switch', async () => {
    await expect(
      series.putSeries(owner, otherSeriesId, seriesBody(otherSeriesId, { ...HIGH_POINT, scoringCodes: [SOP] })),
    ).rejects.toMatchObject({
      name: 'BadRequestError',
      message: 'A high-point series can’t score a code that adds to a finishing place yet (SOP). Change or remove it first.',
    });
  });

  test('a series with a penalty recorded can’t switch until it is removed', async () => {
    const zfp = finish(raceId, { sortOrder: 1, penaltyCode: 'ZFP' });
    await bulkPutFinishes(owner, raceId, { finishes: [zfp] });
    await expect(series.putSeries(owner, seriesId, seriesBody(seriesId, HIGH_POINT))).rejects.toMatchObject({
      message: 'A high-point series can’t score ZFP yet, and race 1 has one. Remove it first.',
    });
    await bulkPutFinishes(owner, raceId, { finishes: [{ ...zfp, penaltyCode: null }] });
    await expect(series.putSeries(owner, seriesId, seriesBody(seriesId, HIGH_POINT))).resolves.toMatchObject({
      pointsSystem: 'highPoint',
    });
  });

  test('a high-point series refuses a penalty on a finish', async () => {
    const dpi = finish(raceId, { sortOrder: 1, penaltyCode: 'DPI', penaltyOverride: 2 });
    await expect(putFinish(owner, raceId, dpi.id, dpi)).rejects.toMatchObject({
      message: 'DPI adds to a finishing place, which a high-point series can’t score yet.',
    });
  });

  test('a high-point series refuses a split-fleet format', async () => {
    const err = await putSplitFleetConfig(owner, seriesId, defaultSplitFleetConfig(2)).catch((e) => e);
    expect(err.message).toBe('A split-fleet championship can’t be scored high point: its stages are scored low point.');
  });
});
