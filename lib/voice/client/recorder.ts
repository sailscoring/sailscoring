/**
 * A spell of listening on the phone, from Listen to Stop: the microphone's
 * sound goes to the recogniser and into the phone's storage, the
 * recogniser's words go to the session, and what the session makes of them
 * comes out as events for the sheet. No screen here: the listening screen
 * subscribes to this.
 *
 * The recording's clock is the phone's clock. A take is an unbroken run of
 * sound; when the microphone goes quiet for a while (a phone call, another
 * app, the screen switched off) the take ends, the gap is noted, and a new
 * take starts when sound comes back.
 */

import { toPcm16 } from '../audio';
import type { CallEntry } from '../calls';
import { createSession, LAG_SECONDS, type Cue, type SessionEvent, type VoiceSession } from '../session';
import { SAMPLE_RATE, SEGMENT_SAMPLES, type VoiceGap, type VoiceLine, type VoiceTake } from '../types';
import type { Listener } from './engine';
import { saveRecording, saveSegment, type LocalRecording } from './local-store';
import type { Microphone } from './microphone';

/** Sound missing for longer than this ends the take. */
const GAP_SECONDS = 1.5;
/** How often what has been heard so far is put in the phone's storage. */
const CHECKPOINT_MS = 2000;

export interface RecorderOptions {
  recording: LocalRecording;
  /** The boats in the race. `id` is the competitor's. */
  entries: readonly CallEntry[];
  /** Whether a boat already has a place on the sheet. */
  onSheet: (competitorId: string) => boolean;
  microphone: Microphone;
  listener: Listener;
  engine: { model: string; version: string };
  /** A line was added, changed or taken back: the sheet follows. */
  onEvent: (event: SessionEvent) => void;
  /** Something the screen shows has changed. */
  onChange: () => void;
  /** How loud the microphone is, 0 to 1, as it arrives. */
  onLevel?: (level: number) => void;
}

export interface Recorder {
  /** The recording as it stands. A new object whenever it changes. */
  recording(): LocalRecording;
  /** Whether sound is arriving. */
  hearing(): boolean;
  /** The last few words heard. */
  tail(): string;
  /** The latest stretch the phone wasn't listening, until it is dismissed. */
  gap(): VoiceGap | null;
  dismissGap(): void;
  pressNow(): void;
  undo(): VoiceLine | null;
  /** Stop listening. Resolves with the finished recording, stored. */
  stop(): Promise<LocalRecording>;
}

