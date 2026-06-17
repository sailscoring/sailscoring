import { describe, it, expect } from 'vitest';

import type {
  ArcEntry,
  IdentityWithArc,
} from '@/lib/competitor-identity-repository';
import {
  renderCompetitorIndexHtml,
  toCompetitorIndexEntries,
} from '@/lib/published-competitor-index';

function entry(over: Partial<ArcEntry>): ArcEntry {
  return {
    competitorId: 'c',
    seriesId: 's',
    seriesName: 'Event',
    venue: '',
    startDate: '2020-01-01',
    year: 2020,
    sailNumber: 'IRL1',
    club: '',
    age: null,
    ...over,
  };
}

function identity(over: Partial<IdentityWithArc>): IdentityWithArc {
  return {
    id: 'id',
    slug: 'a-sailor-ab12',
    label: 'A Sailor',
    sailNumber: 'IRL1',
    club: null,
    nationality: null,
    entries: [],
    firstYear: null,
    lastYear: null,
    ...over,
  };
}

describe('toCompetitorIndexEntries', () => {
  it('collapses distinct sails and years, counts series', () => {
    const [row] = toCompetitorIndexEntries([
      identity({
        label: 'Holly Cantwell',
        slug: 'holly-cantwell-x78q',
        firstYear: 2021,
        lastYear: 2023,
        entries: [
          entry({ year: 2021, sailNumber: 'IRL1641' }),
          entry({ year: 2023, sailNumber: 'IRL1641' }), // dup sail
          entry({ year: 2022, sailNumber: 'IRL1599' }),
        ],
      }),
    ]);
    expect(row.sailNumbers).toEqual(['IRL1641', 'IRL1599']);
    expect(row.years).toEqual([2021, 2022, 2023]); // distinct, ascending
    expect(row.seriesCount).toBe(3);
    expect(row.firstYear).toBe(2021);
    expect(row.lastYear).toBe(2023);
  });

  it('drops rows with no slug — they have no public URL', () => {
    const rows = toCompetitorIndexEntries([
      identity({ slug: null, label: 'Unslugged' }),
      identity({ slug: 'real-one-99zz', label: 'Real One' }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(['Real One']);
  });

  it('sorts by folded name so accents do not jump the order', () => {
    const rows = toCompetitorIndexEntries([
      identity({ label: 'Zoe Walsh', slug: 'z' }),
      identity({ label: 'Áine Byrne', slug: 'a' }), // folds to "aine"
      identity({ label: 'Mark Doyle', slug: 'm' }),
    ]);
    expect(rows.map((r) => r.name)).toEqual([
      'Áine Byrne',
      'Mark Doyle',
      'Zoe Walsh',
    ]);
  });
});

describe('renderCompetitorIndexHtml', () => {
  const html = renderCompetitorIndexHtml(
    'iodai',
    'IODAI',
    toCompetitorIndexEntries([
      identity({
        label: 'Seán Murphy',
        slug: 'sean-murphy-k4p2',
        firstYear: 2014,
        lastYear: 2018,
        entries: [
          entry({ year: 2014, sailNumber: 'IRL1200' }),
          entry({ year: 2018, sailNumber: '1605' }),
        ],
      }),
    ]),
    '',
  );

  it('links each row to the timeline by slug', () => {
    expect(html).toContain('href="/p/iodai/competitor/sean-murphy-k4p2"');
    expect(html).toContain('Seán Murphy');
  });

  it('bakes folded search keys onto the row for the inline filter', () => {
    // Name folded (accent stripped, lowercased); sails folded + space-joined;
    // years space-joined for the padded year match.
    expect(html).toContain('data-name="sean murphy"');
    expect(html).toContain('data-sails="irl1200 1605"');
    expect(html).toContain('data-years="2014 2018"');
  });

  it('offers a year filter of the years present, newest first', () => {
    expect(html).toContain('<option value="">All years</option>');
    const opts = [...html.matchAll(/<option value="(\d+)">/g)].map((m) => m[1]);
    expect(opts).toEqual(['2018', '2014']);
  });

  it('ships the inline search script and a live count', () => {
    expect(html).toContain('<script>');
    expect(html).toContain('id="count"');
    expect(html).toContain('1 competitor');
  });
});
