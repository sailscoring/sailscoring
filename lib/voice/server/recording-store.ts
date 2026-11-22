import 'server-only';
import { and, asc, desc, eq, gt, gte, isNull, lt, lte, sql, type SQL } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { user } from '@/lib/db/schema/auth';
import { voiceRecordingSegments, voiceRecordings } from '@/lib/db/schema/voice';

import { PHONE_KEEPS_DAYS, SERVER_KEEPS_DAYS, type VoiceDocument } from '../types';

/**
 * Recordings of finishes taken by voice, as stored. Workspace-scoped like
 * every other read and write; `handlers.ts` decides who may do what.
 *
 * A recording past its `expires_at`, or one a scorer has deleted, is treated
 * as gone by every read here, whether or not the nightly sweep has removed
 * its row yet.
 */

export interface StoredRecording {
  id: string;
  raceId: string;
  submissionId: string | null;
  recordedBy: { id: string; name: string | null };
  document: VoiceDocument;
  createdAt: number;
  updatedAt: number;
  /** When it will be deleted. */
  expiresAt: number;
}

export interface StoredSegment {
  take: number;
  index: number;
  audio: Buffer;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const live = () => and(gt(voiceRecordings.expiresAt, new Date()), isNull(voiceRecordings.deletedAt));

async function select(workspaceId: string, where: SQL | undefined): Promise<StoredRecording[]> {
  const rows = await getDb()
    .select({ row: voiceRecordings, name: user.name })
    .from(voiceRecordings)
    .leftJoin(user, eq(voiceRecordings.recordedByUserId, user.id))
    .where(and(eq(voiceRecordings.workspaceId, workspaceId), live(), where))
    .orderBy(desc(voiceRecordings.createdAt));
  return rows.map(({ row, name }) => ({
    id: row.id,
    raceId: row.raceId,
    submissionId: row.submissionId,
    recordedBy: { id: row.recordedByUserId, name },
    document: row.document,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
  }));
}

export async function getRecording(workspaceId: string, id: string): Promise<StoredRecording | undefined> {
  const [found] = await select(workspaceId, eq(voiceRecordings.id, id));
  return found;
}

/** A race's recordings, the latest first. */
export function listRaceRecordings(workspaceId: string, raceId: string): Promise<StoredRecording[]> {
  return select(workspaceId, eq(voiceRecordings.raceId, raceId));
}

/**
 * What stands in the way of storing a recording under an id nobody can
 * see: nothing, a recording that was `deleted` and mustn't come back, or
 * one that is `taken` (another workspace's, or expired and not yet swept).
 */
export async function recordingIdState(id: string): Promise<'free' | 'deleted' | 'taken'> {
  const [row] = await getDb()
    .select({ deletedAt: voiceRecordings.deletedAt })
    .from(voiceRecordings)
    .where(eq(voiceRecordings.id, id))
    .limit(1);
  if (!row) return 'free';
  return row.deletedAt ? 'deleted' : 'taken';
}

/**
 * Store a recording's list of calls: a new recording, or the same one
 * brought up to date. The retention clock starts when it is first stored,
 * and bringing it up to date doesn't restart it.
 */
export async function putRecording(
  workspaceId: string,
  recording: { id: string; raceId: string; submissionId: string; userId: string; document: VoiceDocument },
): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(voiceRecordings)
    .values({
      id: recording.id,
      workspaceId,
      raceId: recording.raceId,
      submissionId: recording.submissionId,
      recordedByUserId: recording.userId,
      document: recording.document,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + SERVER_KEEPS_DAYS * DAY_MS),
    })
    .onConflictDoUpdate({
      target: voiceRecordings.id,
      set: { submissionId: recording.submissionId, document: recording.document, updatedAt: now },
      // Only ever the same recording: the handler has checked whose it is,
      // and this keeps a race between two requests from crossing workspaces.
      setWhere: and(eq(voiceRecordings.workspaceId, workspaceId), eq(voiceRecordings.recordedByUserId, recording.userId)),
    });
}

