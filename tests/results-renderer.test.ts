import { describe, it, expect } from 'vitest';
import {
  renderSeriesHtml,
  assembleSeriesResultsData,
  type SeriesResultsData,
  type RaceData,
  type StandingRowData,
} from '@/lib/results-renderer';
import type { ResultCode } from '@/lib/types';

// ---- Fixtures ----

function makeStanding(
  rank: number,
  sail: string,
  helm: string,
  scores: Array<{ points: number; resultCode?: ResultCode; podiumRank?: 1 | 2 | 3 }>,
): StandingRowData {
  const totalPoints = scores.reduce((s, r) => s + r.points, 0);
  return {
    rank,
    sailNumber: sail,
    helm,
    raceScores: scores.map((s) => ({
      points: s.points,
      resultCode: s.resultCode ?? null,
      isDiscard: false,
      podiumRank: s.podiumRank ?? null,
    })),
    totalPoints,
    netPoints: totalPoints,
  };
}

function makeRace(n: number, results: Array<[string, string, number, ResultCode | null]>): RaceData {
  return {
    raceNumber: n,
    date: `2025-06-0${n}`,
    label: `R${n}`,
    anchorId: `r${n}`,
    results: results.map(([sail, helm, points, code], i) => ({
      rank: i + 1,
      sailNumber: sail,
      helm,
      place: code === null ? points : null,
      points,
      resultCode: code,
    })),
  };
}

const MINIMAL: SeriesResultsData = {
  series: { name: 'Test Series', venue: 'Test Venue' },
  races: [
    makeRace(1, [['42', 'Alice', 1, null], ['99', 'Bob', 2, null]]),
    makeRace(2, [['99', 'Bob', 1, null], ['42', 'Alice', 2, null]]),
  ],
  standings: [
    makeStanding(1, '42', 'Alice', [
      { points: 1, podiumRank: 1 },
      { points: 2, podiumRank: 2 },
    ]),
    makeStanding(2, '99', 'Bob', [
      { points: 2, podiumRank: 2 },
      { points: 1, podiumRank: 1 },
    ]),
  ],
};

// ---- renderSeriesHtml ----

describe('renderSeriesHtml', () => {
  it('produces a complete HTML document', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('</html>');
  });

  it('includes series name in title and heading', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('Test Series');
    expect(html).toContain('<h1>Test Series</h1>');
  });

  it('includes venue in h2', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<h2>Test Venue</h2>');
  });

  it('omits h2 when venue is empty', () => {
    const html = renderSeriesHtml({ ...MINIMAL, series: { name: 'X', venue: '' } });
    expect(html).not.toContain('<h2>');
  });

  it('renders summary table with correct ordinal ranks', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('1st');
    expect(html).toContain('2nd');
  });

  it('renders race column headers as links to anchors', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('<a class="racelink" href="#r1">R1</a>');
    expect(html).toContain('<a class="racelink" href="#r2">R2</a>');
  });

  it('renders race detail sections with correct anchor ids', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('id="r1"');
    expect(html).toContain('id="r2"');
  });

  it('applies rank1/rank2/rank3 CSS classes for podium scores', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('class="rank1"');
    expect(html).toContain('class="rank2"');
  });

  it('does not apply rank classes to result-code cells', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      races: [makeRace(1, [['1', 'A', 1, null], ['2', 'B', 2, 'DNC']])],
      standings: [
        makeStanding(1, '1', 'A', [{ points: 1, podiumRank: 1 }]),
        makeStanding(2, '2', 'B', [{ points: 2, resultCode: 'DNC' }]),
      ],
    };
    const html = renderSeriesHtml(data);
    // DNC cell should not get a rank class
    expect(html).not.toMatch(/class="rank\d"[^>]*>2 DNC/);
  });

  it('wraps discarded scores in parentheses and applies discard class', () => {
    const data: SeriesResultsData = {
      series: { name: 'S', venue: '' },
      races: [
        makeRace(1, [['1', 'A', 1, null]]),
        makeRace(2, [['1', 'A', 4, 'DNC']]),
      ],
      standings: [
        {
          rank: 1,
          sailNumber: '1',
          helm: 'A',
          raceScores: [
            { points: 1, resultCode: null, isDiscard: false, podiumRank: 1 },
            { points: 4, resultCode: 'DNC', isDiscard: true, podiumRank: null },
          ],
          totalPoints: 5,
          netPoints: 1,
        },
      ],
    };
    const html = renderSeriesHtml(data);
    expect(html).toContain('(4 DNC)');
    expect(html).toContain('class="discard"');
    // Nett column appears when hasDiscards
    expect(html).toContain('<th>Nett</th>');
  });

  it('omits Nett column when no discards', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('<th>Nett</th>');
  });

  it('includes provisional timestamp when generatedAt is set', () => {
    const html = renderSeriesHtml({
      ...MINIMAL,
      generatedAt: new Date(2025, 5, 14, 19, 30),
    });
    expect(html).toContain('Results are provisional as of');
    expect(html).toContain('2025');
  });

  it('omits provisional line when generatedAt is absent', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).not.toContain('provisional');
  });

  it('includes left logo img when leftLogoUrl is set', () => {
    const html = renderSeriesHtml({ ...MINIMAL, leftLogoUrl: 'https://example.com/logo.png' });
    expect(html).toContain('src="https://example.com/logo.png"');
  });

  it('escapes HTML special characters in names', () => {
    const data: SeriesResultsData = {
      ...MINIMAL,
      series: { name: 'A & B <Series>', venue: '' },
    };
    const html = renderSeriesHtml(data);
    expect(html).toContain('A &amp; B &lt;Series&gt;');
    expect(html).not.toContain('A & B <Series>');
  });

  it('includes Sail Scoring footer link', () => {
    const html = renderSeriesHtml(MINIMAL);
    expect(html).toContain('app.sailscoring.ie');
  });
});

