import 'server-only';

import { BadRequestError, NotFoundError, WouldReplaceError } from '@/app/api/v1/_lib/handler';
import { hasPermission } from '@/lib/auth/permissions';
import { ForbiddenError, requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { getSubmission } from '@/lib/finish-submission-store';
import { createRepos } from '@/lib/postgres-repository';

import { SEGMENT_SAMPLES } from '../types';
import { MAX_SEGMENTS_PER_REQUEST, type PutRecordingInput, type PutSegmentsInput } from '../validation';
import {
  deleteRecording,
  getRecording,
  listRaceRecordings,
  putRecording,
  putSegments,
  readSegments,
  recordingIdTaken,
  storedSegments,
  type StoredRecording,
} from './recording-store';

/**
 * Recordings of finishes taken by voice (ADR-017), as the API serves them.
 * The rules:
 *
 * - the workspace needs the `voice-recording` feature for any of it;
 * - a recording is sent by whoever made it, with a finish sheet submission
 *   of their own, and only they can add to it;
 * - whoever made it, and anyone who can score, can listen to it and delete
 *   it. It is the people on the committee boat talking, so nobody else can;
 * - it is gone when its submission is withdrawn, and in any case
 *   `SERVER_KEEPS_DAYS` after it was first sent.
 */

/** A recording, and how much of its sound has arrived. */
export interface RecordingInfo extends StoredRecording {
  /** For each take, the pieces of sound stored so far. */
  stored: { take: number; indexes: number[] }[];
}

async function withStored(recording: StoredRecording): Promise<RecordingInfo> {
  const byTake = new Map<number, number[]>();
  for (const s of await storedSegments(recording.id)) {
    byTake.set(s.take, [...(byTake.get(s.take) ?? []), s.index]);
  }
  return { ...recording, stored: [...byTake].map(([take, indexes]) => ({ take, indexes })) };
}

const mayHear = (workspace: WorkspaceContext, recording: StoredRecording) =>
  recording.recordedBy.id === workspace.userId || hasPermission(workspace.role, 'score');

async function heard(workspace: WorkspaceContext, recordingId: string): Promise<StoredRecording> {
  requireFeature(workspace, 'voice-recording');
  const recording = await getRecording(workspace.workspaceId, recordingId);
  // Someone who may not hear it is told no more than that it isn't there.
  if (!recording || !mayHear(workspace, recording)) throw new NotFoundError('recording');
  return recording;
}

async function own(workspace: WorkspaceContext, recordingId: string): Promise<StoredRecording> {
  const recording = await heard(workspace, recordingId);
  if (recording.recordedBy.id !== workspace.userId) throw new ForbiddenError('recording-not-yours');
  return recording;
}

/** The race's recordings the caller may hear, the latest first. */
export async function listRecordings(workspace: WorkspaceContext, raceId: string): Promise<RecordingInfo[]> {
  requireFeature(workspace, 'voice-recording');
  if (!(await createRepos({ workspaceId: workspace.workspaceId }).races.get(raceId))) throw new NotFoundError('race');
  const recordings = (await listRaceRecordings(workspace.workspaceId, raceId)).filter((r) => mayHear(workspace, r));
  return Promise.all(recordings.map(withStored));
}

/**
 * Send a recording's list of calls, or bring it up to date. The answer says
 * which pieces of sound have arrived, so the phone sends the rest, however
 * often it has to start again.
 */
export async function sendRecording(
  workspace: WorkspaceContext,
  recordingId: string,
  input: PutRecordingInput,
): Promise<RecordingInfo> {
  requireFeature(workspace, 'voice-recording');
  if (input.document.recordingId !== recordingId || input.document.raceId !== input.raceId) {
    throw new BadRequestError('The list of calls is for another recording.');
  }
  const existing = await getRecording(workspace.workspaceId, recordingId);
  if (existing) {
    if (existing.recordedBy.id !== workspace.userId) throw new ForbiddenError('recording-not-yours');
    if (existing.raceId !== input.raceId) throw new WouldReplaceError('That recording is of another race.');
  } else if (await recordingIdTaken(recordingId)) {
    throw new WouldReplaceError('That recording id is already used; choose a new one.');
  }
  const submission = await getSubmission(workspace.workspaceId, input.submissionId);
  if (!submission || submission.raceId !== input.raceId) throw new NotFoundError('submission');
  if (submission.submittedBy?.id !== workspace.userId) throw new ForbiddenError('submission-not-yours');

  await putRecording(workspace.workspaceId, {
    id: recordingId,
    raceId: input.raceId,
    submissionId: input.submissionId,
    userId: workspace.userId,
    document: input.document,
  });
  return withStored((await getRecording(workspace.workspaceId, recordingId))!);
}

/** Send pieces of a recording's sound. */
export async function sendSegments(
  workspace: WorkspaceContext,
  recordingId: string,
  input: PutSegmentsInput,
): Promise<{ stored: number }> {
  const recording = await own(workspace, recordingId);
  const takes = new Map(recording.document.takes.map((t) => [t.index, t]));
  const segments = input.segments.map((s, i) => {
    const take = takes.get(s.take);
    if (!take || s.index >= Math.ceil(take.samples / SEGMENT_SAMPLES)) {
      throw new BadRequestError('The sound is for a take the list of calls doesn’t have.', [
        { path: ['segments', i], message: 'No such piece of this recording.' },
      ]);
    }
    const audio = Buffer.from(s.audio, 'base64');
    if (audio.length === 0 || audio.length > SEGMENT_SAMPLES) {
      throw new BadRequestError('A piece of sound is the wrong length.', [
        { path: ['segments', i, 'audio'], message: `At most ${SEGMENT_SAMPLES} samples.` },
      ]);
    }
    return { take: s.take, index: s.index, audio };
  });
  await putSegments(recordingId, segments);
  return { stored: segments.length };
}

/** Pieces `from` to `to` of one take's sound, as µ-law in base64. */
export async function listenToSegments(
  workspace: WorkspaceContext,
  recordingId: string,
  range: { take: number; from: number; to: number },
): Promise<{ segments: { take: number; index: number; audio: string }[] }> {
  await heard(workspace, recordingId);
  const { take, from, to } = range;
  if (![take, from, to].every((n) => Number.isInteger(n) && n >= 0) || to < from) {
    throw new BadRequestError('Name the take and the pieces: take, from and to.');
  }
  const last = Math.min(to, from + MAX_SEGMENTS_PER_REQUEST - 1);
  const segments = await readSegments(recordingId, take, from, last);
  return { segments: segments.map((s) => ({ take: s.take, index: s.index, audio: s.audio.toString('base64') })) };
}

/** Delete a recording: whoever made it, or a scorer. */
export async function removeRecording(workspace: WorkspaceContext, recordingId: string): Promise<void> {
  await heard(workspace, recordingId);
  await deleteRecording(workspace.workspaceId, recordingId);
}
