import { describe, expect, it } from 'vitest';
import { applicableScoringColumns, automaticColumns, scoringColumnShown, type ColumnRow, type ColumnSettings } from '@/lib/results-columns';

const keys = (settings: ColumnSettings, table: 'standings' | 'races' | 'entries', rows: ColumnRow[], multiFleet = false) =>
  automaticColumns(settings, table, rows, { multiFleet }).map((c) => c.key);

describe('automaticColumns', () => {
  it('leads the standings with Rank and always shows sail number and the primary name', () => {
    expect(keys({ enabledCompetitorFields: [] }, 'standings', [])).toEqual(['rank', 'sailNumber', 'primary']);
  });

  it('keeps Boat on the standings when switched on, but leaves it off an entry list no boat has one in', () => {
    const settings: ColumnSettings = { enabledCompetitorFields: ['boatName'] };
    expect(keys(settings, 'standings', [{}])).toContain('boatName');
    expect(keys(settings, 'entries', [{}])).not.toContain('boatName');
    expect(keys(settings, 'entries', [{ boatName: 'Eclipse' }])).toContain('boatName');
  });

  it('leaves off a column no boat has a value in', () => {
    const settings: ColumnSettings = { enabledCompetitorFields: ['club', 'nationality'] };
    expect(keys(settings, 'standings', [{ clubs: ['HYC'] }])).toEqual(['rank', 'sailNumber', 'primary', 'club']);
  });

  it('pairs crew with the primary name unless a separate Helm column is shown', () => {
    const paired = automaticColumns({ enabledCompetitorFields: ['crewName'], primaryPersonLabel: 'helm' }, 'standings', []);
    expect(paired.map((c) => c.key)).toEqual(['rank', 'sailNumber', 'primary']);
    expect(paired[2]).toMatchObject({ header: 'Helm / Crew', pairCrew: true });

    const apart = automaticColumns({ enabledCompetitorFields: ['crewName', 'helm'], primaryPersonLabel: 'owner' }, 'standings', []);
    expect(apart.map((c) => c.key)).toEqual(['rank', 'sailNumber', 'primary', 'helm', 'crewName']);
  });

  it('heads a subdivision axis column with its label', () => {
    const settings: ColumnSettings = {
      enabledCompetitorFields: ['subdivision'],
      subdivisionAxes: [{ id: 'a1', label: 'Category' }, { id: 'a2', label: '' }],
    };
    const cols = automaticColumns(settings, 'standings', [{ subdivisions: { a1: 'Master', a2: 'Gold' } }]);
    expect(cols.slice(3).map((c) => [c.key, c.header])).toEqual([
      ['subdivision:a1', 'Category'],
      ['subdivision:a2', 'Division'],
    ]);
  });

  it('starts an entry list of several fleets with a Fleet column, and never ranks it', () => {
    expect(keys({ enabledCompetitorFields: [] }, 'entries', [], true)).toEqual(['fleet', 'sailNumber', 'primary']);
  });
});

describe('the standings Rating column', () => {
  const ctx = { handicap: true, fixedRating: true, progressive: false, orc: false, trackData: false };

  it('is offered where a fleet is scored on a fixed rating, ahead of the progressive ratings', () => {
    expect(applicableScoringColumns(ctx).standings).toEqual(['boatRating', 'total', 'nett']);
    expect(applicableScoringColumns({ ...ctx, progressive: true }).standings).toEqual(['boatRating', 'perRaceRatings', 'total', 'nett']);
  });

  it('is not offered to a series of NHC or ECHO fleets alone', () => {
    expect(applicableScoringColumns({ ...ctx, fixedRating: false, progressive: true }).standings).toEqual(['perRaceRatings', 'total', 'nett']);
  });

  it('shows on a series whose own list predates it, and hides when the list says so', () => {
    expect(scoringColumnShown({ resultsColumns: [{ key: 'sailNumber' }, { key: 'primary' }] }, 'boatRating')).toBe(true);
    expect(scoringColumnShown({ resultsColumns: [{ key: 'boatRating', hidden: true }] }, 'boatRating')).toBe(false);
  });
});

describe('time to win, rating to win and speed', () => {
  const keys = ['timeToWin', 'ratingToWin', 'speed'] as const;

  it('are offered on any handicap series, after Delta', () => {
    const ctx = { handicap: true, fixedRating: true, progressive: false, orc: false, trackData: false };
    const races = applicableScoringColumns(ctx).races;
    expect(races.slice(races.indexOf('delta'), races.indexOf('delta') + 4)).toEqual(['delta', ...keys]);
    expect(applicableScoringColumns({ ...ctx, handicap: false, fixedRating: false }).races).not.toContain('speed');
  });

  it('are off until the series turns them on, even in a list that predates them', () => {
    for (const key of keys) {
      expect(scoringColumnShown({}, key)).toBe(false);
      expect(scoringColumnShown({ resultsColumns: [{ key: 'sailNumber' }, { key: 'primary' }] }, key)).toBe(false);
      expect(scoringColumnShown({ resultsColumns: [{ key }] }, key)).toBe(true);
    }
  });
});