function join(parts: Int16Array[], length: number): Int16Array {
  const out = new Int16Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function startRecorder(options: RecorderOptions): Recorder {
  const { entries, onSheet, microphone, listener, onEvent, onChange, onLevel } = options;
  let recording: LocalRecording = {
    ...options.recording,
    engine: { ...options.engine, lagSeconds: listener.lagSeconds ?? LAG_SECONDS },
    device: { userAgent: navigator.userAgent, microphone: microphone.label || null },
  };
  const earlierWords = recording.words;

  const session: VoiceSession = createSession({
    entries,
    lines: recording.lines,
    lagSeconds: listener.lagSeconds,
    onSheet,
    newId: () => crypto.randomUUID(),
    onEvent: (event) => {
      recording = { ...recording, lines: session.lines() };
      onEvent(event);
      onChange();
    },
    onCue: (cue: Cue) => microphone.cue(cue),
  });

  let take: VoiceTake | null = null;
  let piece: Int16Array[] = [];
  let pieceSamples = 0;
  let pieceIndex = 0;
  let pieceDirty = false;
  let latestGap: VoiceGap | null = null;
  let hearing = microphone.running();
  let stopped = false;
  // Writes to the phone's storage, one after another: a piece's last partial
  // write must never land after its whole one.
  let writes: Promise<unknown> = Promise.resolve();
  const write = (job: () => Promise<void>) => {
    writes = writes.then(job).catch(() => undefined);
  };

  const withTake = (t: VoiceTake) => {
    recording = { ...recording, takes: [...recording.takes.filter((x) => x.index !== t.index), { ...t }] };
  };

  function flushPiece() {
    if (!take || !pieceDirty || pieceSamples === 0) return;
    const pcm = join(piece, pieceSamples);
    const [id, takeIndex, index] = [recording.id, take.index, pieceIndex];
    write(() => saveSegment(id, takeIndex, index, pcm));
    pieceDirty = false;
  }

  function checkpoint() {
    flushPiece();
    recording = { ...recording, words: [...earlierWords, ...session.words()] };
    const snapshot = recording;
    write(() => saveRecording(snapshot));
  }

  function endTake() {
    if (!take) return;
    session.endTake();
    flushPiece();
    take = null;
  }

  function beginTake(startedAt: number) {
    take = { index: recording.takes.length, startedAt, samples: 0 };
    piece = [];
    pieceSamples = 0;
    pieceIndex = 0;
    pieceDirty = false;
    listener.begin();
    session.beginTake(startedAt);
    withTake(take);
  }

  microphone.onAudio = (samples, wall, loudness) => {
    if (stopped) return;
    onLevel?.(loudness);
    const seconds = samples.length / SAMPLE_RATE;
    if (take) {
      const missing = (wall - take.startedAt) / 1000 - (take.samples / SAMPLE_RATE + seconds);
      if (missing > GAP_SECONDS) {
        const from = take.startedAt + (take.samples / SAMPLE_RATE) * 1000;
        endTake();
        latestGap = { from: Math.round(from), to: Math.round(wall - seconds * 1000) };
        recording = { ...recording, gaps: [...recording.gaps, latestGap] };
      }
    }
    if (!take) beginTake(Math.round(wall - seconds * 1000));
    const current = take!;

    let pcm = toPcm16(samples);
    current.samples += pcm.length;
    while (pieceSamples + pcm.length >= SEGMENT_SAMPLES) {
      const room = SEGMENT_SAMPLES - pieceSamples;
      piece.push(pcm.subarray(0, room));
      const whole = join(piece, SEGMENT_SAMPLES);
      const [id, takeIndex, index] = [recording.id, current.index, pieceIndex];
      write(() => saveSegment(id, takeIndex, index, whole));
      pcm = pcm.subarray(room);
      piece = [];
      pieceSamples = 0;
      pieceIndex += 1;
      pieceDirty = false;
    }
    if (pcm.length) {
      piece.push(pcm);
      pieceSamples += pcm.length;
      pieceDirty = true;
    }
    withTake(current);
    listener.feed(samples);
  };

  microphone.onRunning = (running) => {
    hearing = running;
    onChange();
  };

  listener.onWords = (batch) => {
    // Words that arrive before a take has begun, or after the last one
    // ended, belong to no take: the engine finishing something earlier.
    if (!take) return;
    recording = { ...recording, cost: recording.cost + batch.cost, span: recording.span + batch.span };
    const before = session.tail();
    session.heard(batch);
    if (session.tail() !== before) onChange();
  };

  // Keep the screen on, and pick up again when the page comes back in front.
  let wakeLock: WakeLockSentinel | null = null;
  const keepAwake = async () => {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      wakeLock = null;
    }
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    void keepAwake();
    void microphone.resume();
  };
  document.addEventListener('visibilitychange', onVisible);
  void keepAwake();
  const timer = setInterval(checkpoint, CHECKPOINT_MS);

  return {
    recording: () => recording,
    hearing: () => hearing,
    tail: () => session.tail(),
    gap: () => latestGap,
    dismissGap() {
      latestGap = null;
      onChange();
    },
    pressNow() {
      if (!stopped) session.pressNow(Date.now());
    },
    undo() {
      return stopped ? null : session.undo();
    },
    async stop() {
      if (stopped) return recording;
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      microphone.onAudio = null;
      microphone.onRunning = null;
      microphone.close();
      void wakeLock?.release().catch(() => undefined);
      // The recogniser is a moment behind the microphone: let its last words in.
      await new Promise((resolve) => setTimeout(resolve, 400));
      // Stopped while the microphone was away: that stretch is a gap too.
      if (take) {
        const heardUntil = take.startedAt + (take.samples / SAMPLE_RATE) * 1000;
        const now = Date.now();
        if (now - heardUntil > (GAP_SECONDS + 0.4) * 1000) {
          recording = { ...recording, gaps: [...recording.gaps, { from: Math.round(heardUntil), to: now }] };
        }
      }
      endTake();
      listener.onWords = null;
      recording = { ...recording, lines: session.lines(), words: [...earlierWords, ...session.words()] };
      const finished = recording;
      write(() => saveRecording(finished));
      await writes;
      return finished;
    },
  };
}

export interface Trial {
  stop(): void;
}

/**
 * The setup dialog's trial call: listen with the microphone already open,
 * keep nothing, and say what was heard and which boat that is.
 */
export function startTrial(options: {
  entries: readonly CallEntry[];
  microphone: Microphone;
  listener: Listener;
  onHeard: (heard: { words: string; line: VoiceLine | null }) => void;
  onLevel?: (level: number) => void;
}): Trial {
  const { microphone, listener, onHeard, onLevel } = options;
  let last: VoiceLine | null = null;
  const session = createSession({
    entries: options.entries,
    lagSeconds: listener.lagSeconds,
    newId: () => crypto.randomUUID(),
    onEvent: (event) => {
      if (event.type === 'added') {
        last = event.line;
        onHeard({ words: event.line.words.join(' '), line: event.line });
      } else if (event.type === 'again') {
        // Called twice while trying it out: she is still that boat.
        onHeard({ words: event.line?.words.join(' ') ?? '', line: event.line ?? last });
      }
    },
    onCue: (cue) => microphone.cue(cue),
  });
  let began = false;
  const onAudio: Microphone['onAudio'] = (samples, wall, loudness) => {
    onLevel?.(loudness);
    if (!began) {
      began = true;
      listener.begin();
      session.beginTake(wall);
    }
    listener.feed(samples);
  };
  const onWords: Listener['onWords'] = (batch) => session.heard(batch);
  microphone.onAudio = onAudio;
  listener.onWords = onWords;
  return {
    stop() {
      // Only what is still the trial's: Listen may have taken both over.
      if (microphone.onAudio === onAudio) microphone.onAudio = null;
      if (listener.onWords === onWords) listener.onWords = null;
    },
  };
}
