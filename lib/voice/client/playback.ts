/**
 * Hearing a call again, and saving a recording as files. Browser only.
 */

import { clipOf, clipWindow, fileOffset, wavFile } from '../audio';
import { SAMPLE_RATE, SEGMENT_SAMPLES, type VoiceDocument, type VoiceLine } from '../types';

let player: AudioContext | null = null;

/** Play a stretch of sound, stopping whatever was playing. */
export function playSamples(samples: Float32Array): void {
  void player?.close().catch(() => undefined);
  player = new AudioContext();
  const buffer = player.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
  const source = player.createBufferSource();
  source.buffer = buffer;
  source.connect(player.destination);
  source.start();
}

/** One piece of a take's sound, from wherever the recording is kept. */
export type ReadPiece = (take: number, index: number) => Promise<Int16Array | undefined>;

/**
 * Play the call a line came from: the few seconds of the recording around
 * it. Answers false where the recording has no sound for that moment.
 */
export async function playLine(document: Pick<VoiceDocument, 'takes'>, line: VoiceLine, read: ReadPiece): Promise<boolean> {
  const { from, to } = clipWindow(line);
  const clip = await clipOf(document.takes, from, to, read);
  if (!clip || clip.length === 0) return false;
  playSamples(clip);
  return true;
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
 * is missing left silent so the takes stay in step with the list of calls.
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
 * The list of calls as a file to keep beside the WAV: the document, with
 * each take and each line given its place in the file in seconds.
 */
export function callsFile(doc: VoiceDocument, names: (competitorId: string) => string | undefined): Blob {
  const takes = [...doc.takes].sort((a, b) => a.index - b.index);
  let before = 0;
  const placed = takes.map((take) => {
    const fileSeconds = before;
    before += take.samples / SAMPLE_RATE;
    return { ...take, startedAtTime: new Date(take.startedAt).toISOString(), fileSeconds };
  });
  const out = {
    what: 'Sail Scoring: finishes recorded by voice, the list of calls',
    ...doc,
    takes: placed,
    lines: doc.lines.map((line) => ({
      ...line,
      boat: line.competitorId ? (names(line.competitorId) ?? null) : null,
      time: new Date(line.at).toISOString(),
      fileSeconds: line.heardAt != null ? fileOffset(takes, line.heardAt) : fileOffset(takes, line.at),
    })),
  };
  return new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
}
