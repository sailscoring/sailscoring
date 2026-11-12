/**
 * Time to win (BCE), rating to win (BCR) and speed over the course: three
 * opt-in race-table columns that solve a handicap race's correction for the
 * winner's corrected time, and divide the course by each boat's time.
 */
import { describe, it, expect } from 'vitest';
import {
  assembleSeriesResultsData,
  ratingToWin,
  ratingToWinText,
  renderSeriesHtml,
  speedKn,
  timeToWinSecs,
  type RaceData,
  type RaceResultData,
  type SeriesResultsData,
} from '@/lib/results-renderer';
import type { ResultsColumn } from '@/lib/types';

type Row = RaceResultData;

function row(sail: string, rank: number | null, extra: Partial<Row> = {}): Row {
  return {
    rank, sailNumber: sail, helm: [`Helm ${sail}`],
    place: rank, points: rank ?? 8, resultCode: null, penaltyCode: null, penaltyOverride: null,
    ...extra,
  };
}

/** A time-on-time row: CT is ET × TCF rounded half-up to the second, as the
 *  engine scores it. */
function timed(sail: string, rank: number | null, tcc: number, et: number, extra: Partial<Row> = {}): Row {
  return row(sail, rank, { tcc, elapsedTimeSecs: et, correctedTimeSecs: Math.round(et * tcc), ...extra });
}

// ISORA 2026 race 01CW1 as #755 quotes it: Darling XX, TCC 1.003, sailed the
// 25 NM in 3:42:15 against a winning corrected time of 3:23:22.
const WINNER = timed('W', 1, 0.962, 12684); // CT 12202 = 3:23:22
const DARLING = timed('DX', 2, 1.003, 13335); // CT 13375 = 3:42:55

