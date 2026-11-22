/**
 * A spell of recording on the phone, from Record to Stop: the microphone's
 * sound goes into the phone's storage and, where the recogniser is on the
 * phone, to it as well; its words and the presses of NOW are kept with the
 * recording. Nothing is decided here: the screen reads the timeline from
 * what is kept. No screen here either: the recording screen subscribes.
 *
 * The recording's clock is the phone's clock. A take is an unbroken run of
 * sound; when the microphone goes quiet for a while (a phone call, another
 * app, the screen switched off) the take ends, the gap is noted, and a new
 * take starts when sound comes back.
 */

import { toFloat, toPcm16 } from '../audio';
import type { CallEntry } from '../calls';
import { createLiveReader, type LiveReader } from '../live';
import { readTimeline, type TimelineCall } from '../timeline';
import {
  DEFAULT_LAG_SECONDS,
  SAMPLE_RATE,
  SEGMENT_SAMPLES,
  type VoiceDismissal,
  type VoiceFinish,
  type VoiceGap,
  type VoiceTake,
  type VoiceWord,
} from '../types';
import type { Listener } from './engine';
import { readTake, saveRecording, saveSegment, type LocalRecording } from './local-store';
import type { Microphone } from './microphone';

/** Sound missing for longer than this ends the take. */
const GAP_SECONDS = 1.5;
/** How often what has been recorded so far is put in the phone's storage. */
const CHECKPOINT_MS = 2000;

export interface RecorderOptions {
  recording: LocalRecording;
  /** The competitors in the race. `id` is the competitor's. */
  entries: readonly CallEntry[];
  microphone: Microphone;
  /** The recogniser, where it is on the phone. Without one the sound and
   *  the presses of NOW are recorded, and the words can be found later. */
  listener: Listener | null;
  engine: { model: string; version: string } | null;
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
  /** Whether the recogniser is listening as well. */
  recognising(): boolean;
  /** Words the recogniser is still working on. */
  open(): VoiceWord[];
  /** The latest stretch nothing was recorded, until it is dismissed. */
  gap(): VoiceGap | null;
  dismissGap(): void;
  /** NOW: a line on the timeline at this instant. */
  pressNow(): void;
  /** What a person has decided while it records, kept with the recording. */
  setDecisions(finishes: VoiceFinish[], dismissals: VoiceDismissal[]): void;
  /** Stop recording. Resolves with the finished recording, stored. */
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
  const { entries, microphone, listener, onChange, onLevel } = options;
  const lagSeconds = listener?.lagSeconds ?? options.recording.engine?.lagSeconds ?? DEFAULT_LAG_SECONDS;
  let recording: LocalRecording = {
    ...options.recording,
    engine: options.engine ? { ...options.engine, lagSeconds } : options.recording.engine,
    device: { userAgent: navigator.userAgent, microphone: microphone.label || null },
  };
  const reader: LiveReader | null = listener
    ? createLiveReader({ entries, lagSeconds, words: recording.words, onCue: (cue) => microphone.cue(cue) })
    : null;

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
    if (reader) recording = { ...recording, words: reader.words() };
    const snapshot = recording;
    write(() => saveRecording(snapshot));
  }

  function endTake() {
    if (!take) return;
    reader?.endTake();
    flushPiece();
    take = null;
  }

  function beginTake(startedAt: number) {
    take = { index: recording.takes.length, startedAt, samples: 0 };
    piece = [];
    pieceSamples = 0;
    pieceIndex = 0;
    pieceDirty = false;
    listener?.begin();
    reader?.beginTake(startedAt);
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
        onChange();
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
    listener?.feed(samples);
  };

  microphone.onRunning = (running) => {
    hearing = running;
    onChange();
  };

  if (listener && reader) {
    listener.onWords = (batch) => {
      // Words that arrive before a take has begun, or after the last one
      // ended, belong to no take: the engine finishing something earlier.
      if (!take) return;
      recording = { ...recording, cost: recording.cost + batch.cost, span: recording.span + batch.span };
      const before = reader.words().length;
      const openBefore = reader.open().map((w) => w.w).join(' ');
      reader.heard(batch);
      if (reader.words().length !== before) recording = { ...recording, words: reader.words() };
      if (reader.words().length !== before || reader.open().map((w) => w.w).join(' ') !== openBefore) onChange();
    };
  }

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
    recognising: () => listener !== null,
    open: () => reader?.open() ?? [],
    gap: () => latestGap,
    dismissGap() {
      latestGap = null;
      onChange();
    },
    pressNow() {
      if (stopped) return;
      recording = { ...recording, presses: [...recording.presses, { id: crypto.randomUUID(), at: Date.now() }] };
      microphone.cue('mark');
      onChange();
    },
    setDecisions(finishes, dismissals) {
      recording = { ...recording, finishes, dismissals };
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
      if (listener) await new Promise((resolve) => setTimeout(resolve, 400));
      // Stopped while the microphone was away: that stretch is a gap too.
      if (take) {
        const heardUntil = take.startedAt + (take.samples / SAMPLE_RATE) * 1000;
        const now = Date.now();
        if (now - heardUntil > (GAP_SECONDS + 0.4) * 1000) {
          recording = { ...recording, gaps: [...recording.gaps, { from: Math.round(heardUntil), to: now }] };
        }
      }
      endTake();
      if (listener) listener.onWords = null;
      if (reader) recording = { ...recording, words: reader.words() };
      const finished = recording;
      write(() => saveRecording(finished));
      await writes;
      return finished;
    },
  };
}

