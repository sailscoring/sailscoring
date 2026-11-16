/**
 * The sound of a recording, as arithmetic: resampling the microphone to the
 * rate the recogniser hears, the compact form a recording is sent in, and
 * the file a recording is saved as. Pure, and the same in a browser and in
 * Node.
 *
 * On the phone a take is kept as 16-bit samples. It is sent as G.711 µ-law,
 * one byte a sample: half the size, and speech survives it. Every browser
 * plays a µ-law WAV, but playback here decodes it itself.
 */

import { SAMPLE_RATE } from './types';

/**
 * Any rate down to 16 kHz: average over the step, then pick. Returns a
 * function to call with each block of samples as it arrives; what doesn't
 * fill a step yet is carried into the next call.
 */
export function resampler(from: number, to: number = SAMPLE_RATE): (block: Float32Array) => Float32Array {
  if (from === to) return (x) => x;
  const step = from / to;
  const width = Math.max(1, Math.round(step));
  let carry = new Float32Array(0);
  let pos = 0;
  return (x) => {
    const buf = new Float32Array(carry.length + x.length);
    buf.set(carry);
    buf.set(x, carry.length);
    const n = Math.max(0, Math.floor((buf.length - width - pos) / step));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const at = Math.floor(pos + i * step);
      let sum = 0;
      for (let k = 0; k < width; k++) sum += buf[at + k];
      out[i] = sum / width;
    }
    const used = Math.floor(pos + n * step);
    pos = pos + n * step - used;
    carry = buf.slice(used);
    return out;
  };
}

/** Samples as the microphone gives them (-1 to 1) to 16-bit. */
export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)));
  }
  return pcm;
}

export function toFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

/** How loud a block is, 0 to 1, for a level meter. */
export function level(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 5);
}

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32635;

function encodeSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0;
  let magnitude = Math.min(MULAW_CLIP, Math.abs(sample)) + MULAW_BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (magnitude & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
  const mantissa = (magnitude >> (exponent + 3)) & 0x0f;
  magnitude = ~(sign | (exponent << 4) | mantissa);
  return magnitude & 0xff;
}

const DECODE = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    const u = ~i & 0xff;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    const magnitude = (((mantissa << 3) + MULAW_BIAS) << exponent) - MULAW_BIAS;
    table[i] = u & 0x80 ? -magnitude : magnitude;
  }
  return table;
})();

export function encodeMulaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = encodeSample(pcm[i]);
  return out;
}

export function decodeMulaw(bytes: Uint8Array): Int16Array {
  const out = new Int16Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = DECODE[bytes[i]];
  return out;
}

/** Bytes as base64, for a JSON body. Chunked, so a long piece of sound
 *  doesn't overflow the argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A 16-bit mono WAV file of the pieces given, end to end. */
export function wavFile(pieces: readonly Int16Array[], sampleRate: number = SAMPLE_RATE): Blob {
  const samples = pieces.reduce((n, p) => n + p.length, 0);
  const bytes = samples * 2;
  const head = new DataView(new ArrayBuffer(44));
  const text = (at: number, s: string) => [...s].forEach((c, i) => head.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  head.setUint32(4, 36 + bytes, true);
  text(8, 'WAVEfmt ');
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, sampleRate, true);
  head.setUint32(28, sampleRate * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  text(36, 'data');
  head.setUint32(40, bytes, true);
  // A copy of each piece: a Blob part must own its bytes, and a view onto a
  // larger buffer would drag the whole of it in.
  return new Blob([head.buffer, ...pieces.map((p) => p.slice().buffer)], { type: 'audio/wav' });
}

/**
 * Where a moment falls in a recording saved take after take: the seconds
 * into the file, or null in a gap between takes.
 */
export function fileOffset(
  takes: readonly { startedAt: number; samples: number }[],
  at: number,
  sampleRate: number = SAMPLE_RATE,
): number | null {
  let before = 0;
  for (const take of takes) {
    const into = (at - take.startedAt) / 1000;
    if (into >= 0 && into <= take.samples / sampleRate) return before + into;
    before += take.samples / sampleRate;
  }
  return null;
}