const ALL_ON: ResultsColumn[] = [
  { key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' },
  { key: 'timeToWin' }, { key: 'ratingToWin' }, { key: 'speed' },
];

/** `resultsColumns` null: automatic columns. */
function page(results: Row[], extra: Partial<RaceData> = {}, resultsColumns: ResultsColumn[] | null = ALL_ON): string {
  const data: SeriesResultsData = {
    series: { name: 'ISORA', venue: 'Irish Sea' },
    enabledCompetitorFields: [],
    races: [{ raceNumber: 1, date: '2026-04-18', label: 'R1', anchorId: 'r1', results, ...extra }],
    standings: results.map((r, i) => ({
      rank: i + 1, sailNumber: r.sailNumber, helm: r.helm,
      raceScores: [{ points: r.points, resultCode: r.resultCode, isDiscard: false, podiumRank: null, penaltyCode: null, penaltyOverride: null, isRedress: false }],
      totalPoints: r.points, netPoints: r.points,
    })),
    ...(resultsColumns ? { resultsColumns } : {}),
  };
  return renderSeriesHtml(data);
}

/** The race table's headings. */
function headers(html: string): string[] {
  const m = html.match(/<table class="racetable"[\s\S]*?<tr class="titlerow">([\s\S]*?)<\/tr>/);
  return m ? [...m[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((x) => x[1]) : [];
}

/** The cell under `heading` in the row for `sail`. */
function cell(html: string, sail: string, heading: string): string {
  const at = headers(html).indexOf(heading);
  expect(at, `no ${heading} column`).toBeGreaterThanOrEqual(0);
  const tr = html.split('<tr').find((r) => r.includes('racerow') && r.includes(`<td>${sail}</td>`))!;
  return [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1])[at];
}

describe('time to win', () => {
  it('is the elapsed time the boat had to save to tie the winner, truncated to the second', () => {
    // 13,335 − 12,202 ÷ 1.003 = 1,169.4965 s
    expect(timeToWinSecs(DARLING, 12202)).toBe(1169);
    expect(timeToWinSecs(timed('X', 2, 1, 3600), 3000.4)).toBe(599);
  });

  it('is nothing for the winner and for a boat out of the ranking', () => {
    expect(timeToWinSecs(WINNER, 12202)).toBeNull();
    expect(timeToWinSecs(timed('D', null, 1, 3000, { resultCode: 'DSQ' }), 12202)).toBeNull();
  });

  it('scales a lapped boat’s time back to the laps it sailed', () => {
    // PY 1200 on one lap of two: 1,800 s sailed, corrected on 3,600 s.
    const lapped = timed('L', 2, 1000 / 1200, 1800, { courseElapsedTimeSecs: 3600, correctedTimeSecs: 3000, laps: 1 });
    // It needed 2,700 ÷ (1000/1200) = 3,240 s over the course, 1,620 s on its lap.
    expect(timeToWinSecs(lapped, 2700)).toBe(180);
  });
});

describe('rating to win', () => {
  it('is the winner’s corrected time over the boat’s elapsed time', () => {
    expect(ratingToWin(DARLING, 12202)).toBeCloseTo(0.91504, 5);
    expect(ratingToWinText(DARLING, 12202, { decimals: 3 })).toBe('0.915');
  });

  it('is the winner’s own rating for the winner', () => {
    expect(ratingToWinText(WINNER, 12202, { decimals: 3 })).toBe('0.962');
  });

  it('prints a yardstick fleet’s as a whole number', () => {
    const py = timed('P', 2, 1000 / 1100, 3300, { yardstickNumber: 1100 });
    // 1000 × 3,300 ÷ 2,700 = 1,222.2
    expect(ratingToWinText(py, 2700, { decimals: 3 })).toBe('1222');
    const pyWinner = timed('Q', 1, 1000 / 1050, 2835, { yardstickNumber: 1050 });
    expect(ratingToWinText(pyWinner, 2700, { decimals: 3 })).toBe('1050');
  });

  it('uses a lapped boat’s full-course time', () => {
    const lapped = timed('L', 2, 1000 / 1200, 1800, { courseElapsedTimeSecs: 3600, correctedTimeSecs: 3000, yardstickNumber: 1200 });
    expect(ratingToWinText(lapped, 2700, { decimals: 3 })).toBe('1333');
  });

  it('is blank for a coded boat', () => {
    expect(ratingToWinText(timed('D', null, 1, 3000, { resultCode: 'DSQ' }), 12202, { decimals: 3 })).toBe('');
  });
});

describe('speed', () => {
  it('is the course length over the elapsed time', () => {
    expect(speedKn(DARLING, 25)!.toFixed(3)).toBe('6.749');
  });

  it('gives a lapped boat its own share of the course', () => {
    // One lap of a two-lap, 4 NM course in half an hour: 2 NM in 0.5 h.
    expect(speedKn({ elapsedTimeSecs: 1800, courseElapsedTimeSecs: 3600 }, 4)).toBe(4);
  });

  it('is nothing without a distance or a time', () => {
    expect(speedKn(DARLING, undefined)).toBeNull();
    expect(speedKn({}, 25)).toBeNull();
  });
});

describe('the race table', () => {
  it('draws the three columns after Delta when the series turns them on', () => {
    const html = page([WINNER, DARLING], { distanceNm: 25 });
    expect(headers(html).slice(-5)).toEqual(['Delta', 'Time to win', 'Rating to win', 'Speed (kn)', 'Points']);
    expect(cell(html, 'DX', 'Delta')).toBe('0:19:33');
    expect(cell(html, 'DX', 'Time to win')).toBe('0:19:29');
    expect(cell(html, 'DX', 'Rating to win')).toBe('0.915');
    expect(cell(html, 'DX', 'Speed (kn)')).toBe('6.75');
    expect(cell(html, 'W', 'Time to win')).toBe('');
    expect(cell(html, 'W', 'Rating to win')).toBe('0.962');
    expect(cell(html, 'W', 'Speed (kn)')).toBe('7.10');
  });

  it('leaves them off under automatic columns', () => {
    const html = page([WINNER, DARLING], { distanceNm: 25 }, null);
    expect(headers(html)).not.toContain('Time to win');
    expect(headers(html)).not.toContain('Rating to win');
    expect(headers(html)).not.toContain('Speed (kn)');
  });

  it('leaves Speed off a race whose start has no distance', () => {
    const html = page([WINNER, DARLING]);
    expect(headers(html)).toContain('Time to win');
    expect(headers(html)).not.toContain('Speed (kn)');
  });

  it('gives a coded boat its speed but no time or rating to win', () => {
    const dsq = timed('D', null, 1.0, 13000, { resultCode: 'DSQ', points: 8 });
    const html = page([WINNER, DARLING, dsq], { distanceNm: 25 });
    expect(cell(html, 'D', 'Time to win')).toBe('');
    expect(cell(html, 'D', 'Rating to win')).toBe('');
    expect(cell(html, 'D', 'Speed (kn)')).toBe('6.92');
  });

  it('draws no time or rating to win on a time-on-distance race', () => {
    const html = page([timed('A', 1, 600, 3600), timed('B', 2, 620, 3700)], { distanceNm: 6, isOrcTod: true });
    expect(headers(html)).not.toContain('Time to win');
    expect(headers(html)).not.toContain('Rating to win');
    expect(cell(html, 'B', 'Speed (kn)')).toBe('5.84');
  });

  it('takes the series’ own titles', () => {
    const html = page([WINNER, DARLING], { distanceNm: 25 }, [
      { key: 'rank' }, { key: 'sailNumber' }, { key: 'primary' },
      { key: 'timeToWin', title: 'BCE' }, { key: 'ratingToWin', title: 'BCR' }, { key: 'speed', title: 'Ave speed' },
    ]);
    expect(cell(html, 'DX', 'BCE')).toBe('0:19:29');
    expect(cell(html, 'DX', 'BCR')).toBe('0.915');
    expect(cell(html, 'DX', 'Ave speed')).toBe('6.75');
  });
});

describe('assembling a race', () => {
  it('carries the start’s distance and a lapped boat’s full-course time', () => {
    const data = assembleSeriesResultsData(
      { name: 'Club', venue: 'HYC' },
      [{ id: 'r1', raceNumber: 1, date: '2026-06-02' }],
      [],
      new Map([['r1', new Map([
        ['a', { points: 1, place: 1, rank: 1, resultCode: null, tcfApplied: 1, elapsedTime: 2700, correctedTime: 2700, laps: 2 }],
        ['b', { points: 2, place: 2, rank: 2, resultCode: null, tcfApplied: 0.8, elapsedTime: 1800, courseElapsedTime: 3600, correctedTime: 2880, laps: 1 }],
      ])]]),
      new Map([
        ['a', { sailNumber: '1', names: ['A'], fixedTcf: 1 }],
        ['b', { sailNumber: '2', names: ['B'], fixedTcf: 0.8 }],
      ]),
      [],
      new Date('2026-06-02T12:00:00Z'),
      undefined,
      {
        fleetId: 'f1',
        scoringSystem: 'tcf',
        raceStarts: [{ raceId: 'r1', fleetIds: ['f1'], startTime: '10:00:00', distanceNm: 4 }],
      },
    );
    const race = data.races[0];
    expect(race.distanceNm).toBe(4);
    const a = race.results.find((r) => r.sailNumber === '1')!;
    const b = race.results.find((r) => r.sailNumber === '2')!;
    expect(a.courseElapsedTimeSecs).toBeUndefined();
    expect(b.courseElapsedTimeSecs).toBe(3600);
    expect(speedKn(b, race.distanceNm)).toBe(4);
  });
});