// ---- assembleSeriesResultsData ----

describe('assembleSeriesResultsData', () => {
  const series = { name: 'Test', venue: 'HYC' };
  const races = [
    { id: 'r1', raceNumber: 1, date: '2025-06-01' },
    { id: 'r2', raceNumber: 2, date: '2025-06-08' },
  ];
  const competitors = [
    { id: 'c1', sailNumber: '42', name: 'Alice' },
    { id: 'c2', sailNumber: '99', name: 'Bob' },
  ];
  const competitorsById = new Map(competitors.map((c) => [c.id, c]));

  const standings = [
    {
      rank: 1,
      competitor: { sailNumber: '42', name: 'Alice' },
      racePoints: [1, 2],
      raceCodes: [null, null] as (ResultCode | null)[],
      totalPoints: 3,
    },
    {
      rank: 2,
      competitor: { sailNumber: '99', name: 'Bob' },
      racePoints: [2, 1],
      raceCodes: [null, null] as (ResultCode | null)[],
      totalPoints: 3,
    },
  ];

  const raceScoresByRaceId = new Map([
    ['r1', new Map([
      ['c1', { points: 1, place: 1, resultCode: null as ResultCode | null }],
      ['c2', { points: 2, place: 2, resultCode: null as ResultCode | null }],
    ])],
    ['r2', new Map([
      ['c1', { points: 2, place: 2, resultCode: null as ResultCode | null }],
      ['c2', { points: 1, place: 1, resultCode: null as ResultCode | null }],
    ])],
  ]);

  const now = new Date(2025, 5, 14, 19, 0);

  it('produces correct series metadata', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, now);
    expect(data.series.name).toBe('Test');
    expect(data.series.venue).toBe('HYC');
    expect(data.generatedAt).toBe(now);
  });

  it('produces correct number of races and standings', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, now);
    expect(data.races).toHaveLength(2);
    expect(data.standings).toHaveLength(2);
  });

  it('assigns podiumRank correctly', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, now);
    // Alice: R1=1st, R2=2nd
    expect(data.standings[0].raceScores[0].podiumRank).toBe(1);
    expect(data.standings[0].raceScores[1].podiumRank).toBe(2);
    // Bob: R1=2nd, R2=1st
    expect(data.standings[1].raceScores[0].podiumRank).toBe(2);
    expect(data.standings[1].raceScores[1].podiumRank).toBe(1);
  });

  it('sets isDiscard=false and netPoints=totalPoints for all scores', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, now);
    for (const s of data.standings) {
      expect(s.netPoints).toBe(s.totalPoints);
      for (const score of s.raceScores) {
        expect(score.isDiscard).toBe(false);
      }
    }
  });

  it('race results are sorted by points ascending', () => {
    const data = assembleSeriesResultsData(series, races, standings, raceScoresByRaceId, competitorsById, now);
    const r1 = data.races[0].results;
    expect(r1[0].sailNumber).toBe('42'); // Alice 1pt
    expect(r1[1].sailNumber).toBe('99'); // Bob 2pt
  });
});
