/**
 * A series' own results columns: the published tables follow its list —
 * order, titles, tables, empty columns, person display — while the scoring
 * columns keep their places and may only be hidden or retitled.
 */
import { describe, it, expect } from 'vitest';
import {
  renderSeriesHtml,
  renderCompetitorListHtml,
  type SeriesResultsData,
  type RaceData,
  type StandingRowData,
} from '@/lib/results-renderer';
import type { ResultsColumn } from '@/lib/types';

function standing(rank: number, sail: string, extra: Partial<StandingRowData> = {}): StandingRowData {
  return {
    rank,
    sailNumber: sail,
    helm: [`Helm ${sail}`],
    raceScores: [{ points: rank, resultCode: null, isDiscard: false, podiumRank: null, penaltyCode: null, penaltyOverride: null, isRedress: false }],
    totalPoints: rank,
    netPoints: rank,
    ...extra,
  };
}

const race: RaceData = {
  raceNumber: 1,
  date: '2026-11-01',
  label: 'R1',
  anchorId: 'r1',
  results: [
    { rank: 1, sailNumber: '101', helm: ['Helm 101'], clubs: ['HYC'], crewNames: ['Crew A'], nationality: 'IRL', customFields: { rig: '8.2' }, place: 1, points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null },
    { rank: 2, sailNumber: '102', helm: ['Helm 102'], crewNames: ['Crew B', 'Crew C'], place: 2, points: 2, resultCode: null, penaltyCode: null, penaltyOverride: null },
  ],
};

const base: SeriesResultsData = {
  series: { name: 'Champions Cup', venue: 'Howth' },
  enabledCompetitorFields: ['club', 'crewName', 'nationality', 'boatClass', 'boatName'],
  primaryPersonLabel: 'helm',
  customFields: [{ id: 'rig', label: 'Rig' }],
  races: [race],
  standings: [
    standing(1, '101', { clubs: ['HYC'], crewNames: ['Crew A'], nationality: 'IRL', boatClass: 'ILCA 7', customFields: { rig: '8.2' } }),
    standing(2, '102', { crewNames: ['Crew B', 'Crew C'], boatClass: 'RS200' }),
  ],
};

/** The heading cells of every table of a class, as text with <br> kept. */
function headers(html: string, table: 'summarytable' | 'racetable'): string[] {
  const m = html.match(new RegExp(`<table class="${table}"[\\s\\S]*?<tr class="titlerow">([\\s\\S]*?)</tr>`));
  if (!m) return [];
  return [...m[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => x[1].replace(/<(?!br)[^>]+>/g, '').replace(/<span.*$/, ''));
}

const withColumns = (resultsColumns: ResultsColumn[], extra: Partial<SeriesResultsData> = {}) =>
  renderSeriesHtml({ ...base, resultsColumns, ...extra });

describe('a series’ own results columns', () => {
  it('puts the columns in its order, Rank among them, under its titles', () => {
    const html = withColumns([
      { key: 'boatClass' },
      { key: 'rank' },
      { key: 'sailNumber', title: 'Bib Number' },
      { key: 'club', title: 'Helm Club' },
      { key: 'primary' },
      { key: 'crewName' },
    ]);
    expect(headers(html, 'summarytable')).toEqual(['Class', 'Rank', 'Bib Number', 'Helm Club', 'Helm', 'Crew', 'R1', 'Total']);
    expect(headers(html, 'racetable').slice(0, 6)).toEqual(['Class', 'Rank', 'Bib Number', 'Helm Club', 'Helm', 'Crew']);
  });

  it('prints a two-line title one line above the other', () => {
    const html = withColumns([{ key: 'rank' }, { key: 'sailNumber' }, { key: 'primary', title: 'Barreur\nHelm' }]);
    expect(headers(html, 'summarytable')).toContain('Barreur<br>Helm');
  });

  it('keeps a column off the tables it isn’t ticked for', () => {
    const html = withColumns([
      { key: 'rank' },
      { key: 'sailNumber' },
      { key: 'primary' },
      { key: 'crewName', tables: ['standings'] },
    ]);
    expect(headers(html, 'summarytable')).toContain('Crew');
    expect(headers(html, 'racetable')).not.toContain('Crew');
  });

  it('leaves off an empty column unless told to print it', () => {
    const cols: ResultsColumn[] = [{ key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' }, { key: 'boatName' }];
    expect(headers(withColumns(cols), 'summarytable')).not.toContain('Boat');
    expect(headers(withColumns([...cols.slice(0, 3), { key: 'boatName', showWhenEmpty: true }]), 'summarytable')).toContain('Boat');
  });

  it('shows a custom field, and nationality as the country’s name', () => {
    const html = withColumns([{ key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' }, { key: 'country' }, { key: 'field:rig' }]);
    expect(headers(html, 'summarytable').slice(3, 5)).toEqual(['Country', 'Rig']);
    expect(html).toContain('<td>Ireland</td>');
    expect(html).toContain('<td>8.2</td>');
  });

  it('puts the crew in the primary column when asked, and joins names on one line', () => {
    const html = withColumns([
      { key: 'rank' },
      { key: 'sailNumber' },
      { key: 'primary' },
      { key: 'crewName', inPrimary: true, joinNames: true },
    ]);
    expect(headers(html, 'summarytable')).toEqual(['Rank', 'Sail Number', 'Helm / Crew', 'R1', 'Total']);
    expect(html).toContain('<td>Helm 101 / Crew A</td>');
    expect(html).toContain('<td>Helm 102 / Crew B &amp; Crew C</td>');
  });

  it('hides and retitles scoring columns, but never moves them', () => {
    const html = withColumns(
      [{ key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' }, { key: 'total', title: 'Points' }, { key: 'points', title: 'Pts' }],
    );
    expect(headers(html, 'summarytable')).toEqual(['Rank', 'Sail Number', 'Helm', 'R1', 'Points']);
    expect(headers(html, 'racetable')).toEqual(['Rank', 'Sail Number', 'Helm', 'Pts']);
    const hidden = withColumns([{ key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' }, { key: 'total', hidden: true }]);
    expect(headers(hidden, 'summarytable')).toEqual(['Rank', 'Sail Number', 'Helm', 'R1']);
  });

  it('drops a column whose field is switched off, or whose custom field is gone', () => {
    const html = withColumns(
      [{ key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' }, { key: 'club' }, { key: 'field:gone' }],
      { enabledCompetitorFields: [] },
    );
    expect(headers(html, 'summarytable')).toEqual(['Rank', 'Sail Number', 'Helm', 'R1', 'Total']);
  });

  it('shows custom fields under automatic columns, after the others', () => {
    const html = renderSeriesHtml(base);
    expect(headers(html, 'summarytable').at(-3)).toBe('Rig');
  });

  it('applies to the entry list, which has no Rank', () => {
    const html = renderCompetitorListHtml(
      { series: { name: 'Champions Cup', venue: 'Howth' } },
      [{ ratingColumns: [], rows: [{ sailNumber: '101', names: ['Helm 101'], clubs: ['HYC'], fleetNames: ['Gold'], customFields: { rig: '8.2' } }] }],
      {
        enabledCompetitorFields: ['club'],
        primaryPersonLabel: 'helm',
        customFields: [{ id: 'rig', label: 'Rig' }],
        resultsColumns: [{ key: 'rank' }, { key: 'field:rig' }, { key: 'sailNumber' }, { key: 'primary' }, { key: 'club', tables: ['standings'] }],
        multiFleet: false,
      },
    );
    expect(headers(html, 'summarytable')).toEqual(['Rig', 'Sail Number', 'Helm']);
  });
});
