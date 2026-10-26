// @vitest-environment node

/**
 * Finish sheet submissions through their handlers (#671): what a recorder
 * hears back about an upload, what's refused and why, withdrawing, the
 * scorer's review, and the activity each leaves.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as races from '@/lib/api-handlers/races';
import * as series from '@/lib/api-handlers/series';
import {
  getSubmissionForRace,
  listPendingSubmissionsForSeries,
  listSubmissionsForRace,
  reviewSubmission,
  submitFinishes,
  withdrawSubmission,
} from '@/lib/api-handlers/finish-submissions';
import { listActivity } from '@/lib/activity-log';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { submitFinishesSchema, type SubmitFinishesInput } from '@/lib/validation/finish-submission';
import { createOrg, preCreateUser } from '@/scripts/provision-org';

const DATABASE_URL = process.env.DATABASE_URL;
const uuid = () => crypto.randomUUID();

describe.skipIf(!DATABASE_URL)('finish submission handlers', () => {
  let scorer!: WorkspaceContext;
  let recorder!: WorkspaceContext;
  const users: string[] = [];
  const seriesId = uuid();
  const fleetA = uuid();
  const fleetB = uuid();
  const raceId = uuid();
  const startA = uuid();
  const boat1 = uuid();
  const boat2 = uuid();
  const boatB = uuid();

  const input = (over: Partial<SubmitFinishesInput> = {}): SubmitFinishesInput =>
    submitFinishesSchema.parse({
      revision: 1,
      recordedBy: 'Committee boat',
      starts: [{ startId: startA, startTime: '11:02' }],
      finishes: [
        { id: 'c1', competitorId: boat2, finishTime: '12:00:01' },
        { id: 'c2', sailNumber: '1001', finishTime: '12:00:09' },
        { id: 'c3', sailNumber: 'IRL 892', finishTime: '12:01:00' },
        { id: 'c4', competitorId: boatB, finishTime: '12:02:00' },
      ],
      complete: true,
      ...over,
    });

  beforeAll(async () => {
    const db = getDb();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await createOrg(db, { name: `Recorders ${stamp}`, enabledFeatures: ['finish-submissions'] });
    const s = await preCreateUser(db, { email: `scorer-${stamp}@sailscoring.test`, name: 'Sam Scorer' });
    const r = await preCreateUser(db, { email: `recorder-${stamp}@sailscoring.test`, name: 'Rita Recorder' });
    users.push(s.userId, r.userId);
    const base = { workspaceId: org.id, workspaceSlug: org.slug, features: ['finish-submissions' as const] };
    scorer = { ...base, userId: s.userId, email: s.email, role: 'scorer' };
    recorder = { ...base, userId: r.userId, email: r.email, role: 'recorder' };
    const owner: WorkspaceContext = { ...scorer, role: 'owner' };

    await series.putSeries(owner, seriesId, {
      id: seriesId, name: 'Autumn League', venue: '', startDate: '2026-10-04', endDate: '',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'scratch', discardThresholds: [], dnfScoring: 'seriesEntries',
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, publishRatingCalculations: true,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
    });
    await fleets.bulkPutFleets(owner, seriesId, {
      fleets: [
        { id: fleetA, seriesId, name: 'Class 1', displayOrder: 0, scoringSystem: 'scratch' },
        { id: fleetB, seriesId, name: 'Class 2', displayOrder: 1, scoringSystem: 'scratch' },
      ],
    });
    const boat = (id: string, sailNumber: string, fleetId: string) =>
      competitors.putCompetitor(owner, seriesId, id, {
        id, seriesId, fleetIds: [fleetId], sailNumber, names: ['A Helm'], clubs: [], gender: '', age: null, createdAt: Date.now(),
      });
    await boat(boat1, '1001', fleetA);
    await boat(boat2, '1002', fleetA);
    await boat(boatB, '2001', fleetB);
    // Only Class 1 starts in this race.
    await races.generateRaces(owner, seriesId, {
      races: [{ id: raceId, seriesId, raceNumber: 1, name: null, date: '2026-10-04', createdAt: Date.now() }],
      starts: [{ id: startA, raceId, fleetIds: [fleetA], startTime: '11:00:00' }],
    });
  });

  afterAll(async () => {
    const db = getDb();
    if (scorer) await db.delete(schema.organization).where(eq(schema.organization.id, scorer.workspaceId));
    for (const id of users) await db.delete(schema.user).where(eq(schema.user.id, id));
  });

  test('the workspace needs the feature', async () => {
    const off = { ...recorder, features: [] };
    await expect(submitFinishes(off, raceId, uuid(), input())).rejects.toMatchObject({ reason: 'feature-disabled:finish-submissions' });
    await expect(listSubmissionsForRace(off, raceId)).rejects.toMatchObject({ reason: 'feature-disabled:finish-submissions' });
  });

  test('a recorder hears what matched, what didn’t, and what the review will leave out', async () => {
    const id = uuid();
    const receipt = await submitFinishes(recorder, raceId, id, input());
    expect(receipt.submission).toMatchObject({
      id, raceId, seriesId, revision: 1, status: 'pending', complete: true,
      recordedBy: 'Committee boat',
      submittedBy: { id: recorder.userId, name: 'Rita Recorder' },
      starts: [{ startId: startA, startTime: '11:02:00' }],
    });
    expect(receipt.match).toEqual({
      matched: 2,
      unknownSailNumbers: ['IRL 892'],
      // Class 2 has no start in this race.
      skipped: [{ id: 'c4', reason: '2001 isn\'t entered in a fleet in this race' }],
    });
    expect((await getSubmissionForRace(scorer, raceId, id)).match).toEqual(receipt.match);
    expect((await listSubmissionsForRace(scorer, raceId)).map((s) => s.id)).toContain(id);
    expect((await listPendingSubmissionsForSeries(scorer, seriesId)).map((s) => s.id)).toContain(id);
  });

  test('a boat or a start the race doesn’t have is refused, with where', async () => {
    const err = await submitFinishes(recorder, raceId, uuid(), input({
      starts: [{ startId: uuid(), startTime: '11:00:00' }],
      finishes: [
        { id: 'a', competitorId: uuid(), sailNumber: null, finishTime: null, elapsedSecs: null, resultCode: null },
        { id: 'a', competitorId: null, sailNumber: '1001', finishTime: null, elapsedSecs: null, resultCode: null },
      ],
    })).catch((e) => e);
    expect(err.name).toBe('BadRequestError');
    expect(err.issues.map((i: { path: unknown[] }) => i.path.join('.'))).toEqual([
      'starts.0.startId',
      'finishes.0.competitorId',
      'finishes.1.id',
    ]);
    await expect(submitFinishes(recorder, raceId, 'not-a-uuid', input())).rejects.toMatchObject({ name: 'BadRequestError' });
  });

  test('a body naming neither boat, or both times, doesn’t validate', () => {
    expect(submitFinishesSchema.safeParse({ revision: 1, finishes: [{ id: 'a' }] }).success).toBe(false);
    expect(submitFinishesSchema.safeParse({
      revision: 1, finishes: [{ id: 'a', sailNumber: '1', finishTime: '12:00:00', elapsedSecs: 60 }],
    }).success).toBe(false);
    expect(submitFinishesSchema.safeParse({ revision: 1, finishes: [{ id: 'a', sailNumber: '1', resultCode: 'RDG' }] }).success).toBe(false);
    expect(submitFinishesSchema.safeParse({ revision: 1, finishes: [], extra: true }).success).toBe(false);
  });

  test('revising, retrying, and what is refused', async () => {
    const id = uuid();
    await submitFinishes(recorder, raceId, id, input({ complete: false }));
    expect((await submitFinishes(recorder, raceId, id, input({ complete: false }))).submission.revision).toBe(1);
    await expect(submitFinishes(recorder, raceId, id, input())).rejects.toMatchObject({
      name: 'WouldReplaceError', message: expect.stringMatching(/Revision 1 .* higher revision/),
    });
    expect((await submitFinishes(recorder, raceId, id, input({ revision: 2 }))).submission).toMatchObject({ revision: 2, complete: true });
    await expect(submitFinishes(scorer, raceId, id, input({ revision: 3 }))).rejects.toMatchObject({ reason: 'submission-not-yours' });
  });

  test('a review is of one revision', async () => {
    const id = uuid();
    await submitFinishes(recorder, raceId, id, input());
    await submitFinishes(recorder, raceId, id, input({ revision: 2 }));
    await expect(reviewSubmission(scorer, raceId, id, { status: 'applied', revision: 1 })).rejects.toMatchObject({
      name: 'WouldReplaceError', message: expect.stringMatching(/revision 2/),
    });
    const applied = await reviewSubmission(scorer, raceId, id, { status: 'applied', revision: 2 });
    expect(applied).toMatchObject({ status: 'applied', reviewedRevision: 2, reviewedBy: { id: scorer.userId } });

    // Applied, it stays as the record of where the sheet came from.
    await expect(withdrawSubmission(recorder, raceId, id)).rejects.toMatchObject({ name: 'WouldReplaceError' });
    // A correction puts it back in front of the scorer.
    expect((await submitFinishes(recorder, raceId, id, input({ revision: 3 }))).submission.status).toBe('pending');
  });

  test('a recorder withdraws their own, and no one else’s', async () => {
    const id = uuid();
    await submitFinishes(recorder, raceId, id, input());
    await expect(withdrawSubmission(scorer, raceId, id)).rejects.toMatchObject({ reason: 'submission-not-yours' });
    await reviewSubmission(scorer, raceId, id, { status: 'dismissed', revision: 1 });
    await withdrawSubmission(recorder, raceId, id);
    await expect(getSubmissionForRace(scorer, raceId, id)).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(withdrawSubmission(recorder, raceId, id)).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  test('each step is in the activity log, a submission’s revisions folded into one entry', async () => {
    const { items } = await listActivity({ workspaceId: scorer.workspaceId, seriesId, page: { limit: 100, cursor: null } });
    const actions = items.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining([
      'finishes.submitted',
      'finishes.submission-applied',
      'finishes.submission-dismissed',
      'finishes.submission-withdrawn',
    ]));
    const applied = items.find((e) => e.action === 'finishes.submission-applied');
    expect(applied?.summary).toBe('Applied finishes submitted by Rita Recorder for Race 1');
    const submitted = items.filter((e) => e.action === 'finishes.submitted');
    // Four submissions in this file reached the store, however many revisions.
    expect(submitted).toHaveLength(4);
  });
});
