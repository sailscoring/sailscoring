import { describe, it, expect } from 'vitest';

import type { CareerArc, CareerArcEntry } from '@/lib/career-arc';
import { renderCareerArcHtml } from '@/lib/career-arc-render';

function arcEntry(over: Partial<CareerArcEntry>): CareerArcEntry {
  return {
    competitorId: 'c',
    seriesId: 's',
    seriesName: 'IODAI Leinsters 2018',
    venue: '',
    startDate: '2018-05-01',
    year: 2018,
    sailNumber: 'IRL1200',
    club: '',
    age: null,
    asPublished: false,
    rank: null,
    fleetSize: null,
    fleetName: null,
    publishedSlug: null,
    ...over,
  };
}

function arc(entries: CareerArcEntry[]): CareerArc {
  return {
    rankingEntries: [],
    id: 'id',
    slug: 'aoife-murphy-ab12',
    label: 'Aoife Murphy',
    sailNumber: 'IRL1200',
    club: 'RCYC',
    nationality: null,
    managedBy: 'app',
    reviewedAt: null,
    firstYear: entries[0]?.year ?? null,
    lastYear: entries[entries.length - 1]?.year ?? null,
    entries,
  };
}

describe('renderCareerArcHtml deep-links', () => {
  it('links a published entry to its results page', () => {
    const html = renderCareerArcHtml(
      'iodai',
      'IODAI',
      arc([arcEntry({ publishedSlug: 'leinsters-2018' })]),
    );
    expect(html).toContain(
      '<a href="/p/iodai/leinsters-2018">IODAI Leinsters 2018</a>',
    );
  });

  it('leaves an unpublished entry as plain text', () => {
    const html = renderCareerArcHtml(
      'iodai',
      'IODAI',
      arc([arcEntry({ seriesName: 'IODAI Munsters 2019', publishedSlug: null })]),
    );
    expect(html).toContain('IODAI Munsters 2019');
    // No anchor wrapping the event name.
    expect(html).not.toContain('>IODAI Munsters 2019</a>');
  });

  it('backlinks to the competitor index, not the workspace listing', () => {
    const html = renderCareerArcHtml('iodai', 'IODAI', arc([arcEntry({})]));
    expect(html).toContain('href="/p/iodai/competitors"');
  });

  it('renders season-ranking achievements, including for a ranking-only sailor', () => {
    const rankingOnly: CareerArc = {
      ...arc([]),
      rankingEntries: [
        {
          rankingId: 'r1',
          name: 'IODAI National Ranking 2006',
          slug: 'national-ranking-2006',
          season: 2006,
          fleetLabel: null,
          rank: 12,
          rankLabel: '12th',
          rankedCount: 51,
        },
      ],
    };
    const html = renderCareerArcHtml('iodai', 'IODAI', rankingOnly);
    expect(html).toContain('Season rankings');
    expect(html).toContain('Ranked 12th of 51');
    expect(html).toContain('href="/p/iodai/ranking/national-ranking-2006"');
    expect(html).not.toContain('No series recorded yet');
  });
});
