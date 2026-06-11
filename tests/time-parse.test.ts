import { describe, it, expect } from 'vitest';
import { formatSecondsAsHms, normalizeTimeInput, parseHmsToSeconds } from '@/lib/time-parse';

describe('normalizeTimeInput', () => {
  it('accepts HH:MM:SS', () => {
    expect(normalizeTimeInput('14:32:10')).toBe('14:32:10');
  });

  it('accepts H:MM:SS and zero-pads the hour', () => {
    expect(normalizeTimeInput('9:05:07')).toBe('09:05:07');
  });

  it('accepts HHMMSS and inserts colons', () => {
    expect(normalizeTimeInput('143210')).toBe('14:32:10');
  });

  it('accepts HMMSS and zero-pads', () => {
    expect(normalizeTimeInput('90507')).toBe('09:05:07');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeTimeInput('  14:32:10  ')).toBe('14:32:10');
  });

  it('rejects minutes over 59', () => {
    expect(normalizeTimeInput('14:60:00')).toBeNull();
  });

  it('rejects seconds over 59', () => {
    expect(normalizeTimeInput('14:32:60')).toBeNull();
  });

  it('rejects non-numeric input', () => {
    expect(normalizeTimeInput('14h32m')).toBeNull();
  });

  it('rejects dot-separated times (Sailwave style)', () => {
    // Caller must convert "HH.MM.SS" → "HH:MM:SS" before passing in.
    expect(normalizeTimeInput('14.32.10')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(normalizeTimeInput('')).toBeNull();
    expect(normalizeTimeInput('   ')).toBeNull();
  });

  it('rejects 4-digit input (ambiguous)', () => {
    expect(normalizeTimeInput('1432')).toBeNull();
  });
});

describe('parseHmsToSeconds', () => {
  it('parses HH:MM:SS and H:MM:SS (leading zero optional)', () => {
    expect(parseHmsToSeconds('14:32:10')).toBe(14 * 3600 + 32 * 60 + 10);
    expect(parseHmsToSeconds('9:05:00')).toBe(9 * 3600 + 5 * 60);
    expect(parseHmsToSeconds('00:00:00')).toBe(0);
  });

  it('accepts hours beyond 23 (a finish after midnight keeps counting)', () => {
    expect(parseHmsToSeconds('25:00:00')).toBe(25 * 3600);
  });

  it('tolerates out-of-range minutes/seconds — the strict gate is normalizeTimeInput', () => {
    // Stored data has always been read this way; re-scoring must not change.
    expect(parseHmsToSeconds('10:99:00')).toBe(10 * 3600 + 99 * 60);
  });

  it('returns null for missing or malformed values', () => {
    expect(parseHmsToSeconds(undefined)).toBeNull();
    expect(parseHmsToSeconds(null)).toBeNull();
    expect(parseHmsToSeconds('')).toBeNull();
    expect(parseHmsToSeconds('14:32')).toBeNull();
    expect(parseHmsToSeconds('xx:32:10')).toBeNull();
  });
});

describe('formatSecondsAsHms', () => {
  it('zero-pads each component', () => {
    expect(formatSecondsAsHms(9 * 3600 + 5 * 60 + 3)).toBe('09:05:03');
  });

  it('keeps counting past midnight rather than wrapping', () => {
    expect(formatSecondsAsHms(25 * 3600)).toBe('25:00:00');
  });

  it('round-trips with parseHmsToSeconds', () => {
    expect(parseHmsToSeconds(formatSecondsAsHms(52330))).toBe(52330);
  });
});
