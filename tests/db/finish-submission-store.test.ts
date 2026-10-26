// @vitest-environment node

/**
 * Finish sheet submissions as stored (#671): a new id is a new submission,
 * a higher revision replaces it and puts it back to pending, a retry of the
 * same revision changes nothing, and anything else is refused with the
 * reason. A review is recorded against the revision it was of.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq } from 'drizzle-orm';

import * as races from '@/lib/api-handlers/races';
import * as series from '@/lib/api-handlers/series';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  deleteSubmission,
  getSubmission,
  listRaceSubmissions,
  listSeriesSubmissions,
  markReviewed,
  putSubmission,
  type SubmissionUpload,
} from '@/lib/finish-submission-store';
import { createOrg, preCreateUser } from '@/scripts/provision-org';

const DATABASE_URL = process.env.DATABASE_URL;
const uuid = () => crypto.randomUUID();

describe.skipIf(!DATABASE_URL)('finish submission store', () => {
  let ctx!: WorkspaceContext;
  let other!: { id: string };
  let recorder!: { userId: string };
  let scorer!: { userId: string };
  const seriesId = uuid();
  const raceId = uuid();
  const otherRaceId = uuid();
  const startId = uuid();

  const upload = (over: Partial<SubmissionUpload> = {}): SubmissionUpload => ({
    id: uuid(),
    raceId,
    revision: 1,
    recordedBy: 'Committee boat',
    starts: [{ startId, startTime: '11:00:00' }],
    finishes: [{ id: 'f1', competitorId: null, sailNumber: 'IRL 892', finishTime: '12:01:02', elapsedSecs: null, resultCode: null }],
    complete: false,
    ...over,
  });

  beforeAll(async () => {
    const db = getDb();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await createOrg(db, { name: `Submissions ${stamp}` });
    other = await createOrg(db, { name: `Elsewhere ${stamp}` });
    recorder = await preCreateUser(db, { email: `recorder-${stamp}@sailscoring.test`, name: 'Rita Recorder' });
    scorer = await preCreateUser(db, { email: `scorer-${stamp}@sailscoring.test`, name: 'Sam Scorer' });
    ctx = { userId: scorer.userId, email: 'scorer@sailscoring.test', workspaceId: org.id, workspaceSlug: org.slug, role: 'owner', features: [] };
    await series.putSeries(ctx, seriesId, {
      id: seriesId, name: 'Autumn League', venue: '', startDate: '2026-10-04', endDate: '',
      venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '',
      createdAt: Date.now(), lastSavedAt: null, lastModifiedAt: Date.now(),
      scoringMode: 'handicap', discardThresholds: [], dnfScoring: 'seriesEntries',
      ftpHost: '', ftpPath: '', ftpPaths: {}, includeJsonExport: true, publishRatingCalculations: true,
      enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
    });
    await races.generateRaces(ctx, seriesId, {
      races: [
        { id: raceId, seriesId, raceNumber: 1, name: null, date: '2026-10-04', createdAt: Date.now() },
        { id: otherRaceId, seriesId, raceNumber: 2, name: null, date: '2026-10-04', createdAt: Date.now() },
      ],
      starts: [{ id: startId, raceId, fleetIds: [] }],
    });
  });

  afterAll(async () => {
    const db = getDb();
    for (const id of [ctx?.workspaceId, other?.id]) {
      if (id) await db.delete(schema.organization).where(eq(schema.organization.id, id));
    }
    for (const u of [recorder, scorer]) {
      if (u) await db.delete(schema.user).where(eq(schema.user.id, u.userId));
    }
  });

  test('a new submission is pending, credited to who sent it and through what', async () => {
    const sent = upload();
    const out = await putSubmission(ctx.workspaceId, sent, {
      userId: recorder.userId,
      via: { clientId: 'raceops', name: 'RaceOps' },
    });
    expect(out.kind).toBe('created');
    if (out.kind === 'refused') return;
    expect(out.submission).toMatchObject({
      id: sent.id,
      raceId,
      seriesId,
      revision: 1,
      status: 'pending',
      submittedBy: { id: recorder.userId, name: 'Rita Recorder' },
      via: { clientId: 'raceops', name: 'RaceOps' },
      starts: sent.starts,
      finishes: sent.finishes,
      reviewedBy: null,
    });
  });

  test('a retry is recognised; a stale or rewritten revision is refused', async () => {
    const sent = upload();
    const by = { userId: recorder.userId };
    await putSubmission(ctx.workspaceId, sent, by);
    expect((await putSubmission(ctx.workspaceId, { ...sent }, by)).kind).toBe('unchanged');
    expect(await putSubmission(ctx.workspaceId, { ...sent, complete: true }, by)).toEqual({ kind: 'refused', refusal: 'stale' });

    const revised = await putSubmission(ctx.workspaceId, { ...sent, revision: 3, complete: true }, by);
    expect(revised.kind).toBe('revised');
    expect(await putSubmission(ctx.workspaceId, { ...sent, revision: 2 }, by)).toEqual({ kind: 'refused', refusal: 'stale' });
    expect((await getSubmission(ctx.workspaceId, sent.id))?.revision).toBe(3);
  });

  test('someone else’s submission, or another race’s, can’t be overwritten', async () => {
    const sent = upload();
    await putSubmission(ctx.workspaceId, sent, { userId: recorder.userId });
    expect(await putSubmission(ctx.workspaceId, { ...sent, revision: 2 }, { userId: scorer.userId }))
      .toEqual({ kind: 'refused', refusal: 'not-yours' });
    expect(await putSubmission(ctx.workspaceId, { ...sent, raceId: otherRaceId, revision: 2 }, { userId: recorder.userId }))
      .toEqual({ kind: 'refused', refusal: 'elsewhere' });
    // Another workspace never sees it.
    expect(await getSubmission(other.id, sent.id)).toBeUndefined();
    expect(await putSubmission(other.id, { ...sent, revision: 2 }, { userId: recorder.userId }))
      .toEqual({ kind: 'refused', refusal: 'elsewhere' });
  });

  test('a review is of one revision; a newer revision makes it pending again', async () => {
    const sent = upload();
    const by = { userId: recorder.userId };
    await putSubmission(ctx.workspaceId, sent, by);
    await putSubmission(ctx.workspaceId, { ...sent, revision: 2 }, by);
    expect(await markReviewed(ctx.workspaceId, sent.id, { status: 'applied', revision: 1, userId: scorer.userId })).toBeNull();

    const applied = await markReviewed(ctx.workspaceId, sent.id, { status: 'applied', revision: 2, userId: scorer.userId });
    expect(applied).toMatchObject({ status: 'applied', reviewedRevision: 2, reviewedBy: { id: scorer.userId, name: 'Sam Scorer' } });

    await putSubmission(ctx.workspaceId, { ...sent, revision: 3, complete: true }, by);
    expect(await getSubmission(ctx.workspaceId, sent.id)).toMatchObject({ status: 'pending', revision: 3, reviewedRevision: 2 });
  });

  test('listed by race and by series and status; withdrawn; gone with the race', async () => {
    const sent = upload({ raceId: otherRaceId });
    await putSubmission(ctx.workspaceId, sent, { userId: recorder.userId });
    expect((await listRaceSubmissions(ctx.workspaceId, otherRaceId)).map((s) => s.id)).toEqual([sent.id]);
    const pending = await listSeriesSubmissions(ctx.workspaceId, seriesId, ['pending']);
    expect(pending.map((s) => s.id)).toContain(sent.id);
    expect(pending.every((s) => s.status === 'pending')).toBe(true);

    expect(await deleteSubmission(other.id, sent.id)).toBe(false);
    expect(await deleteSubmission(ctx.workspaceId, sent.id)).toBe(true);
    expect(await getSubmission(ctx.workspaceId, sent.id)).toBeUndefined();

    const kept = upload({ raceId: otherRaceId });
    await putSubmission(ctx.workspaceId, kept, { userId: recorder.userId });
    await races.deleteRace(ctx, seriesId, otherRaceId);
    expect(await getSubmission(ctx.workspaceId, kept.id)).toBeUndefined();
  });
});
