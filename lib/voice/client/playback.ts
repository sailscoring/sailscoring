/**
 * Hearing a recording again, and saving it as files. Browser only.
 */

import { clipOf, fileOffset, wavFile } from '../audio';
import { SAMPLE_RATE, SEGMENT_SAMPLES, type VoiceDocument } from '../types';

let player: AudioContext | null = null;

/** Sound playing from the recording: where it started, and how to stop it. */
export interface Playing {
  /** The recording's time at the first sample played. */
  from: number;
  /** Seconds of sound. */
  seconds: number;
  /** Seconds played so far. */
  elapsed(): number;
  stop(): void;
  /** Resolves when it ends, played through or stopped. */
  ended: Promise<void>;
}

/** Play a stretch of sound, stopping whatever was playing. */
export function playSamples(samples: Float32Array, from = 0): Playing {
  void player?.close().catch(() => undefined);
  const ctx = new AudioContext();
  player = ctx;
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const began = ctx.currentTime;
  const ended = new Promise<void>((resolve) => {
    source.onended = () => resolve();
  });
  source.start();
  return {
    from,
    seconds: samples.length / SAMPLE_RATE,
    elapsed: () => Math.max(0, ctx.currentTime - began),
    stop() {
      try {
        source.stop();
      } catch {
        // Already ended.
      }
    },
    ended,
  };
}

/** One piece of a take's sound, from wherever the recording is kept. */
export type ReadPiece = (take: number, index: number) => Promise<Int16Array | undefined>;

/**
 * Play the recording from `from` to `to` (the phone's clock). Null where
 * the recording has no sound for that stretch.
 */
export async function playSpan(document: Pick<VoiceDocument, 'takes'>, from: number, to: number, read: ReadPiece): Promise<Playing | null> {
  const clip = await clipOf(document.takes, from, to, read);
  if (!clip || clip.length === 0) return null;
  const take = document.takes.find((t) => to >= t.startedAt && from <= t.startedAt + (t.samples / SAMPLE_RATE) * 1000);
  return playSamples(clip, Math.max(from, take?.startedAt ?? from));
}

export function saveFile(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** A name for a recording's files, from when it began. */
export function fileStem(doc: Pick<VoiceDocument, 'takes'>): string {
  const started = doc.takes[0]?.startedAt ?? Date.now();
  const d = new Date(started);
  const two = (n: number) => String(n).padStart(2, '0');
  return `finishes-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`;
}

/**
 * The whole recording as one WAV file, take after take, with a piece that
 * is missing left silent so the takes stay in step with the timeline.
 */
export async function recordingWav(doc: Pick<VoiceDocument, 'takes'>, read: ReadPiece): Promise<Blob> {
  const pieces: Int16Array[] = [];
  for (const take of [...doc.takes].sort((a, b) => a.index - b.index)) {
    const count = Math.ceil(take.samples / SEGMENT_SAMPLES);
    for (let index = 0; index < count; index++) {
      const want = Math.min(SEGMENT_SAMPLES, take.samples - index * SEGMENT_SAMPLES);
      const pcm = await read(take.index, index);
      if (pcm && pcm.length === want) pieces.push(pcm);
      else {
        const filled = new Int16Array(want);
        if (pcm) filled.set(pcm.subarray(0, want));
        pieces.push(filled);
      }
    }
  }
  return wavFile(pieces);
}

/**
 * The timeline as a file to keep beside the WAV: the document, with each
 * take, press, word and finish given its place in the file in seconds.
 */
export function timelineFile(doc: VoiceDocument, names: (competitorId: string) => string | undefined): Blob {
  const takes = [...doc.takes].sort((a, b) => a.index - b.index);
  let before = 0;
  const placed = takes.map((take) => {
    const fileSeconds = before;
    before += take.samples / SAMPLE_RATE;
    return { ...take, startedAtTime: new Date(take.startedAt).toISOString(), fileSeconds };
  });
  const lag = (doc.engine?.lagSeconds ?? 0) * 1000;
  const out = {
    what: 'Sail Scoring: finishes recorded by voice, the timeline',
    ...doc,
    takes: placed,
    presses: doc.presses.map((p) => ({ ...p, time: new Date(p.at).toISOString(), fileSeconds: fileOffset(takes, p.at) })),
    words: doc.words.map((w) => ({ ...w, fileSeconds: fileOffset(takes, w.at - lag) })),
    finishes: doc.finishes.map((f) => ({
      ...f,
      competitor: f.competitorId ? (names(f.competitorId) ?? null) : null,
      time: new Date(f.at).toISOString(),
      fileSeconds: fileOffset(takes, f.at),
    })),
  };
  return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
}
