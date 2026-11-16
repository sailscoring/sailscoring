/**
 * A spell of listening, from Listen to Stop, as pure logic: the recogniser's
 * words and the presses of Now go in, lines of the finish sheet come out.
 * No microphone, no screen, no storage: those hand it words and are told
 * what changed.
 *
 * The rules are ADR-017's. A line's boat comes from reading the words
 * against the entry list (`calls.ts`). Its time is, in order: a press of
 * Now; the single word called after the number; or the moment the number
 * was called. The number never moves the time and the time never moves the
 * number.
 */

import { prepare, reader, utterances, type Call, type CallEntry, type HeardWord, type Utterance } from './calls';
import type { VoiceLine, VoiceWord } from './types';

/** A pause this long ends an utterance. */
export const MAX_GAP = 1.0;
/** And this much longer before it is read, in case a word is still coming. */
const SETTLE = 0.35;
/** The recogniser writes a word about this long after it was said. */
export const LAG_SECONDS = 0.5;
/** The word after a number counts as its time for this long. */
const MARK_WITHIN = 6;
/** A press of Now counts for a call that began up to this long after it:
 *  press as she crosses, then say who she was. */
const PRESS_BEFORE = 10;
/** A press of Now replaces the time a called word gave only when the two
 *  agree to within this; otherwise it is another boat crossing. */
const PRESS_AGREES = 1.5;

/** The sound that says what happened, for a caller who isn't looking. */
export type Cue =
  /** She's down. */
  | 'ok'
  /** She's down, read by sound: one tone then a low one. */
  | 'check'
  /** Look when you can: two low tones. */
  | 'doubt'
  /** A time was fixed. */
  | 'mark';

export type SessionEvent =
  | { type: 'added'; line: VoiceLine }
  /** A line's time was fixed, or a waiting press was given its boat. */
  | { type: 'changed'; line: VoiceLine }
  | { type: 'removed'; line: VoiceLine }
  /** A boat that already has a line was called again. `line` is hers where
   *  she was taken by voice; a boat typed in by hand has none. */
  | { type: 'again'; competitorId: string; line: VoiceLine | null };

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

export interface SessionOptions {
  /** The boats in the race. `id` is the competitor's. */
  entries: readonly CallEntry[];
  /** The recording's lines so far, from earlier spells of listening. */
  lines?: readonly VoiceLine[];
  /** Whether a boat already has a place on the sheet, however it got there. */
  onSheet?: (competitorId: string) => boolean;
  newId: () => string;
  onEvent: (event: SessionEvent) => void;
  onCue?: (cue: Cue) => void;
}

export interface VoiceSession {
  /** Start a take: the microphone is on, from `startedAt`. */
  beginTake(startedAt: number): void;
  /** The recogniser's words for the current take. */
  heard(batch: HeardBatch): void;
  /** Now was pressed, at `at`. */
  pressNow(at: number): void;
  /** Take the last line back. Returns it, or null when there is none. */
  undo(): VoiceLine | null;
  /** Read whatever is still waiting: the take is over. */
  endTake(): void;
  /** Every line, the ones taken back included, in the order they were made. */
  lines(): VoiceLine[];
  /** Every word heard, on the phone's clock, as the recogniser timed it. */
  words(): VoiceWord[];
  /** The last few words heard, for the screen. */
  tail(): string;
}

