import { describe, it, expect } from 'vitest';
import { normalizeTimeInput } from '@/lib/time-parse';

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
