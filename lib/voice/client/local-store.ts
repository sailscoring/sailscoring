/**
 * What recording finishes by voice keeps on the phone, in IndexedDB: each
 * race's recording (what was heard and pressed, what was decided, and the
 * sound in pieces), and the sheet being taken down, so that neither is lost
 * to a reload or to a phone that put the page to sleep.
 *
 * A database of its own, so the feature leaves nothing behind in the app's
 * storage if it is ever taken out.
 */

import {
  PHONE_KEEPS_DAYS,
  SAMPLE_RATE,
  SEGMENT_SECONDS,
  VOICE_DOCUMENT_FORMAT,
  type VoiceDismissal,
  type VoiceDocument,
  type VoiceFinish,
  type VoiceGap,
  type VoicePress,
  type VoiceTake,
  type VoiceWord,
} from '../types';

/** A race's recording as the phone holds it. */
export interface LocalRecording {
  id: string;
  raceId: string;
  userId: string;
  createdAt: number;
  takes: VoiceTake[];
  gaps: VoiceGap[];
  presses: VoicePress[];
  words: VoiceWord[];
  finishes: VoiceFinish[];
  dismissals: VoiceDismissal[];
  engine: VoiceDocument['engine'];
  device: VoiceDocument['device'];
  /** Milliseconds the recogniser has worked, and seconds of sound it had. */
  cost: number;
  span: number;
  /** Whether the recording goes to the scorer with the sheet. On unless
   *  the recorder turns it off. */
  send: boolean;
}

export function newRecording(raceId: string, userId: string): LocalRecording {
  return {
    id: crypto.randomUUID(),
    raceId,
    userId,
    createdAt: Date.now(),
    takes: [],
    gaps: [],
    presses: [],
    words: [],
    finishes: [],
    dismissals: [],
    engine: null,
    device: { userAgent: navigator.userAgent, microphone: null },
    cost: 0,
    span: 0,
    send: true,
  };
}

/** The recording as it is saved and sent. */
export function documentOf(recording: LocalRecording): VoiceDocument {
  return {
    format: VOICE_DOCUMENT_FORMAT,
    recordingId: recording.id,
    raceId: recording.raceId,
    sampleRate: SAMPLE_RATE,
    segmentSeconds: SEGMENT_SECONDS,
    engine: recording.engine,
    device: recording.device,
    realTimeFactor: recording.span > 0 ? Math.round((recording.cost / 1000 / recording.span) * 1000) / 1000 : null,
    takes: recording.takes,
    gaps: recording.gaps,
    presses: recording.presses,
    words: recording.words,
    finishes: recording.finishes,
    dismissals: recording.dismissals,
  };
}

/**
 * A recording kept by an earlier build of this page, which took lines down
 * as it listened: its sound and its words stand, and its lines, which were
 * rows of the sheet, stay there as ordinary rows.
 */
function upgraded(stored: LocalRecording & { lines?: unknown }): LocalRecording {
  if (Array.isArray(stored.presses) && Array.isArray(stored.finishes)) return stored;
  const rest: LocalRecording & { lines?: unknown } = { ...stored };
  delete rest.lines;
  return { ...rest, presses: [], finishes: [], dismissals: [], words: stored.words ?? [] };
}

/** When the phone's copy of a recording is removed. */
export const phoneKeepsUntil = (recording: Pick<LocalRecording, 'createdAt'>) =>
  recording.createdAt + PHONE_KEEPS_DAYS * 24 * 60 * 60 * 1000;

const DB_NAME = 'sailscoring-voice';
const RECORDINGS = 'recordings';
const SEGMENTS = 'segments';
const DRAFTS = 'drafts';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('The phone’s storage failed.'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('The phone’s storage failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('The phone’s storage failed.'));
  });
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const recordings = db.createObjectStore(RECORDINGS, { keyPath: 'id' });
      recordings.createIndex('byRace', ['raceId', 'userId']);
      db.createObjectStore(SEGMENTS);
      db.createObjectStore(DRAFTS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error ?? new Error('The phone’s storage isn’t available.'));
    };
  });
  return opening;
}

const segmentKey = (recordingId: string, take: number, index: number) => [recordingId, take, index];
const segmentRange = (recordingId: string, take?: number) =>
  take === undefined
    ? IDBKeyRange.bound([recordingId], [recordingId, []])
    : IDBKeyRange.bound([recordingId, take], [recordingId, take, []]);

/** This user's recording of a race on this phone, if there is one. */
export async function recordingFor(raceId: string, userId: string): Promise<LocalRecording | undefined> {
  const db = await open();
  const all = await request(
    db.transaction(RECORDINGS).objectStore(RECORDINGS).index('byRace').getAll([raceId, userId]) as IDBRequest<LocalRecording[]>,
  );
  const latest = all.sort((a, b) => b.createdAt - a.createdAt)[0];
  return latest ? upgraded(latest) : undefined;
}

export async function saveRecording(recording: LocalRecording): Promise<void> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, 'readwrite');
  tx.objectStore(RECORDINGS).put(recording);
  await done(tx);
}

/** Remove a recording from the phone, sound and all. */
export async function forgetRecording(recordingId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, SEGMENTS], 'readwrite');
  tx.objectStore(RECORDINGS).delete(recordingId);
  tx.objectStore(SEGMENTS).delete(segmentRange(recordingId));
  await done(tx);
}

/** Remove the recordings the phone has kept for as long as it said it would. */
export async function forgetExpired(now: number = Date.now()): Promise<void> {
  const db = await open();
  const all = await request(db.transaction(RECORDINGS).objectStore(RECORDINGS).getAll() as IDBRequest<LocalRecording[]>);
  for (const recording of all) {
    if (phoneKeepsUntil(recording) < now) await forgetRecording(recording.id);
  }
}

/** Keep a piece of a take's sound. A piece put again replaces itself, which
 *  is how the piece still being recorded is kept as it grows. */
export async function saveSegment(recordingId: string, take: number, index: number, pcm: Int16Array): Promise<void> {
  const db = await open();
  const tx = db.transaction(SEGMENTS, 'readwrite');
  tx.objectStore(SEGMENTS).put(pcm, segmentKey(recordingId, take, index));
  await done(tx);
}

export async function readSegment(recordingId: string, take: number, index: number): Promise<Int16Array | undefined> {
  const db = await open();
  return request(db.transaction(SEGMENTS).objectStore(SEGMENTS).get(segmentKey(recordingId, take, index)) as IDBRequest<Int16Array | undefined>);
}

/** The whole of a take's sound, piece by piece, in order. */
export async function readTake(recordingId: string, take: number): Promise<Int16Array[]> {
  const db = await open();
  return request(db.transaction(SEGMENTS).objectStore(SEGMENTS).getAll(segmentRange(recordingId, take)) as IDBRequest<Int16Array[]>);
}

export async function readDraft<T>(key: string): Promise<T | undefined> {
  const db = await open();
  return request(db.transaction(DRAFTS).objectStore(DRAFTS).get(key) as IDBRequest<T | undefined>);
}

export async function saveDraft<T>(key: string, draft: T): Promise<void> {
  const db = await open();
  const tx = db.transaction(DRAFTS, 'readwrite');
  tx.objectStore(DRAFTS).put(draft, key);
  await done(tx);
}

export async function forgetDraft(key: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(DRAFTS, 'readwrite');
  tx.objectStore(DRAFTS).delete(key);
  await done(tx);
}
