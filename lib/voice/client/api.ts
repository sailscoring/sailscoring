/**
 * The voice recording API from the browser: sending a recording to the
 * scorer with its sheet, and fetching one to listen to. Thin wrappers over
 * `/api/v1/voice`.
 */

import { apiFetch } from '@/lib/api-client';

import { decodeMulaw, encodeMulaw, fromBase64, toBase64 } from '../audio';
import type { RecordingInfo } from '../server/handlers';
import { SEGMENT_SAMPLES } from '../types';
import { MAX_SEGMENTS_PER_REQUEST } from '../validation';
import { documentOf, readSegment, type LocalRecording } from './local-store';

export type { RecordingInfo };

/** The race's recordings this user may hear, the latest first. */
export function listRaceRecordings(raceId: string): Promise<RecordingInfo[]> {
  return apiFetch(`/api/v1/voice/races/${raceId}/recordings`);
}

export async function deleteRecording(recordingId: string): Promise<void> {
  await apiFetch(`/api/v1/voice/recordings/${recordingId}`, { method: 'DELETE', allow404: true });
}

/** One piece of a stored recording's sound, or undefined where the server
 *  doesn't have it (yet). */
export async function fetchSegment(recordingId: string, take: number, index: number): Promise<Int16Array | undefined> {
  const { segments } = await apiFetch<{ segments: { index: number; audio: string }[] }>(
    `/api/v1/voice/recordings/${recordingId}/audio?take=${take}&from=${index}&to=${index}`,
  );
  const found = segments.find((s) => s.index === index);
  return found ? decodeMulaw(fromBase64(found.audio)) : undefined;
}

/** Every piece of a take, in order, fetched a couple of minutes at a time. */
export async function fetchTake(recordingId: string, take: number, pieces: number): Promise<(Int16Array | undefined)[]> {
  const out: (Int16Array | undefined)[] = new Array(pieces).fill(undefined);
  for (let from = 0; from < pieces; from += MAX_SEGMENTS_PER_REQUEST) {
    const to = Math.min(pieces, from + MAX_SEGMENTS_PER_REQUEST) - 1;
    const { segments } = await apiFetch<{ segments: { index: number; audio: string }[] }>(
      `/api/v1/voice/recordings/${recordingId}/audio?take=${take}&from=${from}&to=${to}`,
    );
    for (const s of segments) out[s.index] = decodeMulaw(fromBase64(s.audio));
  }
  return out;
}

/** Pieces of sound sent in one request: a minute of it. */
const BATCH = 12;

/**
 * Send a recording with its finish sheet submission: the list of calls,
 * then whatever of the sound the server doesn't have yet. Safe to run again
 * at any point, which is how it copes with a signal that comes and goes: it
 * asks what has arrived and sends the rest.
 */
export async function sendRecording(
  recording: LocalRecording,
  submissionId: string,
  onProgress: (sent: number, total: number) => void = () => {},
): Promise<RecordingInfo> {
  const info = await apiFetch<RecordingInfo>(`/api/v1/voice/recordings/${recording.id}`, {
    method: 'PUT',
    body: { raceId: recording.raceId, submissionId, document: documentOf(recording) },
    // Sending the same list twice is the same as sending it once.
    idempotencyKey: null,
  });
  const have = new Set(info.stored.flatMap((s) => s.indexes.map((i) => `${s.take}:${i}`)));
  const all = recording.takes.flatMap((take) =>
    Array.from({ length: Math.ceil(take.samples / SEGMENT_SAMPLES) }, (_, index) => ({ take: take.index, index })),
  );
  const missing = all.filter((s) => !have.has(`${s.take}:${s.index}`));
  let sent = all.length - missing.length;
  onProgress(sent, all.length);
  for (let i = 0; i < missing.length; i += BATCH) {
    const segments: { take: number; index: number; audio: string }[] = [];
    for (const s of missing.slice(i, i + BATCH)) {
      const pcm = await readSegment(recording.id, s.take, s.index);
      // A piece the phone no longer has can't be sent; the rest still go.
      if (pcm && pcm.length > 0) segments.push({ ...s, audio: toBase64(encodeMulaw(pcm)) });
    }
    if (segments.length > 0) {
      await apiFetch(`/api/v1/voice/recordings/${recording.id}/audio`, { method: 'PUT', body: { segments }, idempotencyKey: null });
    }
    sent += Math.min(BATCH, missing.length - i);
    onProgress(sent, all.length);
  }
  return info;
}
