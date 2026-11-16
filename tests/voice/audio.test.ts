import { describe, expect, it } from 'vitest';

import {
  clipOf,
  clipWindow,
  decodeMulaw,
  encodeMulaw,
  fileOffset,
  fromBase64,
  resampler,
  toBase64,
  toPcm16,
  wavFile,
} from '@/lib/voice/audio';

describe('resampler', () => {
  it('passes 16 kHz through untouched', () => {
    const x = new Float32Array([0.1, 0.2, 0.3]);
    expect(resampler(16000)(x)).toBe(x);
  });

  it('brings 48 kHz down to a third of the samples, whatever the block size', () => {
    const down = resampler(48000);
    let out = 0;
    for (let i = 0; i < 100; i++) out += down(new Float32Array(128)).length;
    // A step's worth may still be carried.
    expect(Math.abs(out - (100 * 128) / 3)).toBeLessThanOrEqual(2);
  });

  it('keeps a slow tone', () => {
    const down = resampler(44100);
    const tone = new Float32Array(44100).map((_, i) => Math.sin((2 * Math.PI * 200 * i) / 44100));
    const out = down(tone);
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2);
    const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(peak).toBeGreaterThan(0.9);
  });
});

describe('µ-law', () => {
  it('survives a round trip closely enough for speech', () => {
    const pcm = toPcm16(new Float32Array(1600).map((_, i) => 0.6 * Math.sin((2 * Math.PI * 300 * i) / 16000)));
    const back = decodeMulaw(encodeMulaw(pcm));
    expect(back).toHaveLength(pcm.length);
    let worst = 0;
    for (let i = 0; i < pcm.length; i++) worst = Math.max(worst, Math.abs(back[i] - pcm[i]) / Math.max(256, Math.abs(pcm[i])));
    expect(worst).toBeLessThan(0.07);
  });

  it('keeps silence silent and the extremes in range', () => {
    expect([...decodeMulaw(encodeMulaw(new Int16Array([0, 0])))].map(Math.abs)).toEqual([0, 0]);
    const [lo, hi] = decodeMulaw(encodeMulaw(new Int16Array([-32768, 32767])));
    expect(lo).toBeLessThan(-30000);
    expect(hi).toBeGreaterThan(30000);
  });
});

describe('base64', () => {
  it('round-trips a piece longer than one chunk', () => {
    const bytes = new Uint8Array(80000).map((_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe('wavFile', () => {
  it('writes a 16-bit mono header over the pieces end to end', async () => {
    const blob = wavFile([new Int16Array([1, 2, 3]), new Int16Array([4, 5])]);
    const view = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/wav');
    expect(view.byteLength).toBe(44 + 10);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(44 + 6, true)).toBe(4);
  });
});

describe('fileOffset', () => {
  const takes = [
    { startedAt: 1_000_000, samples: 16000 * 10 },
    { startedAt: 1_060_000, samples: 16000 * 20 },
  ];

  it('finds a moment in a file saved take after take', () => {
    expect(fileOffset(takes, 1_004_000)).toBe(4);
    expect(fileOffset(takes, 1_065_000)).toBe(15);
  });

  it('has no place for a moment between takes', () => {
    expect(fileOffset(takes, 1_030_000)).toBeNull();
    expect(fileOffset(takes, 999_000)).toBeNull();
  });
});

describe('clipOf', () => {
  const takes = [
    { index: 0, startedAt: 1_000_000, samples: 16000 * 12 },
    { index: 1, startedAt: 1_100_000, samples: 16000 * 3 },
  ];
  // Each piece holds a value of its own, so a clip shows which pieces it came from.
  const read = async (take: number, index: number) => {
    const length = take === 0 ? (index < 2 ? 80000 : 32000) : 48000;
    return new Int16Array(length).fill((take * 10 + index + 1) * 328);
  };
  const value = (take: number, index: number) => ((take * 10 + index + 1) * 328) / 32768;

  it('cuts a stretch out of the pieces that hold it', async () => {
    // 4 s to 6 s into the first take: the end of piece 0 and the start of piece 1.
    const clip = (await clipOf(takes, 1_004_000, 1_006_000, read))!;
    expect(clip).toHaveLength(32000);
    expect(clip[0]).toBeCloseTo(value(0, 0));
    expect(clip[15999]).toBeCloseTo(value(0, 0));
    expect(clip[16000]).toBeCloseTo(value(0, 1));
  });

  it('stops at the ends of the take', async () => {
    const clip = (await clipOf(takes, 999_000, 1_001_000, read))!;
    expect(clip).toHaveLength(16000);
    const tail = (await clipOf(takes, 1_011_000, 1_020_000, read))!;
    expect(tail).toHaveLength(16000);
    expect(tail[0]).toBeCloseTo(value(0, 2));
  });

  it('plays a missing piece as silence, and nothing between takes', async () => {
    const clip = (await clipOf(takes, 1_004_000, 1_006_000, async (t, i) => (i === 1 ? undefined : read(t, i))))!;
    expect(clip[16000]).toBe(0);
    expect(await clipOf(takes, 1_050_000, 1_052_000, read)).toBeNull();
  });
});

describe('clipWindow', () => {
  it('runs from before the call to after she crossed', () => {
    expect(clipWindow({ heardAt: 10_000, heardUntil: 11_000, at: 12_500 })).toEqual({ from: 8_000, to: 15_000 });
    // A press of Now before her number was called.
    expect(clipWindow({ heardAt: 14_000, heardUntil: 15_000, at: 12_000 })).toEqual({ from: 10_000, to: 17_500 });
    expect(clipWindow({ heardAt: null, heardUntil: null, at: 12_000 })).toEqual({ from: 10_000, to: 14_500 });
  });
});
