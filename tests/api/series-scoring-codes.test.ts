// @vitest-environment node

/**
 * A series' own scoring codes at the API boundary (#717): a finish or a
 * finish-sheet submission may carry one of the series' codes, checked against
 * its table — a code the series doesn't have, or one in the wrong slot, is
 * refused with where. The series' table itself is checked as it is saved.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as races from '@/lib/api-handlers/races';
import * as series from '@/lib/api-handlers/series';
import { bulkPutFinishes, putFinish } from '@/lib/api-handlers/finishes';
import { submitFinishes } from '@/lib/api-handlers/finish-submissions';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { Series, SeriesScoringCode } from '@/lib/types';
import { submitFinishesSchema } from '@/lib/validation/finish-submission';
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

describe.skipIf(!DATABASE_URL)('a series’ own scoring codes at the API', () => {
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
    const org = await createOrg(db, { name: `Codes ${stamp}`, enabledFeatures: ['finish-submissions'] });
    const u = await preCreateUser(db, { email: `codes-${stamp}@sailscoring.test`, name: 'Sam Scorer' });
    userId = u.userId;
    owner = {
      workspaceId: org.id, workspaceSlug: org.slug, features: ['finish-submissions'],
      userId: u.userId, email: u.email, role: 'owner',
    };
    await series.putSeries(owner, seriesId, seriesBody(seriesId, { scoringCodes: [TLE, SOP] }));
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

  test('a finish may carry the series’ own codes', async () => {
    const tle = finish(raceId, { resultCode: 'TLE' });
    await expect(putFinish(owner, raceId, tle.id, tle)).resolves.toMatchObject({ resultCode: 'TLE' });
    const sop = finish(raceId, { id: tle.id, sortOrder: 1, penaltyCode: 'SOP' });
    await expect(bulkPutFinishes(owner, raceId, { finishes: [sop] })).resolves.toEqual({ count: 1 });
  });

  test('a code the series doesn’t have is refused', async () => {
    const tle = finish(otherRaceId, { resultCode: 'TLE' });
    await expect(putFinish(owner, otherRaceId, tle.id, tle)).rejects.toMatchObject({
      name: 'BadRequestError',
      message: 'TLE isn’t a code in this series.',
    });
  });

  test('a code in the wrong slot is refused', async () => {
    const asResult = finish(raceId, { resultCode: 'SOP' });
    await expect(bulkPutFinishes(owner, raceId, { finishes: [asResult] })).rejects.toMatchObject({
      message: 'SOP adds to a finishing place: give it as a penalty, not a result.',
    });
    const asPenalty = finish(raceId, { sortOrder: 1, penaltyCode: 'TLE' });
    await expect(bulkPutFinishes(owner, raceId, { finishes: [asPenalty] })).rejects.toMatchObject({
      message: 'TLE replaces a result: it can’t be a penalty.',
    });
  });

  test('a recorder’s submission may carry a code that replaces the result, and no other', async () => {
    const upload = (resultCode: string) => submitFinishesSchema.parse({
      revision: 1, starts: [], complete: false,
      finishes: [{ id: 'r1', competitorId: boat, resultCode }],
    });
    await expect(submitFinishes(owner, raceId, uuid(), upload('TLE'))).resolves.toBeDefined();
    for (const [code, message] of [
      ['SOP', 'SOP adds to a finishing place: give it as a penalty, not a result.'],
      ['RDG', 'Redress is the protest committee’s, not the finish line’s.'],
      ['XPA', 'XPA isn’t a code in this series.'],
    ] as const) {
      const err = await submitFinishes(owner, raceId, uuid(), upload(code)).catch((e) => e);
      expect(err.name).toBe('BadRequestError');
      expect(err.issues).toEqual([{ path: ['finishes', 0, 'resultCode'], message }]);
    }
  });

  test('a series’ table is checked as it is saved', async () => {
    await expect(
      series.putSeries(owner, otherSeriesId, seriesBody(otherSeriesId, { scoringCodes: [TLE, { ...TLE, code: 'tle' }] })),
    ).rejects.toThrow(/Codes can’t differ only by case/);
  });
});
