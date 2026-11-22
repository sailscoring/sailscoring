/**
 * Recording finishes by voice (ADR-017): the shapes shared by the phone, the
 * server and the scorer's review. Everything here is plain data, so the same
 * document is what the phone keeps, what it saves as a file, and what it
 * sends with the sheet.
 *
 * A recording is three kinds of thing on one clock:
 *
 *   evidence   the sound, the presses of NOW, the stretches nothing was
 *              recorded, and the words the recogniser heard. Written while
 *              recording, never edited.
 *   readings   the timeline worked out from the evidence: snippets of
 *              speech, the sail numbers in them, the spoken NOWs, and the
 *              suggested finishes (`timeline.ts`). Never stored: worked out
 *              again whenever the evidence, the entry list or the model's
 *              timing changes.
 *   decisions  what a person made of it: the finishes they accepted or
 *              made, and what they said was not a finish. Kept.
 *
 * Every time is the phone's clock, in milliseconds since the epoch. The
 * sound is one or more *takes*: unbroken runs of it. Recording that is
 * interrupted (a phone call, the screen switched off) ends a take, and the
 * next one starts when the microphone comes back.
 */

/** The sound is kept at the rate the recogniser hears it. */
export const SAMPLE_RATE = 16000;
/** A take's sound is stored and sent in pieces this long. */
export const SEGMENT_SECONDS = 5;
export const SEGMENT_SAMPLES = SAMPLE_RATE * SEGMENT_SECONDS;

/** How long the phone keeps a recording, and how long the server does. */
export const PHONE_KEEPS_DAYS = 7;
export const SERVER_KEEPS_DAYS = 30;

/** Format 1 held lines taken down while listening; it never left the
 *  branch it was built on, and nothing reads it. */
export const VOICE_DOCUMENT_FORMAT = 2;

export interface VoiceTake {
  index: number;
  /** When its first sample was heard. */
  startedAt: number;
  /** Samples of sound in it. */
  samples: number;
}

/** A stretch in which nothing was recorded, though recording was meant to be on. */
export interface VoiceGap {
  from: number;
  to: number;
}

/** A press of NOW: a line on the timeline at that instant, and nothing more. */
export interface VoicePress {
  id: string;
  at: number;
}

/**
 * A word the recogniser heard. `at` is when the recogniser placed it, which
 * is later than it was said by the engine's `lagSeconds`; the reading
 * subtracts that, so a better estimate of the lag moves every word at once.
 */
export interface VoiceWord {
  w: string;
  at: number;
}

/** Where a finish's time came from: a press of NOW, a word called out after
 *  the sail number, the moment the sail number was called out, or a person
 *  setting it (the playhead, or a nudge). */
export type VoiceTimeFrom = 'press' | 'spoken' | 'called' | 'hand';

/**
 * A finish a person has accepted or made. Its `id` is the id of its row on
 * the finish sheet. It points at its evidence by the press's id and by
 * times, never by anything a reading made up, so it survives a new reading.
 */
export interface VoiceFinish {
  id: string;
  /** The competitor, where they are on the entry list. */
  competitorId: string | null;
  /** The sail number typed or heard, for a competitor not on the entry list. */
  sailNumber: string | null;
  /** When they finished. */
  at: number;
  timeFrom: VoiceTimeFrom;
  /** The press of NOW the time came from. */
  pressId: string | null;
  /** When the sail number it was made from was called out. */
  calledAt: number | null;
  /** Its row was deleted from the sheet: a finish no more, and its evidence
   *  isn't suggested again. */
  removed: boolean;
}

/** Evidence a person has said is not a finish: a NOW (pressed, or called out
 *  at `spokenAt`), or a sail number called out at `calledAt`. */
export interface VoiceDismissal {
  pressId: string | null;
  spokenAt: number | null;
  calledAt: number | null;
}

/**
 * A recording, as kept and sent. With the sound, it is the whole record of
 * what was said and what was made of it.
 */
export interface VoiceDocument {
  format: typeof VOICE_DOCUMENT_FORMAT;
  recordingId: string;
  raceId: string;
  sampleRate: number;
  segmentSeconds: number;
  /** What did the recognising, and the delay assumed between a word being
   *  said and the recogniser's time for it. Null when nothing recognised
   *  the sound. */
  engine: { model: string; version: string; lagSeconds: number } | null;
  device: { userAgent: string; microphone: string | null };
  /** Seconds of the recogniser's work for each second of sound, where
   *  measured. Above about 0.7 the phone isn't keeping up. */
  realTimeFactor: number | null;
  takes: VoiceTake[];
  gaps: VoiceGap[];
  presses: VoicePress[];
  words: VoiceWord[];
  finishes: VoiceFinish[];
  dismissals: VoiceDismissal[];
}

/** The lag assumed when a document doesn't say. */
export const DEFAULT_LAG_SECONDS = 0.5;
