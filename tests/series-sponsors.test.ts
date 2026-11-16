/**
 * A series' sponsors and trophy donors: what is kept of an edited list, and
 * how a published line reads.
 */
import { describe, it, expect } from 'vitest';
import {
  joinNames,
  sponsorLines,
  sponsorLineText,
  sponsorsSummary,
  tidySponsors,
} from '@/lib/series-sponsors';
import type { SeriesSponsor } from '@/lib/types';

describe('joinNames', () => {
  it('reads one, two and several names as said aloud', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinNames(['A', 'B', 'C', 'D'])).toBe('A, B, C and D');
  });
});

describe('tidySponsors', () => {
  it('trims, drops unnamed rows and blank optional fields, and keeps order', () => {
    const list: SeriesSponsor[] = [
      { name: '  O\'Leary Life ', kind: 'sponsor', logoUrl: ' ', url: ' https://olearylife.ie ' },
      { name: '   ', kind: 'sponsor', logoUrl: 'https://example.com/x.png' },
      { name: 'The Draper Family', kind: 'donor' },
    ];
    expect(tidySponsors(list)).toEqual([
      { name: 'O\'Leary Life', kind: 'sponsor', url: 'https://olearylife.ie' },
      { name: 'The Draper Family', kind: 'donor' },
    ]);
  });

  it('treats an unknown kind as a sponsor', () => {
    const list = [{ name: 'X', kind: 'patron' }] as unknown as SeriesSponsor[];
    expect(tidySponsors(list)).toEqual([{ name: 'X', kind: 'sponsor' }]);
  });

  it('is empty for no list', () => {
    expect(tidySponsors(undefined)).toEqual([]);
  });
});

describe('sponsorLines', () => {
  it('puts sponsors first and donors on a line of their own', () => {
    const lines = sponsorLines([
      { name: 'The Draper Family', kind: 'donor' },
      { name: 'Axiom Private Clients', kind: 'sponsor' },
      { name: 'The Blue Haven Group', kind: 'sponsor' },
    ]);
    expect(lines.map(sponsorLineText)).toEqual([
      'Sponsored by Axiom Private Clients and The Blue Haven Group',
      'Trophy presented by The Draper Family',
    ]);
  });

  it('has no lines for an empty list', () => {
    expect(sponsorLines([])).toEqual([]);
    expect(sponsorsSummary(undefined)).toBe('No sponsors');
  });

  it('summarises both lines on one', () => {
    expect(sponsorsSummary([
      { name: 'A', kind: 'sponsor' },
      { name: 'B', kind: 'donor' },
    ])).toBe('Sponsored by A · Trophy presented by B');
  });
});
