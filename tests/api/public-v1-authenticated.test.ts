// @vitest-environment node

/**
 * The public API's authenticated part (ADR-016), through its route handlers,
 * with real OAuth tokens: who may call, in which workspace, how far, and
 * what each call takes and returns.
 *
 * Skipped when DATABASE_URL is unset; CI provides it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';

import * as competitors from '@/lib/api-handlers/competitors';
import * as finishes from '@/lib/api-handlers/finishes';
import * as fleets from '@/lib/api-handlers/fleets';
import * as series from '@/lib/api-handlers/series';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { listActivity } from '@/lib/activity-log';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { addMember, createOrg } from '@/scripts/provision-org';
import * as workspacesRoute from '@/app/api/public/v1/workspaces/route';
import * as seriesListRoute from '@/app/api/public/v1/series/route';
import * as seriesRoute from '@/app/api/public/v1/series/[id]/route';
import * as fleetsRoute from '@/app/api/public/v1/series/[id]/fleets/route';
import * as competitorsRoute from '@/app/api/public/v1/series/[id]/competitors/route';
import * as racesRoute from '@/app/api/public/v1/series/[id]/races/route';
import * as datedRacesRoute from '@/app/api/public/v1/races/route';
import * as raceRoute from '@/app/api/public/v1/series/[id]/races/[raceId]/route';
import * as finishesRoute from '@/app/api/public/v1/races/[raceId]/finishes/route';
import * as startRoute from '@/app/api/public/v1/races/[raceId]/starts/[startId]/route';
import * as courseRoute from '@/app/api/public/v1/races/[raceId]/starts/[startId]/course/route';
import * as publishRoute from '@/app/api/public/v1/series/[id]/publish/route';
import * as publicationsRoute from '@/app/api/public/v1/publications/route';
import {
  deviceSignIn,
  grantApp,
  registerApp,
  removeUser,
  setConnectedApps,
  signInFreshUser,
  type SignedInUser,
} from '../auth/oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const BASE = 'http://localhost:3000/api/public/v1';

type Handler<P> = (req: NextRequest, raw: { params: Promise<P> }) => Promise<Response>;

async function call<P>(
  handler: Handler<P>,
  path: string,
  opts: { token?: string; params?: P; method?: string; json?: unknown; text?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.text !== undefined) {
    body = opts.text;
  }
  const res = await handler(
    new NextRequest(`${BASE}${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body }),
    { params: Promise.resolve((opts.params ?? {}) as P) },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const uuid = () => crypto.randomUUID();

describe.skipIf(!DATABASE_URL)('the public API, authenticated part', () => {
  let user!: SignedInUser;
  let appId!: string;
  let cliId!: string;
  let token!: string;
  let ctx!: WorkspaceContext;
  let club!: { id: string; slug: string };
  const seriesId = uuid();
  const fleetA = uuid();
  const fleetB = uuid();
  const competitorId = uuid();

  beforeAll(async () => {
    user = await signInFreshUser('public-v1');
    await setConnectedApps(user.personalWorkspaceId, true);
    appId = await registerApp(user, 'app');
    cliId = await registerApp(user, 'cli');
    token = (await grantApp(user, appId, user.personalWorkspaceId)).accessToken;
    // A club the user is only a member (read-only) of, apps allowed.
    club = await createOrg(getDb(), { name: `Club ${Date.now()}`, enabledFeatures: ['connected-apps'] });
    await addMember(getDb(), { orgSlugOrId: club.id, email: user.email, role: 'member' });

    const [org] = await getDb()
      .select({ slug: schema.organization.slug })
      .from(schema.organization)
      .where(eq(schema.organization.id, user.personalWorkspaceId));
    ctx = {
      userId: user.userId,
      email: user.email,
      workspaceId: user.personalWorkspaceId,
      workspaceSlug: org.slug,
      role: 'owner',
      features: [],
    };
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Autumn League', venue: 'Crosshaven', startDate: '2026-10-04', endDate: '',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'handicap', discardThresholds: [], dnfScoring: 'seriesEntries',
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, publishRatingCalculations: true,
      enabledCompetitorFields: ['boatName', 'club'], primaryPersonLabel: 'helm', subdivisionAxes: [],
    });
    await fleets.bulkPutFleets(ctx, seriesId, {
      fleets: [
        { id: fleetA, seriesId, name: 'Class 1', displayOrder: 0, scoringSystem: 'scratch' },
        { id: fleetB, seriesId, name: 'Class 2', displayOrder: 1, scoringSystem: 'scratch' },
      ],
    });
    await competitors.putCompetitor(ctx, seriesId, competitorId, {
      id: competitorId, seriesId, fleetIds: [fleetA], sailNumber: 'IRL 1234', names: ['A Helm'],
      boatName: 'Ibaraki', clubs: ['RCYC'], gender: '', age: null, createdAt: Date.now(), crewNames: ['B Crew'],
    });
  });

  afterAll(async () => {
    const db = getDb();
    if (seriesId && ctx) {
      await series.setSeriesArchived(ctx, seriesId, { archived: true }).catch(() => {});
      await series.deleteSeries(ctx, seriesId).catch(() => {});
    }
    for (const id of [appId, cliId]) {
      if (id) await db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, id));
    }
    if (club) await db.delete(schema.organization).where(eq(schema.organization.id, club.id));
    if (user) await removeUser(user);
  });

  test('a call needs an OAuth access token, never a cookie or an API key', async () => {
    const none = await call(seriesListRoute.GET, '/series');
    expect(none.status).toBe(401);
    expect(none.body.error).toBe('unauthenticated');
    expect(none.headers.get('www-authenticate')).toContain('Bearer');

    const cookie = await call(seriesListRoute.GET, '/series', { headers: { cookie: user.jar.header() } });
    expect(cookie.status).toBe(401);

    const key = await call(seriesListRoute.GET, '/series', { token: 'sk_live_an_api_key' });
    expect(key.status).toBe(401);
    expect(key.body.message).toMatch(/not an API key/);

    const bogus = await call(seriesListRoute.GET, '/series', { token: 'ssat_nope' });
    expect(bogus.status).toBe(401);
  });

  test('an app reaches the one workspace its grant names', async () => {
    const ws = await call(workspacesRoute.GET, '/workspaces', { token });
    expect(ws.status).toBe(200);
    expect(ws.body.workspaces.map((w: { id: string }) => w.id)).toEqual([user.personalWorkspaceId]);

    const list = await call(seriesListRoute.GET, '/series', { token });
    expect(list.body.series.some((s: { id: string }) => s.id === seriesId)).toBe(true);

    // The header may name the granted workspace, by id or slug, but no other.
    const named = await call(seriesListRoute.GET, '/series', { token, headers: { 'x-sailscoring-workspace': ctx.workspaceSlug } });
    expect(named.status).toBe(200);
    const other = await call(seriesListRoute.GET, '/series', { token, headers: { 'x-sailscoring-workspace': club.id } });
    expect(other.status).toBe(403);
    expect(other.body.message).toMatch(/different workspace/);
  });

  test('turning connected apps off cuts the app off at once', async () => {
    await setConnectedApps(user.personalWorkspaceId, false);
    try {
      const res = await call(seriesListRoute.GET, '/series', { token });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    } finally {
      await setConnectedApps(user.personalWorkspaceId, true);
    }
  });

  test('a grant never reaches past the scopes or the user’s role', async () => {
    const readOnly = (await grantApp(user, appId, user.personalWorkspaceId, 'read')).accessToken;
    const write = await call(racesRoute.POST, `/series/${seriesId}/races`, {
      token: readOnly, params: { id: seriesId }, json: { races: [{ date: '2026-10-11' }] },
    });
    expect(write.status).toBe(403);
    expect(write.body.message).toMatch(/races scope/);
    expect(write.headers.get('www-authenticate')).toContain('insufficient_scope');

    // Every scope, in a workspace where the user may only read.
    const clubToken = (await grantApp(user, appId, club.id)).accessToken;
    const clubWrite = await call(racesRoute.POST, '/series/x/races', {
      token: clubToken, params: { id: uuid() }, json: { races: [{ date: '2026-10-11' }] },
    });
    expect(clubWrite.status).toBe(403);
    expect(clubWrite.body.message).toMatch(/role/);
  });

  test('reads: series, fleets, entries', async () => {
    const one = await call(seriesRoute.GET, `/series/${seriesId}`, { token, params: { id: seriesId } });
    expect(one.body).toEqual({
      id: seriesId, name: 'Autumn League', venue: 'Crosshaven', startDate: '2026-10-04', endDate: null,
      archived: false, asPublished: false,
    });
    const f = await call(fleetsRoute.GET, `/series/${seriesId}/fleets`, { token, params: { id: seriesId } });
    expect(f.body.fleets).toEqual([
      { id: fleetA, name: 'Class 1', scoringSystem: 'scratch' },
      { id: fleetB, name: 'Class 2', scoringSystem: 'scratch' },
    ]);
    const c = await call(competitorsRoute.GET, `/series/${seriesId}/competitors`, { token, params: { id: seriesId } });
    expect(c.body.competitors).toEqual([{
      id: competitorId, fleetIds: [fleetA], sailNumber: 'IRL 1234', bowNumber: null, alternativeSailNumbers: [],
      boatName: 'Ibaraki', boatClass: null, names: ['A Helm'], helms: [], owners: [], crew: ['B Crew'],
      clubs: ['RCYC'], nationality: null, excluded: false,
    }]);
    const missing = await call(seriesRoute.GET, '/series/x', { token, params: { id: uuid() } });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('not-found');
  });

  test('a race day: races with starts, a course, a changed gun, a removed start', async () => {
    const raceId = uuid();
    const s1 = uuid();
    const s2 = uuid();
    const created = await call(racesRoute.POST, `/series/${seriesId}/races`, {
      token, params: { id: seriesId },
      json: {
        races: [{
          id: raceId, date: '2026-10-04', name: 'Race 1',
          starts: [
            { id: s2, fleetIds: [fleetB], startTime: '11:05' },
            { id: s1, fleetIds: [fleetA], startTime: '11:00:00' },
          ],
        }],
      },
    });
    expect(created.status).toBe(200);
    const [race] = created.body.races;
    expect(race).toMatchObject({ id: raceId, number: 1, name: 'Race 1', date: '2026-10-04' });
    // Starts in gun order, times stored to the second.
    expect(race.starts.map((s: { id: string; startTime: string }) => [s.id, s.startTime])).toEqual([
      [s1, '11:00:00'],
      [s2, '11:05:00'],
    ]);

    const doc = readFileSync(join(__dirname, '..', 'fixtures', 'orc', 'constructed-course-rcyc-2026-10-04.json'), 'utf8');
    const course = await call(courseRoute.PUT, `/races/${raceId}/starts/${s1}/course`, {
      token, method: 'PUT', params: { raceId, startId: s1 }, text: doc,
    });
    expect(course.status).toBe(200);
    expect(course.body.course).toMatchObject({ name: 'Autumn League, Sun 4 Oct 2026, Race 1, Start 1', north: 'true' });
    expect(course.body.course.legs).toHaveLength(7);
    expect(course.body.course.distanceNm).toBeCloseTo(5.09, 2);

    const again = await call(courseRoute.PUT, `/races/${raceId}/starts/${s1}/course`, {
      token, method: 'PUT', params: { raceId, startId: s1 }, text: doc,
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'conflict', message: expect.stringMatching(/replace=true/) });

    const moved = await call(startRoute.PATCH, `/races/${raceId}/starts/${s1}`, {
      token, method: 'PATCH', params: { raceId, startId: s1 }, json: { startTime: '11:10' },
    });
    expect(moved.body.startTime).toBe('11:10:00');
    expect(moved.body.course.legs).toHaveLength(7);

    const taken = await call(startRoute.PATCH, `/races/${raceId}/starts/${s1}`, {
      token, method: 'PATCH', params: { raceId, startId: s1 }, json: { fleetIds: [fleetA, fleetB] },
    });
    expect(taken.status).toBe(400);
    expect(taken.body.message).toMatch(/Class 2/);

    const removed = await call(startRoute.DELETE, `/races/${raceId}/starts/${s2}`, {
      token, method: 'DELETE', params: { raceId, startId: s2 },
    });
    expect(removed.status).toBe(204);
    const read = await call(raceRoute.GET, `/series/${seriesId}/races/${raceId}`, { token, params: { id: seriesId, raceId } });
    expect(read.body.starts.map((s: { id: string }) => s.id)).toEqual([s1]);

    const gone = await call(startRoute.DELETE, `/races/${raceId}/starts/${s2}`, {
      token, method: 'DELETE', params: { raceId, startId: s2 },
    });
    expect(gone.status).toBe(404);
  });

  test('a day\'s races across the workspace', async () => {
    const res = await call(datedRacesRoute.GET, '/races?date=2026-10-04', { token });
    expect(res.status).toBe(200);
    expect(res.body.races).toHaveLength(1);
    expect(res.body.races[0]).toMatchObject({ number: 1, date: '2026-10-04', seriesId, seriesName: 'Autumn League' });
    expect(res.body.races[0].starts.length).toBeGreaterThan(0);

    const none = await call(datedRacesRoute.GET, '/races?date=2026-10-05', { token });
    expect(none.body.races).toEqual([]);

    const undated = await call(datedRacesRoute.GET, '/races', { token });
    expect(undated.status).toBe(400);
    expect(undated.body.error).toBe('invalid');
    const malformed = await call(datedRacesRoute.GET, '/races?date=4-10-2026', { token });
    expect(malformed.status).toBe(400);
  });

  test('what an app does is credited to the person and the app', async () => {
    const { items } = await listActivity({ workspaceId: user.personalWorkspaceId, seriesId, page: { limit: 50, cursor: null } });
    const throughApp = items.filter((e) => e.via);
    expect(throughApp.length).toBeGreaterThan(0);
    expect(throughApp[0]).toMatchObject({
      actor: { id: user.userId },
      via: { clientId: appId, name: expect.stringMatching(/^Test app/) },
    });
    // What the user did in the app itself (setting up the fleets) isn't.
    expect(items.filter((e) => !e.via).length).toBeGreaterThan(0);
  });

  test('finishes, in finishing order', async () => {
    const list = await call(racesRoute.GET, `/series/${seriesId}/races`, { token, params: { id: seriesId } });
    const raceId = list.body.races[0].id;
    await finishes.bulkPutFinishes(ctx, raceId, {
      finishes: [
        { id: uuid(), raceId, competitorId: null, unknownSailNumber: 'IRL 999', sortOrder: 2, tiedWithPrevious: false,
          finishTime: '12:01:00', resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null,
          redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null },
        { id: uuid(), raceId, competitorId, sortOrder: 1, tiedWithPrevious: false, finishTime: '12:00:00',
          resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null,
          redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null },
      ],
    });
    const res = await call(finishesRoute.GET, `/races/${raceId}/finishes`, { token, params: { raceId } });
    expect(res.body.finishes.map((f: { competitorId: string | null; sailNumber: string | null; position: number }) =>
      [f.competitorId, f.sailNumber, f.position])).toEqual([
      [competitorId, null, 1],
      [null, 'IRL 999', 2],
    ]);
  });

  test('a bad request says which field', async () => {
    const res = await call(racesRoute.POST, `/series/${seriesId}/races`, {
      token, params: { id: seriesId }, json: { races: [{ date: '4 Oct' }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid');
    expect(res.body.problems).toEqual([expect.objectContaining({ field: 'races.0.date' })]);

    const unknownField = await call(racesRoute.POST, `/series/${seriesId}/races`, {
      token, params: { id: seriesId }, json: { races: [{ date: '2026-10-11', raceNumber: 4 }] },
    });
    expect(unknownField.status).toBe(400);

    const strangeFleet = await call(racesRoute.POST, `/series/${seriesId}/races`, {
      token, params: { id: seriesId }, json: { races: [{ date: '2026-10-11', starts: [{ fleetIds: [uuid()] }] }] },
    });
    expect(strangeFleet.status).toBe(400);
    expect(strangeFleet.body.message).toMatch(/No fleet/);
  });

  test('a retried write with the same Idempotency-Key happens once', async () => {
    const body = { races: [{ date: '2026-10-18' }] };
    const headers = { 'idempotency-key': `race-day-${uuid()}` };
    const first = await call(racesRoute.POST, `/series/${seriesId}/races`, { token, params: { id: seriesId }, json: body, headers });
    const second = await call(racesRoute.POST, `/series/${seriesId}/races`, { token, params: { id: seriesId }, json: body, headers });
    expect(second.body).toEqual(first.body);
    const list = await call(racesRoute.GET, `/series/${seriesId}/races`, { token, params: { id: seriesId } });
    expect(list.body.races.filter((r: { date: string }) => r.date === '2026-10-18')).toHaveLength(1);
  });

  test('publishing, and the publication it makes', async () => {
    const none = await call(publishRoute.GET, `/series/${seriesId}/publish`, { token, params: { id: seriesId } });
    expect(none.body).toEqual({ publication: null });
    const published = await call(publishRoute.POST, `/series/${seriesId}/publish`, {
      token, params: { id: seriesId }, json: {},
    });
    expect(published.status).toBe(200);
    expect(published.body.publication).toMatchObject({ seriesId, slug: 'autumn-league' });
    expect(published.body.publication.url).toMatch(/\/p\/.+\/autumn-league$/);
    const all = await call(publicationsRoute.GET, '/publications', { token });
    expect(all.body.publications.map((p: { id: string }) => p.id)).toContain(published.body.publication.id);
    const removed = await call(publishRoute.DELETE, `/series/${seriesId}/publish`, {
      token, method: 'DELETE', params: { id: seriesId },
    });
    expect(removed.status).toBe(204);
  });

  test('a race is deleted, and later races are renumbered', async () => {
    const list = await call(racesRoute.GET, `/series/${seriesId}/races`, { token, params: { id: seriesId } });
    const [first, second] = list.body.races;
    const res = await call(raceRoute.DELETE, `/series/${seriesId}/races/${first.id}`, {
      token, method: 'DELETE', params: { id: seriesId, raceId: first.id },
    });
    expect(res.status).toBe(204);
    const after = await call(racesRoute.GET, `/series/${seriesId}/races`, { token, params: { id: seriesId } });
    expect(after.body.races[0]).toMatchObject({ id: second.id, number: 1 });
  });

  test('the CLI’s token reaches every workspace its user belongs to', async () => {
    const cli = (await deviceSignIn(user, cliId)).accessToken;
    const ws = await call(workspacesRoute.GET, '/workspaces', { token: cli });
    expect(ws.body.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([club.id, user.personalWorkspaceId].sort());
    const inClub = await call(seriesListRoute.GET, '/series', { token: cli, headers: { 'x-sailscoring-workspace': club.slug } });
    expect(inClub.status).toBe(200);
    expect(inClub.body.series).toEqual([]);
  });

  test('every answer allows any origin', async () => {
    const res = await call(seriesListRoute.GET, '/series', { token });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const pre = seriesListRoute.OPTIONS();
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/Authorization/);
  });
});
