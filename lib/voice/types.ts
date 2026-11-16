/**
 * Recording finishes by voice (ADR-017): the shapes shared by the phone, the
 * server and the scorer's review. Everything here is plain data, so the same
 * document is what the phone keeps, what it saves as a file, and what it
 * sends with the sheet.
 *
 * Every time is the phone's clock, in milliseconds since the epoch. A
 * recording is one or more *takes*: unbroken runs of sound. Listening that
 * is interrupted (a phone call, the screen switched off) ends a take, and
 * the next one starts when the microphone comes back.
 */

/** The sound is kept at the rate the recogniser hears it. */
export const SAMPLE_RATE = 16000;
/** A take's sound is stored and sent in pieces this long. */
export const SEGMENT_SECONDS = 5;
export const SEGMENT_SAMPLES = SAMPLE_RATE * SEGMENT_SECONDS;

/** How long the phone keeps a recording, and how long the server does. */
export const PHONE_KEEPS_DAYS = 7;
export const SERVER_KEEPS_DAYS = 30;

export const VOICE_DOCUMENT_FORMAT = 1;

/** How a line's boat was arrived at. `tap` is a press of Now nobody has
 *  named a boat for yet. */
export type VoiceHow = 'whole' | 'ending' | 'sounds' | 'ambiguous' | 'unknown' | 'tap';

/** Where a line's time came from: a press of Now, the word called after
 *  the number, or failing both the moment the number was called. */
export type VoiceTimeFrom = 'tap' | 'word' | 'called';

/**
 * One line taken by voice. Its `id` is the id of the row it made on the
 * finish sheet, which is how the sheet, the settling panel and the scorer's
 * review all find the call a row came from.
 */
export interface VoiceLine {
  id: string;
  how: VoiceHow;
  /** The boat the call was read as, where it was read as one. */
  competitorId: string | null;
  /** The boats it could be, for a call that fits more than one. */
  couldBe: string[];
  /** The digits heard, where the words made a number. */
  digits: string;
  /** The words of the call, as the recogniser gave them. */
  words: string[];
  /** When the number was called: where playing the call back starts. Null
   *  for a press of Now with no call. */
  heardAt: number | null;
  heardUntil: number | null;
  /** When she crossed, by `timeFrom`. */
  at: number;
  timeFrom: VoiceTimeFrom;
  /** When she was called again after her line was taken. */
  calledAgainAt: number[];
  /** A person has confirmed the boat, or the time. */
  boatSettled: boolean;
  timeSettled: boolean;
  /** Taken back with Undo. Kept, because the recording still has the call. */
  removed: boolean;
}

export interface VoiceTake {
  index: number;
  /** When its first sample was heard. */
  startedAt: number;
  /** Samples of sound in it. */
  samples: number;
}

/** A stretch in which the phone wasn't listening, though it was meant to be. */
export interface VoiceGap {
  from: number;
  to: number;
}

/** A word the recogniser heard, for the bench: `at` is when it was said. */
export interface VoiceWord {
  w: string;
  at: number;
}

/**
 * A recording's list of calls. With the sound, it is the whole record of
 * what was said and what the app made of it.
 */
export interface VoiceDocument {
  format: typeof VOICE_DOCUMENT_FORMAT;
  recordingId: string;
  raceId: string;
  sampleRate: number;
  segmentSeconds: number;
  /** What did the listening: the model, and the delay assumed between a
   *  word being said and the recogniser's time for it. */
  engine: { model: string; version: string; lagSeconds: number } | null;
  device: { userAgent: string; microphone: string | null };
  /** Seconds of the recogniser's work for each second of sound, where
   *  measured. Above about 0.7 the phone isn't keeping up. */
  realTimeFactor: number | null;
  takes: VoiceTake[];
  gaps: VoiceGap[];
  lines: VoiceLine[];
  words: VoiceWord[];
}

/** What a line still needs a person to look at. */
export type VoiceMark =
  /** Read by sound: is this the boat? */
  | 'check'
  /** Fits more than one boat. */
  | 'choose'
  /** A number on no entry. */
  | 'unknown'
  /** Now was pressed, and no boat was called. */
  | 'no-boat'
  /** No "now" was heard: the time is when she was called. */
  | 'time';
