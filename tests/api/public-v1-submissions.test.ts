// @vitest-environment node

/**
 * Finish sheet submissions through the public API (#671, ADR-016): a
 * race-day app submits for its signed-in recorder, with real OAuth tokens.
 * Who may call, with which scope, and what each call takes and returns;
 * the rules themselves are covered in finish-submissions.test.ts.
 *
 * Skipped when DATABASE_URL is unset; CI provides it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';

import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as races from '@/lib/api-handlers/races';
import * as series from '@/lib/api-handlers/series';
import { listActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { addMember, createOrg, setOrgFeature } from '@/scripts/provision-org';
import { setClientScopes } from '@/scripts/oauth-client';
import * as listRoute from '@/app/api/public/v1/races/[raceId]/submissions/route';
import * as submissionRoute from '@/app/api/public/v1/races/[raceId]/submissions/[submissionId]/route';
import { grantApp, registerApp, removeUser, signInFreshUser, type SignedInUser } from '../auth/oauth-helpers';

const DATABASE_URL = process.env.DATABASE_URL;
const BASE = 'http://localhost:3000/api/public/v1';

type Handler<P> = (req: NextRequest, raw: { params: Promise<P> }) => Promise<Response>;

async function call<P>(
  handler: Handler<P>,
  path: string,
  opts: { token: string; params: P; method?: string; json?: unknown },
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { authorization: `Bearer ${opts.token}` };
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }
  const res = await handler(
    new NextRequest(`${BASE}${path}`, { method: opts.method ?? (body ? 'PUT' : 'GET'), headers, body }),
    { params: Promise.resolve(opts.params) },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const uuid = () => crypto.randomUUID();

describe.skipIf(!DATABASE_URL)('the public API: finish sheet submissions', () => {
  let recorder!: SignedInUser;
  let appId!: string;
  let token!: string;
  let readOnlyToken!: string;
  let club!: { id: string; slug: string };
  const seriesId = uuid();
  const fleetId = uuid();
  const raceId = uuid();
  const startId = uuid();
  const boat = uuid();
  const path = (id: string) => `/races/${raceId}/submissions/${id}`;

  beforeAll(async () => {
    const db = getDb();
    recorder = await signInFreshUser('recorder');
    club = await createOrg(db, { name: `Galway ${Date.now()}`, enabledFeatures: ['connected-apps', 'finish-submissions'] });
    await addMember(db, { orgSlugOrId: club.id, email: recorder.email, role: 'recorder' });

    // Registered as apps were before the scope existed, then given it.
    appId = await registerApp(recorder, 'app', 'RaceOps');
    await expect(grantApp(recorder, appId, club.id, 'read submissions')).rejects.toThrow();
    expect(await setClientScopes(db, appId)).toBe(true);
    token = (await grantApp(recorder, appId, club.id, 'read submissions offline_access')).accessToken;
    readOnlyToken = (await grantApp(recorder, appId, club.id, 'read')).accessToken;

    const owner: WorkspaceContext = {
      userId: recorder.userId, email: recorder.email, workspaceId: club.id, workspaceSlug: club.slug, role: 'owner', features: [],
    };
    await series.putSeries(owner, seriesId, {
      id: seriesId, name: 'Autumn League', venue: '', startDate: '2026-10-04', endDate: '',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, publishRatingCalculations: true,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
    });
    await fleets.bulkPutFleets(owner, seriesId, {
      fleets: [{ id: fleetId, seriesId, name: 'Class 1', displayOrder: 0, scoringSystem: 'scratch' }],
    });
    await competitors.putCompetitor(owner, seriesId, boat, {
      id: boat, seriesId, fleetIds: [fleetId], sailNumber: '1001', names: ['A Helm'], clubs: [], gender: '', age: null, createdAt: Date.now(),
    });
    await races.generateRaces(owner, seriesId, {
      races: [{ id: raceId, seriesId, raceNumber: 1, name: null, date: '2026-10-04', createdAt: Date.now() }],
      starts: [{ id: startId, raceId, fleetIds: [fleetId], startTime: '11:00:00' }],
    });
  });

  afterAll(async () => {
    const db = getDb();
    if (appId) await db.delete(schema.oauthClient).where(eq(schema.oauthClient.clientId, appId));
    if (club) await db.delete(schema.organization).where(eq(schema.organization.id, club.id));
    if (recorder) await removeUser(recorder);
  });

  const body = {
    revision: 1,
    recordedBy: 'Committee boat',
    starts: [{ startId, startTime: '11:01' }],
    finishes: [
      { id: 'c1', competitorId: boat, finishTime: '12:00:01' },
      // Sent round once while the rest sailed the full course.
      { id: 'c2', sailNumber: 'IRL 892', finishTime: '12:00:09', laps: 1 },
    ],
    complete: false,
  };

  test('a recorder’s app submits, revises, reads back and withdraws', async () => {
    const id = uuid();
    const sent = await call(submissionRoute.PUT, path(id), { token, params: { raceId, submissionId: id }, json: body });
    expect(sent.status).toBe(200);
    expect(sent.body).toEqual({
      id, raceId, seriesId, revision: 1, status: 'pending', recordedBy: 'Committee boat', complete: false,
      starts: [{ startId, startTime: '11:01:00' }],
      finishes: [
        { id: 'c1', competitorId: boat, sailNumber: null, finishTime: '12:00:01', elapsedSecs: null, laps: null, resultCode: null },
        { id: 'c2', competitorId: null, sailNumber: 'IRL 892', finishTime: '12:00:09', elapsedSecs: null, laps: 1, resultCode: null },
      ],
      // The person's name; this account hasn't given one.
      submittedBy: null,
      app: 'RaceOps',
      submittedAt: expect.stringMatching(/Z$/),
      reviewedAt: null,
      reviewedRevision: null,
      matched: 1,
      unknownSailNumbers: ['IRL 892'],
      skipped: [],
      reviewUrl: expect.stringMatching(new RegExp(`/series/${seriesId}/races/${raceId}$`)),
    });

    const stale = await call(submissionRoute.PUT, path(id), {
      token, params: { raceId, submissionId: id }, json: { ...body, complete: true },
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'conflict', message: expect.stringMatching(/higher revision/) });

    const revised = await call(submissionRoute.PUT, path(id), {
      token, params: { raceId, submissionId: id }, json: { ...body, revision: 2, complete: true },
    });
    expect(revised.body).toMatchObject({ revision: 2, complete: true });

    const list = await call(listRoute.GET, `/races/${raceId}/submissions`, { token, params: { raceId } });
    expect(list.body.submissions.map((s: { id: string }) => s.id)).toContain(id);
    expect((await call(submissionRoute.GET, path(id), { token, params: { raceId, submissionId: id } })).body.revision).toBe(2);

    const gone = await call(submissionRoute.DELETE, path(id), { token, method: 'DELETE', params: { raceId, submissionId: id } });
    expect(gone.status).toBe(204);
    expect((await call(submissionRoute.GET, path(id), { token, params: { raceId, submissionId: id } })).status).toBe(404);
  });

  test('credited to the person and the app', async () => {
    const { items } = await listActivity({ workspaceId: club.id, seriesId, page: { limit: 20, cursor: null } });
    const submitted = items.find((e) => e.action === 'finishes.submitted');
    expect(submitted).toMatchObject({ actor: { id: recorder.userId }, via: { clientId: appId, name: 'RaceOps' } });
  });

  test('a bad body says which field; a stranger’s id or start is refused', async () => {
    const id = uuid();
    const bad = await call(submissionRoute.PUT, path(id), {
      token, params: { raceId, submissionId: id }, json: { ...body, finishes: [{ id: 'x', finishTime: '25:00' }] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid');
    expect(bad.body.problems.map((p: { field: string }) => p.field)).toEqual(expect.arrayContaining(['finishes.0.finishTime']));

    const elsewhere = await call(submissionRoute.PUT, path(id), {
      token, params: { raceId, submissionId: id }, json: { ...body, starts: [{ startId: uuid(), startTime: '11:00' }] },
    });
    expect(elsewhere.status).toBe(400);
    expect(elsewhere.body.problems).toEqual([{ field: 'starts.0.startId', message: 'Not one of this race\'s starts.' }]);
  });

  test('the scope, the role and the feature each gate it', async () => {
    const id = uuid();
    const unscoped = await call(submissionRoute.PUT, path(id), { token: readOnlyToken, params: { raceId, submissionId: id }, json: body });
    expect(unscoped.status).toBe(403);
    expect(unscoped.body.message).toMatch(/submissions scope/);

    const clubMembership = and(eq(schema.member.userId, recorder.userId), eq(schema.member.organizationId, club.id));
    await getDb().update(schema.member).set({ role: 'member' }).where(clubMembership);
    const member = await call(submissionRoute.PUT, path(id), { token, params: { raceId, submissionId: id }, json: body });
    expect(member.status).toBe(403);
    expect(member.body.message).toMatch(/submit-finishes/);
    await getDb().update(schema.member).set({ role: 'recorder' }).where(clubMembership);

    await setOrgFeature(getDb(), { orgSlugOrId: club.id, feature: 'finish-submissions', enabled: false });
    const off = await call(submissionRoute.PUT, path(id), { token, params: { raceId, submissionId: id }, json: body });
    expect(off.status).toBe(403);
    expect(off.body.message).toBe('This workspace doesn’t have finish sheet submissions switched on.');
    await setOrgFeature(getDb(), { orgSlugOrId: club.id, feature: 'finish-submissions', enabled: true });
  });
});
