// @vitest-environment node

/**
 * Voice recordings through their handlers (ADR-017): sending one with a
 * finish sheet, who may hear it, sending the sound in pieces, and the
 * retention rule.
 *
 * Skipped when DATABASE_URL is unset; CI and `pnpm test:unit:db` provide it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq, inArray } from 'drizzle-orm';

import * as competitors from '@/lib/api-handlers/competitors';
import * as fleets from '@/lib/api-handlers/fleets';
import * as races from '@/lib/api-handlers/races';
import * as series from '@/lib/api-handlers/series';
import { submitFinishes, withdrawSubmission } from '@/lib/api-handlers/finish-submissions';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { submitFinishesSchema } from '@/lib/validation/finish-submission';
import { decodeMulaw, encodeMulaw, fromBase64, toBase64 } from '@/lib/voice/audio';
import { listRecordings, listenToSegments, removeRecording, sendRecording, sendSegments } from '@/lib/voice/server/handlers';
import { sweepExpiredRecordings } from '@/lib/voice/server/recording-store';
import { SEGMENT_SAMPLES, SERVER_KEEPS_DAYS_AFTER_LAST_RACE, type VoiceDocument } from '@/lib/voice/types';
import { putRecordingSchema, putSegmentsSchema } from '@/lib/voice/validation';
import { createOrg, preCreateUser } from '@/scripts/provision-org';

const DATABASE_URL = process.env.DATABASE_URL;
const uuid = () => crypto.randomUUID();
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfDay = (at: number) => Math.floor(at / DAY_MS) * DAY_MS;

describe.skipIf(!DATABASE_URL)('voice recording handlers', () => {
  let scorer!: WorkspaceContext;
  let recorder!: WorkspaceContext;
  let other!: WorkspaceContext;
  let member!: WorkspaceContext;
  const users: string[] = [];
  const seriesId = uuid();
  const fleetId = uuid();
  const raceId = uuid();
  const boat = uuid();
  const submissionId = uuid();
  const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

  const document = (recordingId: string, over: Partial<VoiceDocument> = {}): VoiceDocument => ({
    format: 2,
    recordingId,
    raceId,
    sampleRate: 16000,
    segmentSeconds: 5,
    engine: { model: 'zipformer-en-70M', version: '1', lagSeconds: 0.5 },
    device: { userAgent: 'test', microphone: 'Headset' },
    realTimeFactor: 0.2,
    // Twelve seconds: two whole pieces and a short one.
    takes: [{ index: 0, startedAt: T0, samples: 16000 * 12 }],
    gaps: [],
    presses: [{ id: 'press-1', at: T0 + 5200 }],
    words: [{ w: 'ten', at: T0 + 3500 }],
    finishes: [
      {
        id: uuid(), competitorId: boat, sailNumber: null, at: T0 + 5200, timeFrom: 'press',
        pressId: 'press-1', calledAt: T0 + 3000, removed: false,
      },
    ],
    dismissals: [],
    ...over,
  });
  const upload = (recordingId: string, over: Partial<VoiceDocument> = {}) =>
    putRecordingSchema.parse({ raceId, submissionId, document: document(recordingId, over) });
  const piece = (take: number, index: number, samples = SEGMENT_SAMPLES, value = 1000) => ({
    take,
    index,
    audio: toBase64(encodeMulaw(new Int16Array(samples).fill(value))),
  });

  beforeAll(async () => {
    const db = getDb();
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const features = ['finish-submissions' as const, 'voice-recording' as const];
    const org = await createOrg(db, { name: `Voice ${stamp}`, enabledFeatures: features });
    const mk = async (label: string, name: string) => {
      const u = await preCreateUser(db, { email: `${label}-${stamp}@sailscoring.test`, name });
      users.push(u.userId);
      return u;
    };
    const s = await mk('scorer', 'Sam Scorer');
    const r = await mk('recorder', 'Rita Recorder');
    const o = await mk('other', 'Olly Other');
    const m = await mk('member', 'Mo Member');
    const base = { workspaceId: org.id, workspaceSlug: org.slug, features };
    scorer = { ...base, userId: s.userId, email: s.email, role: 'scorer' };
    recorder = { ...base, userId: r.userId, email: r.email, role: 'recorder' };
    other = { ...base, userId: o.userId, email: o.email, role: 'recorder' };
    member = { ...base, userId: m.userId, email: m.email, role: 'member' };
    const owner: WorkspaceContext = { ...scorer, role: 'owner' };

    await series.putSeries(owner, seriesId, {
      id: seriesId, name: 'Autumn League', venue: '', startDate: '2026-11-14', endDate: '',
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
      id: boat, seriesId, fleetIds: [fleetId], sailNumber: '1002', names: ['A Helm'], clubs: [], gender: '', age: null, createdAt: Date.now(),
    });
    await races.generateRaces(owner, seriesId, {
      races: [{ id: raceId, seriesId, raceNumber: 1, name: null, date: '2026-11-14', createdAt: Date.now() }],
      starts: [],
    });
    await submitFinishes(recorder, raceId, submissionId, submitFinishesSchema.parse({
      revision: 1, finishes: [{ id: 'row-1', competitorId: boat, finishTime: '12:00:05' }],
    }));
  });

  afterAll(async () => {
    const db = getDb();
    if (scorer) await db.delete(schema.organization).where(eq(schema.organization.id, scorer.workspaceId));
    for (const id of users) await db.delete(schema.user).where(eq(schema.user.id, id));
  });

  test('the workspace needs the feature', async () => {
    const off = { ...recorder, features: ['finish-submissions' as const] };
    await expect(sendRecording(off, uuid(), upload(uuid()))).rejects.toThrow('feature-disabled:voice-recording');
    await expect(listRecordings(off, raceId)).rejects.toThrow('feature-disabled:voice-recording');
  });

  test('a recording goes with a sheet of the recorder’s own', async () => {
    const id = uuid();
    await expect(sendRecording(other, id, upload(id))).rejects.toThrow('submission-not-yours');
    await expect(
      sendRecording(recorder, id, putRecordingSchema.parse({ raceId, submissionId: uuid(), document: document(id) })),
    ).rejects.toThrow('not-found: submission');
    await expect(sendRecording(recorder, id, upload(uuid()))).rejects.toThrow('another recording');
  });

  test('sending, adding the sound, and listening', async () => {
    const id = uuid();
    const sent = await sendRecording(recorder, id, upload(id));
    expect(sent).toMatchObject({ id, raceId, submissionId, recordedBy: { name: 'Rita Recorder' }, stored: [] });
    // The series' only race was before it was sent, so its days count from the sending.
    const firstRace = Date.UTC(2026, 10, 14);
    expect(sent.expiresAt).toBe(
      Math.max(firstRace, startOfDay(sent.createdAt)) + SERVER_KEEPS_DAYS_AFTER_LAST_RACE * DAY_MS,
    );

    // The sound arrives in pieces, in any order, and a piece sent again replaces itself.
    await sendSegments(recorder, id, putSegmentsSchema.parse({ segments: [piece(0, 2, 16000 * 2), piece(0, 0)] }));
    await sendSegments(recorder, id, putSegmentsSchema.parse({ segments: [piece(0, 0, SEGMENT_SAMPLES, 2000)] }));
    const again = await sendRecording(recorder, id, upload(id, { realTimeFactor: 0.3 }));
    expect(again.stored).toEqual([{ take: 0, indexes: [0, 2] }]);
    expect(again.document.realTimeFactor).toBe(0.3);
    // Bringing it up to date doesn't move its retention date.
    expect(again.expiresAt).toBe(sent.expiresAt);

    const { segments } = await listenToSegments(scorer, id, { take: 0, from: 0, to: 5 });
    expect(segments.map((s) => s.index)).toEqual([0, 2]);
    const first = decodeMulaw(fromBase64(segments[0].audio));
    expect(first).toHaveLength(SEGMENT_SAMPLES);
    expect(Math.abs(first[0] - 2000)).toBeLessThan(100);
    expect(decodeMulaw(fromBase64(segments[1].audio))).toHaveLength(16000 * 2);
  });

  test('sound is refused for a take, or a piece, the list of calls doesn’t have', async () => {
    const id = uuid();
    await sendRecording(recorder, id, upload(id));
    await expect(sendSegments(recorder, id, putSegmentsSchema.parse({ segments: [piece(1, 0)] }))).rejects.toThrow('doesn’t have');
    await expect(sendSegments(recorder, id, putSegmentsSchema.parse({ segments: [piece(0, 3)] }))).rejects.toThrow('doesn’t have');
  });

  test('whoever made it and a scorer can hear it, and nobody else', async () => {
    const id = uuid();
    await sendRecording(recorder, id, upload(id));
    const ids = async (who: WorkspaceContext) => (await listRecordings(who, raceId)).map((r) => r.id);
    expect(await ids(recorder)).toContain(id);
    expect(await ids(scorer)).toContain(id);
    expect(await ids(other)).not.toContain(id);
    expect(await ids(member)).not.toContain(id);
    await expect(listenToSegments(member, id, { take: 0, from: 0, to: 0 })).rejects.toThrow('not-found: recording');
    await expect(listenToSegments(other, id, { take: 0, from: 0, to: 0 })).rejects.toThrow('not-found: recording');
    // A scorer hears it but can't add to it.
    await expect(sendSegments(scorer, id, putSegmentsSchema.parse({ segments: [piece(0, 0)] }))).rejects.toThrow('recording-not-yours');
    await expect(sendRecording(scorer, id, upload(id))).rejects.toThrow('recording-not-yours');
    await expect(removeRecording(member, id)).rejects.toThrow('not-found: recording');
  });

  test('a scorer’s deletion is for good: the phone can’t send it again', async () => {
    const id = uuid();
    await sendRecording(recorder, id, upload(id));
    await sendSegments(recorder, id, putSegmentsSchema.parse({ segments: [piece(0, 0)] }));
    await removeRecording(scorer, id);
    expect((await listRecordings(recorder, raceId)).map((r) => r.id)).not.toContain(id);
    expect((await listRecordings(scorer, raceId)).map((r) => r.id)).not.toContain(id);
    const left = await getDb().select().from(schema.voiceRecordingSegments).where(eq(schema.voiceRecordingSegments.recordingId, id));
    expect(left).toEqual([]);
    // What stays behind says nothing of what was called.
    const [row] = await getDb().select().from(schema.voiceRecordings).where(eq(schema.voiceRecordings.id, id));
    expect(row.document).toMatchObject({ presses: [], words: [], finishes: [], dismissals: [], takes: [] });
    // The recorder's phone still has its copy, and tries again.
    await expect(sendRecording(recorder, id, upload(id))).rejects.toThrow('recording-deleted');
    await expect(listenToSegments(recorder, id, { take: 0, from: 0, to: 0 })).rejects.toThrow('not-found: recording');
  });

  test('its maker deletes it, and may send it again', async () => {
    const id = uuid();
    await sendRecording(recorder, id, upload(id));
    await sendSegments(recorder, id, putSegmentsSchema.parse({ segments: [piece(0, 0)] }));
    await removeRecording(recorder, id);
    expect((await listRecordings(scorer, raceId)).map((r) => r.id)).not.toContain(id);
    const rows = await getDb().select().from(schema.voiceRecordings).where(eq(schema.voiceRecordings.id, id));
    expect(rows).toEqual([]);
    const again = await sendRecording(recorder, id, upload(id));
    expect(again.stored).toEqual([]);
  });

  test('it is kept until 90 days after the series’ last race, as the schedule stands', async () => {
    const id = uuid();
    await sendRecording(recorder, id, upload(id));
    const expiry = async () => (await listRecordings(scorer, raceId)).find((r) => r.id === id)?.expiresAt;
    const before = await expiry();

    // A race added later in the series keeps it longer; one without a date doesn't count.
    const later = uuid();
    const undated = uuid();
    await races.generateRaces({ ...scorer, role: 'owner' }, seriesId, {
      races: [
        { id: later, seriesId, raceNumber: 2, name: null, date: '2027-06-01', createdAt: Date.now() },
        { id: undated, seriesId, raceNumber: 3, name: null, date: '', createdAt: Date.now() },
      ],
      starts: [],
    });
    expect(await expiry()).toBe(Date.UTC(2027, 5, 1) + SERVER_KEEPS_DAYS_AFTER_LAST_RACE * DAY_MS);

    // Taken out of the schedule again, it no longer counts.
    await getDb().delete(schema.races).where(inArray(schema.races.id, [later, undated]));
    expect(await expiry()).toBe(before);
  });

  test('a recording past its date is gone, swept or not', async () => {
    const id = uuid();
    await sendRecording(recorder, id, upload(id));
    // Sent long ago, of a series whose last race was long ago.
    const db = getDb();
    const [race] = await db.select({ date: schema.races.date }).from(schema.races).where(eq(schema.races.id, raceId));
    const longAgo = new Date(Date.UTC(2020, 0, 1));
    await db.update(schema.voiceRecordings).set({ createdAt: longAgo }).where(eq(schema.voiceRecordings.id, id));
    await db.update(schema.races).set({ date: '2020-01-01' }).where(eq(schema.races.id, raceId));
    try {
      expect((await listRecordings(scorer, raceId)).map((r) => r.id)).not.toContain(id);
      await expect(listenToSegments(scorer, id, { take: 0, from: 0, to: 0 })).rejects.toThrow('not-found: recording');
      // Its id can't be taken up again while the row waits for the sweep.
      await expect(sendRecording(recorder, id, upload(id))).rejects.toThrow('already used');

      // The sweep goes by the same date: a day before it, the recording stays.
      const due = Date.UTC(2020, 0, 1) + SERVER_KEEPS_DAYS_AFTER_LAST_RACE * DAY_MS;
      expect(await sweepExpiredRecordings(new Date(due - DAY_MS))).toBe(0);
      expect(await sweepExpiredRecordings()).toBeGreaterThanOrEqual(1);
      const rows = await db.select().from(schema.voiceRecordings).where(eq(schema.voiceRecordings.id, id));
      expect(rows).toEqual([]);
    } finally {
      await db.update(schema.races).set({ date: race.date }).where(eq(schema.races.id, raceId));
    }
  });

  test('withdrawing the sheet takes its recording with it', async () => {
    const mine = uuid();
    const id = uuid();
    await submitFinishes(other, raceId, mine, submitFinishesSchema.parse({
      revision: 1, finishes: [{ id: 'row-1', competitorId: boat }],
    }));
    await sendRecording(other, id, putRecordingSchema.parse({ raceId, submissionId: mine, document: document(id) }));
    expect((await listRecordings(scorer, raceId)).map((r) => r.id)).toContain(id);
    await withdrawSubmission(other, raceId, mine);
    expect((await listRecordings(scorer, raceId)).map((r) => r.id)).not.toContain(id);
  });
});
