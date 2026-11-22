/**
 * What recording does with the recogniser's words as they arrive, as pure
 * logic: they are put on the phone's clock, and each sail number is
 * answered with a sound as soon as the recogniser has finished with it.
 * Nothing here decides a finish: the timeline is read again from all the
 * words whenever the screen redraws (`timeline.ts`).
 */

import { cleanWord, prepare, utterances, type CallEntry, type HeardWord, type Utterance } from './calls';
import { ANY_WORD_WITHIN, callsIn, isNowWord, isNumberish, SNIPPET_GAP_SECONDS } from './timeline';
import { DEFAULT_LAG_SECONDS, type VoiceWord } from './types';

/** How long after a snippet ends it is read, beyond the pause that ends it,
 *  in case a word is still coming. */
const SETTLE_SECONDS = 0.35;

/** The sound that says what was heard, for a caller who isn't looking. */
export type Cue =
  /** A sail number was recognised: one tone. */
  | 'ok'
  /** Recognised from a close match: a tone, then a low one. */
  | 'check'
  /** A sail number not on the entry list, or one that fits several: two low tones. */
  | 'doubt'
  /** A time was marked: a click. */
  | 'mark';

/** What the recogniser hands over: its words so far for the stretch it is
 *  working on, with times in seconds since the take began. */
export interface HeardBatch {
  words: readonly HeardWord[];
  /** The recogniser has finished with these words: the next batch starts a
   *  new list. */
  closed: boolean;
  /** Seconds of the take it has heard. */
  heard: number;
}

export interface LiveReader {
  /** A take begins: the microphone is on from `startedAt`. */
  beginTake(startedAt: number): void;
  heard(batch: HeardBatch): void;
  /** The take is over: whatever is still being heard is kept as it is. */
  endTake(): void;
  /** Every word the recogniser has finished with, on the phone's clock. */
  words(): VoiceWord[];
  /** The words it is still working on, which may yet change. */
  open(): VoiceWord[];
}

export function createLiveReader(options: {
  entries: readonly CallEntry[];
  lagSeconds?: number;
  /** Words kept from an earlier spell of recording. */
  words?: readonly VoiceWord[];
  onCue?: (cue: Cue) => void;
}): LiveReader {
  const { onCue = () => {} } = options;
  const lagSeconds = options.lagSeconds ?? DEFAULT_LAG_SECONDS;
  const list = prepare(options.entries);
  const kept: VoiceWord[] = [...(options.words ?? [])];
  const called = new Set<string>();

  let takeStartedAt = 0;
  let closed: HeardWord[] = [];
  let open: HeardWord[] = [];
  let consumedUntil = -1;
  let seenUntil = -1;
  let heardSeconds = 0;
  // How long after a word is said the recogniser hands it over. It differs
  // by model and by phone, so it is measured as the words come.
  let delay = 0.3;
  // When the last sail number recognised ended, on this take's clock.
  let lastCallEnd: number | null = null;
  let marked = false;

  const clock = (seconds: number) => Math.round(takeStartedAt + seconds * 1000);

  function answer(u: Utterance) {
    const ws = u.words.map((w) => cleanWord(w.w));
    const found = callsIn(ws, list, (id) => called.has(id));
    if (found.length > 0) {
      const hows = found.map((f) => f.match.how);
      onCue(hows.some((h) => h === 'whole' || h === 'ending') ? 'ok' : hows.includes('sounds') ? 'check' : 'doubt');
      for (const f of found) if ('entry' in f.match) called.add(f.match.entry.id);
      lastCallEnd = u.tEnd - lagSeconds;
      marked = false;
      return;
    }
    const w = ws[0];
    if (ws.length === 1 && lastCallEnd !== null && !isNumberish(w)) {
      const soon = (u.t - lagSeconds - lastCallEnd) * 1000 <= ANY_WORD_WITHIN;
      if ((soon && !marked) || isNowWord(w)) {
        onCue('mark');
        marked = true;
      }
    }
  }

  /** Answer every snippet that has finished; at the end of a take, the
   *  unfinished too. */
  function read(all: boolean) {
    const pending = closed.concat(open).filter((w) => w.t > consumedUntil);
    for (const u of utterances(pending, { maxGap: SNIPPET_GAP_SECONDS })) {
      if (!all && heardSeconds - u.tEnd < SNIPPET_GAP_SECONDS + SETTLE_SECONDS + delay) break;
      answer(u);
      consumedUntil = u.tEnd;
    }
    closed = closed.filter((w) => w.t > consumedUntil);
  }

  return {
    beginTake(startedAt) {
      takeStartedAt = startedAt;
      closed = [];
      open = [];
      consumedUntil = -1;
      seenUntil = -1;
      heardSeconds = 0;
      lastCallEnd = null;
    },

    heard(batch) {
      heardSeconds = batch.heard;
      for (const w of batch.words) {
        if (w.t <= seenUntil) continue;
        seenUntil = w.t;
        delay = Math.min(3, Math.max(delay, batch.heard - w.t));
      }
      if (batch.closed) {
        closed.push(...batch.words);
        for (const w of batch.words) kept.push({ w: w.w, at: clock(w.t) });
        open = [];
      } else {
        open = [...batch.words];
      }
      read(false);
    },

    endTake() {
      for (const w of open) kept.push({ w: w.w, at: clock(w.t) });
      read(true);
      closed = [];
      open = [];
    },

    words: () => kept.slice(),
    open: () => open.map((w) => ({ w: w.w, at: clock(w.t) })),
  };
}