/** Which pieces of each take's sound are stored. */
export async function storedSegments(recordingId: string): Promise<{ take: number; index: number }[]> {
  return getDb()
    .select({ take: voiceRecordingSegments.take, index: voiceRecordingSegments.index })
    .from(voiceRecordingSegments)
    .where(eq(voiceRecordingSegments.recordingId, recordingId))
    .orderBy(asc(voiceRecordingSegments.take), asc(voiceRecordingSegments.index));
}

/** Store pieces of sound; one sent again replaces what was there. */
export async function putSegments(recordingId: string, segments: readonly StoredSegment[]): Promise<void> {
  if (segments.length === 0) return;
  await getDb()
    .insert(voiceRecordingSegments)
    .values(segments.map((s) => ({ recordingId, take: s.take, index: s.index, audio: s.audio })))
    .onConflictDoUpdate({
      target: [voiceRecordingSegments.recordingId, voiceRecordingSegments.take, voiceRecordingSegments.index],
      set: { audio: sql`excluded.audio` },
    });
}

/** The pieces of one take from `from` to `to`, in order. */
export async function readSegments(recordingId: string, take: number, from: number, to: number): Promise<StoredSegment[]> {
  return getDb()
    .select({ take: voiceRecordingSegments.take, index: voiceRecordingSegments.index, audio: voiceRecordingSegments.audio })
    .from(voiceRecordingSegments)
    .where(
      and(
        eq(voiceRecordingSegments.recordingId, recordingId),
        eq(voiceRecordingSegments.take, take),
        gte(voiceRecordingSegments.index, from),
        lte(voiceRecordingSegments.index, to),
      ),
    )
    .orderBy(asc(voiceRecordingSegments.index));
}

/** Delete a recording and its sound. Returns whether there was one. */
export async function deleteRecording(workspaceId: string, id: string): Promise<boolean> {
  const gone = await getDb()
    .delete(voiceRecordings)
    .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.workspaceId, workspaceId)))
    .returning({ id: voiceRecordings.id });
  return gone.length > 0;
}

/**
 * Delete a recording so that it stays deleted: the sound and the list of
 * calls go now, and the emptied row is kept until the phone it came from
 * has removed its own copy, so that phone can't send it again.
 */
export async function deleteRecordingForGood(workspaceId: string, id: string): Promise<boolean> {
  const now = new Date();
  const [row] = await getDb()
    .select({ document: voiceRecordings.document })
    .from(voiceRecordings)
    .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return false;
  await getDb().delete(voiceRecordingSegments).where(eq(voiceRecordingSegments.recordingId, id));
  await getDb()
    .update(voiceRecordings)
    .set({
      document: { ...row.document, takes: [], gaps: [], presses: [], words: [], finishes: [], dismissals: [] },
      deletedAt: now,
      expiresAt: new Date(now.getTime() + (PHONE_KEEPS_DAYS + 1) * DAY_MS),
    })
    .where(and(eq(voiceRecordings.id, id), eq(voiceRecordings.workspaceId, workspaceId)));
  return true;
}

/** Delete the recordings that went with a submission: it was withdrawn. */
export async function deleteRecordingsOfSubmission(workspaceId: string, submissionId: string): Promise<number> {
  const gone = await getDb()
    .delete(voiceRecordings)
    .where(and(eq(voiceRecordings.submissionId, submissionId), eq(voiceRecordings.workspaceId, workspaceId)))
    .returning({ id: voiceRecordings.id });
  return gone.length;
}

/** The retention rule, carried out: delete every recording past its date,
 *  in every workspace. Returns how many went. */
export async function sweepExpiredRecordings(now: Date = new Date()): Promise<number> {
  const gone = await getDb()
    .delete(voiceRecordings)
    .where(lt(voiceRecordings.expiresAt, now))
    .returning({ id: voiceRecordings.id });
  return gone.length;
}
