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
    rank: null,
    fleetSize: null,
    fleetName: null,
    publishedSlug: null,
    ...over,
  };
}

function arc(entries: CareerArcEntry[]): CareerArc {
  return {
    id: 'id',
    slug: 'aoife-murphy-ab12',
    label: 'Aoife Murphy',
    sailNumber: 'IRL1200',
    club: 'RCYC',
    nationality: null,
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
});
