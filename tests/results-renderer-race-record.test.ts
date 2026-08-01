/**
 * The race record on published pages (#338/#339).
 *
 * The assembler is where the officials opt-in is applied, so most of these
 * assertions are on `assembleSeriesResultsData` rather than the HTML: the
 * renderer is deliberately incapable of deciding whether a name may be shown,
 * and the tests should fail if that decision ever migrates into it.
 */
import { describe, it, expect } from 'vitest';
import {
  assembleSeriesResultsData,
  renderCombinedSeriesHtml,
  renderSeriesHtml,
  type RaceData,
  type SeriesResultsData,
  type StandingRowData,
} from '@/lib/results-renderer';
import type { RaceConditions, RaceOfficial } from '@/lib/types';

const SERIES_TEAM: RaceOfficial[] = [
  { id: 'o1', role: 'principalRaceOfficer', name: 'Ann Kelly' },
];
const RACE_TEAM: RaceOfficial[] = [
  { id: 'o2', role: 'raceOfficer', name: 'Jane Smith' },
  { id: 'o3', role: 'recorder', name: 'Tom Byrne' },
];
const CONDITIONS: RaceConditions = {
  windSpeedMin: 8,
  windSpeedMax: 14,
  windDirection: 'SW',
  notes: 'Windward-leeward, 3 laps',
};

function makeStanding(): StandingRowData {
  return {
    rank: 1,
    sailNumber: '42',
    helm: ['Alice'],
    raceScores: [{ points: 1, resultCode: null, isDiscard: false, isExcluded: false, podiumRank: 1, penaltyCode: null, penaltyOverride: null, isRedress: false }],
    totalPoints: 1,
    netPoints: 1,
  };
}

function makeRace(extra: Partial<RaceData> = {}): RaceData {
  return {
    raceNumber: 1,
    date: '2026-06-01',
    label: 'R1',
    anchorId: 'r1',
    results: [
      { rank: 1, sailNumber: '42', helm: ['Alice'], place: 1, points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null },
    ],
    ...extra,
  };
}

function makeData(extra: Partial<SeriesResultsData> = {}): SeriesResultsData {
  return {
    series: { name: 'Wave Regatta', venue: 'HYC' },
    enabledCompetitorFields: [],
    races: [makeRace()],
    standings: [makeStanding()],
    ...extra,
  };
}

describe('rendering the race record', () => {
  it('states the conditions above the race table', () => {
    const html = renderSeriesHtml(makeData({ races: [makeRace({ conditions: CONDITIONS })] }));
    expect(html).toContain('class="raceconditions"');
    expect(html).toContain('Wind 8–14 kt SW · Windward-leeward, 3 laps');
  });

  it('names the race management team above the race table', () => {
    const html = renderSeriesHtml(makeData({ races: [makeRace({ officials: RACE_TEAM })] }));
    expect(html).toContain('class="raceofficials"');
    expect(html).toContain('Race Officer: Jane Smith · Recorder: Tom Byrne');
  });

  it('shows the standing team once, under the results stamp', () => {
    const html = renderSeriesHtml(makeData({ officials: SERIES_TEAM }));
    expect(html).toContain('class="seriesofficials"');
    expect(html.match(/Principal Race Officer: Ann Kelly/g)).toHaveLength(1);
  });

  it('shows both levels when both are set — neither shadows the other', () => {
    const html = renderSeriesHtml(
      makeData({ officials: SERIES_TEAM, races: [makeRace({ officials: RACE_TEAM })] }),
    );
    expect(html).toContain('Ann Kelly');
    expect(html).toContain('Jane Smith');
  });

  it('escapes names and notes', () => {
    const html = renderSeriesHtml(
      makeData({
        officials: [{ id: 'o1', role: 'raceOfficer', name: 'A <b>Name</b>' }],
        races: [makeRace({ conditions: { notes: 'Course <2>' } })],
      }),
    );
    expect(html).toContain('A &lt;b&gt;Name&lt;/b&gt;');
    expect(html).toContain('Course &lt;2&gt;');
    expect(html).not.toContain('<b>Name</b>');
  });

  it('emits nothing for a race with no record', () => {
    const html = renderSeriesHtml(makeData());
    expect(html).not.toContain('raceconditions');
    expect(html).not.toContain('raceofficials');
    expect(html).not.toContain('seriesofficials');
  });

  it('carries the standing team onto a combined page', () => {
    const html = renderCombinedSeriesHtml(
      [makeData({ fleetName: 'Cruisers 1', officials: SERIES_TEAM })],
      { pageName: 'Combined' },
    );
    expect(html).toContain('Principal Race Officer: Ann Kelly');
  });
});

describe('the officials opt-in, applied in the assembler', () => {
  const series = { name: 'Wave Regatta', venue: 'HYC' };
  const races = [
    { id: 'r1', raceNumber: 1, date: '2026-06-01', conditions: CONDITIONS, officials: RACE_TEAM },
  ];
  const standings = [
    {
      rank: 1,
      competitor: { id: 'c1', sailNumber: '42', names: ['Alice'] },
      racePoints: [1],
      raceCodes: [null],
      totalPoints: 1,
      netPoints: 1,
      raceDiscards: [false],
    },
  ];
  const raceScores = new Map([
    ['r1', new Map([['c1', { points: 1, place: 1, rank: 1, resultCode: null }]])],
  ]);
  const competitors = new Map([['c1', { sailNumber: '42', names: ['Alice'] }]]);

  function assemble(options: Record<string, unknown>) {
    return assembleSeriesResultsData(
      series, races, standings, raceScores, competitors, [], new Date('2026-06-02T12:00:00Z'),
      undefined, options,
    );
  }

  it('drops both teams when the series has not opted in', () => {
    const data = assemble({ officials: SERIES_TEAM });
    expect(data.officials).toBeUndefined();
    expect(data.races[0].officials).toBeUndefined();
    // Not merely unrendered: no name survives into the render input at all.
    expect(JSON.stringify(data)).not.toContain('Jane Smith');
    expect(renderSeriesHtml(data)).not.toContain('Ann Kelly');
  });

  it('carries both teams once the series has opted in', () => {
    const data = assemble({ officials: SERIES_TEAM, publishOfficials: true });
    expect(data.officials).toEqual(SERIES_TEAM);
    expect(data.races[0].officials).toEqual(RACE_TEAM);
  });

  it('carries conditions either way', () => {
    // Conditions describe the racing, not a person, and are a future ORC
    // scoring input — the officials opt-in has no business gating them.
    expect(assemble({}).races[0].conditions).toEqual(CONDITIONS);
    expect(assemble({ publishOfficials: true }).races[0].conditions).toEqual(CONDITIONS);
  });
});
