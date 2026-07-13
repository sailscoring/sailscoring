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
    asPublished: false,
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
    managedBy: 'app',
    reviewedAt: null,
    // One published entry by default: the index drops identities with no
    // published series, so a bare identity needs an entry to survive.
    entries: [entry({})],
    firstYear: null,
    lastYear: null,
    ...over,
  };
}

// The default entry helper uses seriesId 's'; published-set for the cases that
// aren't specifically exercising the published/unpublished split.
const PUBLISHED = new Set(['s']);

describe('toCompetitorIndexEntries', () => {
  it('collapses distinct sails and years, counts series', () => {
    const [row] = toCompetitorIndexEntries(
      [
        identity({
          label: 'Holly Cantwell',
          slug: 'holly-cantwell-x78q',
          entries: [
            entry({ year: 2021, sailNumber: 'IRL1641' }),
            entry({ year: 2023, sailNumber: 'IRL1641' }), // dup sail
            entry({ year: 2022, sailNumber: 'IRL1599' }),
          ],
        }),
      ],
      PUBLISHED,
    );
    expect(row.sailNumbers).toEqual(['IRL1641', 'IRL1599']);
    expect(row.years).toEqual([2021, 2022, 2023]); // distinct, ascending
    expect(row.seriesCount).toBe(3);
    expect(row.firstYear).toBe(2021);
    expect(row.lastYear).toBe(2023);
  });

  it('includes only published series and drops fully-unpublished identities', () => {
    const rows = toCompetitorIndexEntries(
      [
        identity({
          label: 'Holly Cantwell',
          slug: 'holly-cantwell-x78q',
          entries: [
            entry({ seriesId: 'pub', year: 2021, sailNumber: 'IRL1641' }),
            // An unpublished series: must not surface a row, sail, or year.
            entry({ seriesId: 'unpub', year: 2023, sailNumber: 'IRL9999' }),
          ],
        }),
        // Nothing published at all → not public, dropped entirely.
        identity({
          label: 'Hidden Sailor',
          slug: 'hidden-sailor-zz00',
          entries: [entry({ seriesId: 'unpub', year: 2020, sailNumber: 'IRL5' })],
        }),
      ],
      new Set(['pub']),
    );
    expect(rows.map((r) => r.name)).toEqual(['Holly Cantwell']);
    const [holly] = rows;
    expect(holly.seriesCount).toBe(1);
    expect(holly.sailNumbers).toEqual(['IRL1641']); // the unpublished sail is gone
    expect(holly.years).toEqual([2021]);
    expect(holly.firstYear).toBe(2021);
    expect(holly.lastYear).toBe(2021);
  });

  it('drops rows with no slug — they have no public URL', () => {
    const rows = toCompetitorIndexEntries(
      [
        identity({ slug: null, label: 'Unslugged' }),
        identity({ slug: 'real-one-99zz', label: 'Real One' }),
      ],
      PUBLISHED,
    );
    expect(rows.map((r) => r.name)).toEqual(['Real One']);
  });

  it('sorts by folded name so accents do not jump the order', () => {
    const rows = toCompetitorIndexEntries(
      [
        identity({ label: 'Zoe Walsh', slug: 'z' }),
        identity({ label: 'Áine Byrne', slug: 'a' }), // folds to "aine"
        identity({ label: 'Mark Doyle', slug: 'm' }),
      ],
      PUBLISHED,
    );
    expect(rows.map((r) => r.name)).toEqual([
      'Áine Byrne',
      'Mark Doyle',
      'Zoe Walsh',
    ]);
  });

  it('sorts blank-name rows last, not first', () => {
    const rows = toCompetitorIndexEntries(
      [
        identity({ label: '', slug: 'blank-1' }),
        identity({ label: 'Mark Doyle', slug: 'm' }),
        identity({ label: '   ', slug: 'blank-2' }), // whitespace-only also blank
      ],
      PUBLISHED,
    );
    expect(rows.map((r) => r.slug)).toEqual(['m', 'blank-1', 'blank-2']);
  });
});

describe('renderCompetitorIndexHtml', () => {
  const html = renderCompetitorIndexHtml(
    'iodai',
    'IODAI',
    toCompetitorIndexEntries(
      [
        identity({
          label: 'Seán Murphy',
          slug: 'sean-murphy-k4p2',
          entries: [
            entry({ year: 2014, sailNumber: 'IRL1200' }),
            entry({ year: 2018, sailNumber: '1605' }),
          ],
        }),
      ],
      PUBLISHED,
    ),
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

  it('hides blank-name rows by default but keeps them searchable', () => {
    const withBlank = renderCompetitorIndexHtml(
      'iodai',
      'IODAI',
      toCompetitorIndexEntries(
        [
          identity({ label: 'Real Sailor', slug: 'real-sailor-aa11' }),
          identity({
            label: '',
            slug: 'unknown-bb22',
            entries: [entry({ year: 2015, sailNumber: 'IRL999' })],
          }),
        ],
        PUBLISHED,
      ),
      '',
    );
    // The blank row is tagged + hidden, and shows a placeholder rather than an
    // empty name — but still carries its sail key so a sail search finds it.
    expect(withBlank).toContain('data-blank="1" style="display:none"');
    expect(withBlank).toContain('(no name)');
    expect(withBlank).toContain('data-sails="irl999"');
    // It still links to its timeline.
    expect(withBlank).toContain('href="/p/iodai/competitor/unknown-bb22"');
    // The headline count excludes the hidden blank.
    expect(withBlank).toContain('>1 competitor<');
  });
});
