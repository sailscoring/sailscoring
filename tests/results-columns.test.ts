import { describe, expect, it } from 'vitest';
import { automaticColumns, type ColumnRow, type ColumnSettings } from '@/lib/results-columns';

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