/**
 * Find the words in a recording made without the recogniser, or again with
 * a newer one: its sound, take by take, through the recogniser as fast as it
 * will go. Resolves with the recording, its words replaced.
 */
export async function recogniseRecording(
  recording: LocalRecording,
  listener: Listener,
  engine: { model: string; version: string },
  onProgress: (done: number, total: number) => void = () => {},
): Promise<LocalRecording> {
  const lagSeconds = listener.lagSeconds ?? DEFAULT_LAG_SECONDS;
  const reader = createLiveReader({ entries: [], lagSeconds });
  let cost = 0;
  let span = 0;
  const total = recording.takes.reduce((n, t) => n + t.samples, 0);
  let done = 0;
  // The recogniser answers every piece of sound with one batch of words.
  let waiting: (() => void) | null = null;
  listener.onWords = (batch) => {
    cost += batch.cost;
    span += batch.span;
    reader.heard(batch);
    const w = waiting;
    waiting = null;
    w?.();
  };
  try {
    for (const take of [...recording.takes].sort((a, b) => a.index - b.index)) {
      listener.begin();
      reader.beginTake(take.startedAt);
      const pieces = await readTake(recording.id, take.index);
      for (const pcm of pieces) {
        // A tenth of a second at a time, as the microphone would.
        for (let at = 0; at < pcm.length; at += SAMPLE_RATE / 10) {
          const samples = toFloat(pcm.subarray(at, at + SAMPLE_RATE / 10));
          const answered = new Promise<void>((resolve) => { waiting = resolve; });
          listener.feed(samples);
          await answered;
          done += samples.length;
          if (at % SAMPLE_RATE === 0) onProgress(done, total);
        }
      }
      reader.endTake();
    }
  } finally {
    listener.onWords = null;
  }
  onProgress(total, total);
  const next: LocalRecording = { ...recording, words: reader.words(), engine: { ...engine, lagSeconds }, cost, span };
  await saveRecording(next);
  return next;
}

export interface Trial {
  stop(): void;
}

/**
 * The setup dialog's trial call: listen with the microphone already open,
 * keep nothing, and say what was heard and which competitor that is.
 */
export function startTrial(options: {
  entries: readonly CallEntry[];
  microphone: Microphone;
  listener: Listener;
  onHeard: (heard: { words: string; call: TimelineCall | null }) => void;
  onLevel?: (level: number) => void;
}): Trial {
  const { entries, microphone, listener, onHeard, onLevel } = options;
  const lagSeconds = listener.lagSeconds ?? DEFAULT_LAG_SECONDS;
  const reader = createLiveReader({
    entries,
    lagSeconds,
    onCue: (cue) => {
      microphone.cue(cue);
      if (cue === 'mark') return;
      const tl = readTimeline({ words: reader.words().concat(reader.open()), presses: [], gaps: [] }, entries, { lagSeconds });
      const call = tl.calls[tl.calls.length - 1] ?? null;
      const snippet = tl.snippets[tl.snippets.length - 1];
      onHeard({ words: call?.heard ?? snippet?.words.join(' ') ?? '', call });
    },
  });
  let began = false;
  const onAudio: Microphone['onAudio'] = (samples, wall, loudness) => {
    onLevel?.(loudness);
    if (!began) {
      began = true;
      listener.begin();
      reader.beginTake(wall);
    }
    listener.feed(samples);
  };
  const onWords: Listener['onWords'] = (batch) => reader.heard(batch);
  microphone.onAudio = onAudio;
  listener.onWords = onWords;
  return {
    stop() {
      // Only what is still the trial's: Record may have taken both over.
      if (microphone.onAudio === onAudio) microphone.onAudio = null;
      if (listener.onWords === onWords) listener.onWords = null;
    },
  };
}
