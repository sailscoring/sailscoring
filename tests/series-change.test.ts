/**
 * `describeSeriesChange` — what a series save actually changed, named for the
 * activity log. One endpoint writes the whole series row, so these pin the two
 * properties the log depends on: a save that changes nothing is recognised as
 * nothing, and a save that changes something says which something, with the
 * scoring-affecting facets never hidden behind an incidental edit.
 */
import { describe, it, expect } from 'vitest';

import { describeSeriesChange } from '@/lib/series-change';
import type { Series } from '@/lib/types';

function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: 's1',
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: true,
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    raceFleetExclusions: [],
    prizes: [],
    publishingGroups: [],
    version: 4,
    ...overrides,
  } as Series;
}

describe('describeSeriesChange', () => {
  it('reports nothing for an identical save', () => {
    const s = makeSeries();
    expect(describeSeriesChange(s, makeSeries())).toBeNull();
  });

  it('ignores the fields every save moves', () => {
    const before = makeSeries({ lastModifiedAt: 1000, version: 4, displayOrder: 2 });
    const after = makeSeries({ lastModifiedAt: 2000, version: 5, displayOrder: 3 });
    expect(describeSeriesChange(before, after)).toBeNull();
  });

  it('ignores the fields this endpoint cannot write', () => {
    // The stored row carries these; a client round-trip drops them, and that
    // is not a change to anything.
    const before = makeSeries({ asPublished: true, previousSeriesId: 'p1' });
    expect(describeSeriesChange(before, makeSeries())).toBeNull();
  });

  it('treats absent, empty and false as the same state', () => {
    const before = makeSeries({
      raceFleetExclusions: [],
      prizes: [],
      seriesNote: '',
      publishOfficials: false,
    });
    const after = makeSeries({
      raceFleetExclusions: undefined,
      prizes: undefined,
      seriesNote: undefined,
      publishOfficials: undefined,
    });
    expect(describeSeriesChange(before, after)).toBeNull();
  });

  it('keeps absent meaning true where that is the default', () => {
    // `publishIndividualFleetPages` defaults on, so an explicit false is a
    // real change away from it — not the "absent means nothing" case above.
    const change = describeSeriesChange(
      makeSeries({ publishIndividualFleetPages: undefined }),
      makeSeries({ publishIndividualFleetPages: false }),
    );
    expect(change?.summary).toBe('Changed what the published pages show');
  });

  it('does not read key order as a change', () => {
    const before = makeSeries({ ftpPaths: { a: '/one', b: '/two' } });
    const after = makeSeries({ ftpPaths: { b: '/two', a: '/one' } });
    expect(describeSeriesChange(before, after)).toBeNull();
  });

  it('names a discard change as a scoring change', () => {
    const change = describeSeriesChange(
      makeSeries(),
      makeSeries({ discardThresholds: [{ minRaces: 5, discardCount: 1 }] }),
    );
    expect(change).toEqual({
      action: 'series.scoring-updated',
      facet: 'discards',
      summary: 'Changed the discard profile',
    });
  });

  it.each([
    ['dnfScoring', { dnfScoring: 'startingArea' }, 'Changed how a boat that did not finish is scored'],
    ['excludeDncOnlyCompetitors', { excludeDncOnlyCompetitors: true }, 'Changed whether boats that never sailed are counted'],
    [
      'raceFleetExclusions',
      { raceFleetExclusions: [{ raceId: 'r1', fleetId: 'f1' }] },
      'Changed which races count for which fleets',
    ],
  ] as const)('names %s as a scoring change', (_field, patch, summary) => {
    const change = describeSeriesChange(makeSeries(), makeSeries(patch as Partial<Series>));
    expect(change?.action).toBe('series.scoring-updated');
    expect(change?.summary).toBe(summary);
  });

  it('names the scoring mode it moved to', () => {
    const change = describeSeriesChange(makeSeries(), makeSeries({ scoringMode: 'handicap' }));
    expect(change?.summary).toBe('Changed the scoring mode to handicap');
  });

  it('names a rename, with the new name', () => {
    const change = describeSeriesChange(makeSeries(), makeSeries({ name: 'Winter League' }));
    expect(change).toEqual({
      action: 'series.renamed',
      facet: 'name',
      summary: 'Renamed the series to “Winter League”',
    });
  });

  it.each([
    [{ seriesNote: 'Corrected 16:40' }, 'Edited the note on the published pages'],
    [{ prizes: [{ id: 'p1', name: 'Overall', recipientCount: 1, clauses: [] }] }, 'Updated the prize list'],
    [{ venue: 'RIYC' }, 'Updated the venue and event details'],
    [{ ftpHost: 'ftp.example.ie' }, 'Updated the publishing destination'],
    [{ protestTimeLimit: { minutes: 60, basis: 'race' } }, 'Changed the protest time limit'],
  ] as const)('names an ordinary edit: %j', (patch, summary) => {
    const change = describeSeriesChange(makeSeries(), makeSeries(patch as Partial<Series>));
    expect(change?.action).toBe('series.updated');
    expect(change?.summary).toBe(summary);
  });

  it('leads with the scoring facet when a save moves several', () => {
    const change = describeSeriesChange(
      makeSeries(),
      makeSeries({ venue: 'RIYC', seriesNote: 'note', dnfScoring: 'startingArea' }),
    );
    expect(change).toEqual({
      action: 'series.scoring-updated',
      facet: 'dnf-scoring',
      summary: 'Changed how a boat that did not finish is scored +2 more',
    });
  });

  it('falls back to the generic summary for a field no facet claims', () => {
    // Stands in for a field added later without a facet: reported vaguely
    // rather than swallowed.
    const after = makeSeries();
    (after as unknown as Record<string, unknown>).somethingNew = true;
    const change = describeSeriesChange(makeSeries(), after);
    expect(change).toEqual({
      action: 'series.updated',
      facet: 'settings',
      summary: 'Updated series settings',
    });
  });
});