export function createSession(options: SessionOptions): VoiceSession {
  const { entries, onSheet = () => false, newId, onEvent, onCue = () => {} } = options;
  const lines: VoiceLine[] = (options.lines ?? []).map((l) => ({ ...l }));
  const callOf = new Map<string, Call>();
  const lineOfCall = new Map<Call, VoiceLine>();
  const allWords: VoiceWord[] = [];

  const live = () => lines.filter((l) => !l.removed);
  const hasLine = (competitorId: string) => live().some((l) => l.competitorId === competitorId);
  const finished = (competitorId: string) => hasLine(competitorId) || onSheet(competitorId);
  const rd = reader(prepare(entries), { markWithin: MARK_WITHIN, finished });

  // The take being heard. Words carry seconds since it began; lines carry
  // the phone's clock.
  let takeStartedAt = 0;
  let closed: HeardWord[] = [];
  let open: HeardWord[] = [];
  let consumedUntil = -1;
  let seenUntil = -1;
  let heardSeconds = 0;
  // How long after a word is said the recogniser hands it over. It differs
  // by model, so it is measured as the words come.
  let delay = 0.3;

  const clock = (seconds: number) => Math.round(takeStartedAt + seconds * 1000);
  const emit = (type: 'added' | 'changed' | 'removed', line: VoiceLine) => onEvent({ type, line: { ...line } });

  function read(all: boolean) {
    const pending = closed.concat(open).filter((w) => w.t > consumedUntil);
    for (const u of utterances(pending, { maxGap: MAX_GAP })) {
      if (!all && heardSeconds - u.tEnd < MAX_GAP + SETTLE + delay) break;
      take(u);
      consumedUntil = u.tEnd;
    }
    closed = closed.filter((w) => w.t > consumedUntil);
  }

  function take(u: Utterance) {
    const x = rd.take(u);
    if (!x) return;
    if ('marked' in x) {
      const line = lineOfCall.get(x.marked);
      if (line && !line.removed && line.timeFrom === 'called') {
        line.at = clock(x.marked.markAt! - LAG_SECONDS);
        line.timeFrom = 'word';
        emit('changed', line);
        onCue('mark');
      }
      return;
    }
    const call = x.call;
    const heardAt = clock(call.t - LAG_SECONDS);
    const heardUntil = clock(call.tEnd - LAG_SECONDS);
    if (call.again && 'entry' in call) {
      const first = live().find((l) => l.competitorId === call.entry.id) ?? null;
      if (first) {
        first.calledAgainAt = [...first.calledAgainAt, heardUntil];
        emit('changed', first);
      }
      onEvent({ type: 'again', competitorId: call.entry.id, line: first ? { ...first } : null });
      onCue('doubt');
      return;
    }
    const read: Pick<VoiceLine, 'how' | 'competitorId' | 'couldBe' | 'digits' | 'words' | 'heardAt' | 'heardUntil'> = {
      how: call.how,
      competitorId: 'entry' in call ? call.entry.id : null,
      couldBe: call.how === 'ambiguous' ? call.entries.map((e) => e.id) : [],
      digits: call.digits,
      words: call.words,
      heardAt,
      heardUntil,
    };
    // A press of Now waiting for a boat: this is her. The oldest press goes
    // first, so three presses then three numbers come out in order.
    const press = live().find(
      (l) => l.how === 'tap' && l.at >= heardAt - PRESS_BEFORE * 1000 && l.at <= heardUntil + MARK_WITHIN * 1000,
    );
    let line: VoiceLine;
    if (press) {
      Object.assign(press, read);
      line = press;
      emit('changed', line);
    } else {
      line = {
        id: newId(),
        ...read,
        at: call.markAt != null ? clock(call.markAt - LAG_SECONDS) : heardUntil,
        timeFrom: call.markAt != null ? 'word' : 'called',
        calledAgainAt: [],
        boatSettled: false,
        timeSettled: false,
        removed: false,
      };
      lines.push(line);
      emit('added', line);
    }
    callOf.set(line.id, call);
    lineOfCall.set(call, line);
    onCue(call.how === 'whole' || call.how === 'ending' ? 'ok' : call.how === 'sounds' ? 'check' : 'doubt');
  }

  return {
    beginTake(startedAt) {
      read(true);
      takeStartedAt = startedAt;
      closed = [];
      open = [];
      consumedUntil = -1;
      seenUntil = -1;
      heardSeconds = 0;
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
        for (const w of batch.words) allWords.push({ w: w.w, at: clock(w.t) });
        open = [];
      } else {
        open = [...batch.words];
      }
      read(false);
    },

    pressNow(at) {
      // Whose crossing is this? The latest call's, if she was called just
      // now and has no press yet. A call that already has its "now" takes
      // the press only if the two agree. Otherwise the press is for a boat
      // not yet called: it never reaches back past the latest call to an
      // earlier one, which would move a boat the caller had finished with.
      const latest = live().reverse().find((l) => l.how !== 'tap');
      const line =
        latest && latest.timeFrom !== 'tap' && latest.heardAt != null && latest.heardUntil != null &&
        at - latest.heardUntil <= MARK_WITHIN * 1000 && at >= latest.heardAt - PRESS_BEFORE * 1000
          ? latest
          : undefined;
      if (line && (line.timeFrom === 'called' || Math.abs(at - line.at) <= PRESS_AGREES * 1000)) {
        line.at = at;
        line.timeFrom = 'tap';
        emit('changed', line);
      } else {
        const press: VoiceLine = {
          id: newId(),
          how: 'tap',
          competitorId: null,
          couldBe: [],
          digits: '',
          words: [],
          heardAt: null,
          heardUntil: null,
          at,
          timeFrom: 'tap',
          calledAgainAt: [],
          boatSettled: false,
          timeSettled: false,
          removed: false,
        };
        lines.push(press);
        emit('added', press);
      }
      onCue('mark');
    },

    undo() {
      const line = live().pop();
      if (!line) return null;
      line.removed = true;
      const call = callOf.get(line.id);
      if (call) rd.forget(call);
      emit('removed', line);
      return { ...line };
    },

    endTake() {
      for (const w of open) allWords.push({ w: w.w, at: clock(w.t) });
      read(true);
      closed = [];
      open = [];
    },

    lines: () => lines.map((l) => ({ ...l })),
    words: () => allWords.slice(),
    tail: () => allWords.slice(-8).map((w) => w.w).concat(open.map((w) => w.w)).slice(-8).join(' '),
  };
}
