import { describe, it, expect } from 'vitest';
import {
  formatElapsedInput,
  formatSecondsAsHms,
  normalizeTimeInput,
  parseElapsedInput,
  parseHmsToSeconds,
} from '@/lib/time-parse';

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

  it('accepts dot-separated times (Sailwave style)', () => {
    expect(normalizeTimeInput('14.32.10')).toBe('14:32:10');
    expect(normalizeTimeInput('12.39.25')).toBe('12:39:25');
    expect(normalizeTimeInput('9.05.07')).toBe('09:05:07');
  });

  it('range-checks dot-separated times too', () => {
    expect(normalizeTimeInput('14.60.00')).toBeNull();
    expect(normalizeTimeInput('14.32.60')).toBeNull();
  });

  it('rejects separators mixed within one time', () => {
    expect(normalizeTimeInput('14:32.10')).toBeNull();
    expect(normalizeTimeInput('14.32:10')).toBeNull();
  });

  it('rejects a decimal fraction of a day', () => {
    // Excel's raw serial for a time of day — the CSV importer converts these
    // before they reach here, and they are not times in their own right.
    expect(normalizeTimeInput('0.4382523')).toBeNull();
    expect(normalizeTimeInput('.4382523')).toBeNull();
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

describe('parseElapsedInput', () => {
  it('reads M:SS', () => {
    expect(parseElapsedInput('4:32')).toBe(272);
  });

  it('reads H:MM:SS', () => {
    expect(parseElapsedInput('1:04:32')).toBe(3872);
  });

  it('reads the three-part dot-separated form scorers type', () => {
    expect(parseElapsedInput('1.04.32')).toBe(3872);
  });

  it('reads a two-part dot value as decimal seconds, not minutes and seconds', () => {
    // "4.32" could be either and nothing can tell; the decimal reading is the
    // one that doesn't silently multiply a recorded time by sixty.
    expect(parseElapsedInput('4.32')).toBe(4.32);
  });

  it('reads plain seconds', () => {
    expect(parseElapsedInput('2751')).toBe(2751);
    expect(parseElapsedInput('2751.785')).toBe(2751.785);
  });

  it('keeps a fractional second', () => {
    expect(parseElapsedInput('45:51.785')).toBe(2751.785);
  });

  it('rejects out-of-range minutes and seconds', () => {
    expect(parseElapsedInput('1:60:00')).toBeNull();
    expect(parseElapsedInput('4:60')).toBeNull();
  });

  it('rejects an empty or unreadable value', () => {
    expect(parseElapsedInput('')).toBeNull();
    expect(parseElapsedInput('  ')).toBeNull();
    expect(parseElapsedInput('soon')).toBeNull();
  });

  it('reads "4:32" as four and a half minutes, not a time of day', () => {
    // The distinction from normalizeTimeInput, which rejects it outright.
    expect(parseElapsedInput('4:32')).toBe(272);
    expect(normalizeTimeInput('4:32')).toBeNull();
  });
});

describe('formatElapsedInput', () => {
  it('drops the hour below one', () => {
    expect(formatElapsedInput(272)).toBe('4:32');
  });

  it('shows the hour above one, zero-padding minutes', () => {
    expect(formatElapsedInput(3872)).toBe('1:04:32');
  });

  it('keeps a fraction to three places, trimming trailing zeros', () => {
    expect(formatElapsedInput(2751.785)).toBe('45:51.785');
    expect(formatElapsedInput(2751.5)).toBe('45:51.5');
  });

  it('round-trips through parseElapsedInput', () => {
    for (const secs of [0, 59, 272, 3600, 3872, 2751.785]) {
      expect(parseElapsedInput(formatElapsedInput(secs))).toBe(secs);
    }
  });
});
