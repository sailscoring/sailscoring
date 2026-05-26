import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from '@/lib/relative-time';

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 4, 26, 12, 0, 0);
  const ago = (ms: number) => now - ms;
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const D = 24 * H;

  it('shows "just now" under 45 seconds', () => {
    expect(formatRelativeTime(ago(10 * S), now)).toBe('just now');
    expect(formatRelativeTime(ago(0), now)).toBe('just now');
  });

  it('shows minutes, hours, and days', () => {
    expect(formatRelativeTime(ago(5 * M), now)).toBe('5m ago');
    expect(formatRelativeTime(ago(3 * H), now)).toBe('3h ago');
    expect(formatRelativeTime(ago(2 * D), now)).toBe('2d ago');
  });

  it('falls back to a date once a week has passed', () => {
    const out = formatRelativeTime(ago(10 * D), now);
    expect(out).not.toMatch(/ago/);
    expect(out.length).toBeGreaterThan(0);
  });

  it('accepts ISO strings and clamps future times to "just now"', () => {
    expect(formatRelativeTime(new Date(ago(2 * H)).toISOString(), now)).toBe('2h ago');
    expect(formatRelativeTime(ago(-5 * M), now)).toBe('just now');
  });

  it('returns empty string for unparseable input', () => {
    expect(formatRelativeTime('not a date', now)).toBe('');
  });
});
