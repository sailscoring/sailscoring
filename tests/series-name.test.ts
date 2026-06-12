import { describe, it, expect } from 'vitest';
import {
  normalizeSeriesName,
  isDuplicateSeriesName,
  disambiguateSeriesName,
  suggestFollowOnName,
} from '@/lib/series-name';

describe('normalizeSeriesName', () => {
  it('trims and lowercases', () => {
    expect(normalizeSeriesName('  Autumn League  ')).toBe('autumn league');
  });
  it('preserves internal whitespace', () => {
    expect(normalizeSeriesName('Autumn  League')).toBe('autumn  league');
  });
});

describe('isDuplicateSeriesName', () => {
  it('detects case-insensitive matches', () => {
    expect(isDuplicateSeriesName('Autumn League', ['autumn league'])).toBe(true);
    expect(isDuplicateSeriesName('autumn league', ['AUTUMN LEAGUE'])).toBe(true);
  });
  it('detects whitespace-trimmed matches', () => {
    expect(isDuplicateSeriesName('Foo', ['  Foo  '])).toBe(true);
    expect(isDuplicateSeriesName('  Foo  ', ['Foo'])).toBe(true);
  });
  it('returns false for distinct names', () => {
    expect(isDuplicateSeriesName('Foo', ['Bar', 'Baz'])).toBe(false);
  });
  it('returns false for empty candidate', () => {
    expect(isDuplicateSeriesName('', ['Foo'])).toBe(false);
    expect(isDuplicateSeriesName('   ', ['Foo'])).toBe(false);
  });
  it('rename-to-self is handled by passing an existing list that excludes the current series', () => {
    // Callers filter out the current row by ID before calling. Here we simulate
    // renaming series A ("Foo") — the list passed in contains only the OTHER
    // series names.
    expect(isDuplicateSeriesName('Foo', ['Bar'])).toBe(false);
    expect(isDuplicateSeriesName('Foo', ['Foo'])).toBe(true);
  });
});

describe('disambiguateSeriesName', () => {
  it('returns the base name unchanged when unused', () => {
    expect(disambiguateSeriesName('Foo', [])).toBe('Foo');
    expect(disambiguateSeriesName('Foo', ['Bar'])).toBe('Foo');
  });
  it('appends (2) on first collision', () => {
    expect(disambiguateSeriesName('Foo', ['Foo'])).toBe('Foo (2)');
  });
  it('finds the next free counter', () => {
    expect(disambiguateSeriesName('Foo', ['Foo', 'Foo (2)'])).toBe('Foo (3)');
    expect(disambiguateSeriesName('Foo', ['Foo', 'Foo (2)', 'Foo (3)'])).toBe('Foo (4)');
  });
  it('skips gaps at the start', () => {
    expect(disambiguateSeriesName('Foo', ['Foo', 'Foo (3)'])).toBe('Foo (2)');
  });
  it('idempotent for already-suffixed names', () => {
    expect(disambiguateSeriesName('Foo (2)', ['Foo', 'Foo (2)'])).toBe('Foo (3)');
    expect(disambiguateSeriesName('Foo (5)', ['Foo', 'Foo (5)'])).toBe('Foo (6)');
  });
  it('is case-insensitive on the compare but preserves the input casing', () => {
    expect(disambiguateSeriesName('foo', ['FOO'])).toBe('foo (2)');
    expect(disambiguateSeriesName('Foo', ['foo', 'FOO (2)'])).toBe('Foo (3)');
  });
  it('trims surrounding whitespace from the input', () => {
    expect(disambiguateSeriesName('  Foo  ', ['Foo'])).toBe('Foo (2)');
  });
  it('treats only a trailing " (N)" as the counter, not middle occurrences', () => {
    expect(disambiguateSeriesName('Foo (2) Bar', ['Foo (2) Bar'])).toBe('Foo (2) Bar (2)');
  });
});

describe('suggestFollowOnName', () => {
  it('increments a trailing integer', () => {
    expect(suggestFollowOnName('Spring Series 1', [])).toBe('Spring Series 2');
    expect(suggestFollowOnName('Series 9', [])).toBe('Series 10');
  });
  it('increments a trailing year', () => {
    expect(suggestFollowOnName('Autumn 2025', [])).toBe('Autumn 2026');
  });
  it('appends " 2" when the name has no trailing integer', () => {
    expect(suggestFollowOnName('Frostbites', [])).toBe('Frostbites 2');
  });
  it('skips past taken names', () => {
    expect(suggestFollowOnName('Series 2', ['Series 3'])).toBe('Series 4');
    expect(suggestFollowOnName('Frostbites', ['Frostbites 2', 'Frostbites 3'])).toBe('Frostbites 4');
  });
  it('compares case-insensitively but preserves the input casing', () => {
    expect(suggestFollowOnName('Spring Series 1', ['SPRING SERIES 2'])).toBe('Spring Series 3');
  });
  it('absorbs whitespace between the root and the counter', () => {
    expect(suggestFollowOnName('Spring Series 1  ', [])).toBe('Spring Series 2');
  });
  it('only treats a trailing integer as the counter, not middle digits', () => {
    expect(suggestFollowOnName('2026 Frostbites', [])).toBe('2026 Frostbites 2');
  });
});
