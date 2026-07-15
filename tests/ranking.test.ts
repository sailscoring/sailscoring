/**
 * The pure bucketed best-N ranking engine (#209). The reference case is the
 * worked IODAI example from the issue: a National bucket (best 1, min 1) plus
 * a Regional bucket (best 2 of 3, min 2), summed ascending across one
 * combined pool.
 */
import { describe, expect, test } from 'vitest';

import {
  compressPlaces,
  computeRanking,
  formatPlace,
  matchesFleetFilter,
  matchesNationalityFilter,
  type RankingConfig,
  type RankingEntrant,
} from '@/lib/ranking';

const NATIONALS = 'series-nationals';
const SPRINGS = 'series-springs';
const ULSTERS = 'series-ulsters';
const MUNSTERS = 'series-munsters';

const IODAI: RankingConfig = {
  buckets: [
    {
      id: 'national',
      name: 'National',
      seriesIds: [NATIONALS],
      countBest: 1,
      requiredMin: 1,
    },
    {
      id: 'regional',
      name: 'Regional',
      seriesIds: [SPRINGS, ULSTERS, MUNSTERS],
      countBest: 2,
      requiredMin: 2,
    },
  ],
};

function entrant(
  label: string,
  places: Record<string, number>,
  over: Partial<RankingEntrant> = {},
): RankingEntrant {
  return {
    identityId: `id-${label.toLowerCase().replace(/\s+/g, '-')}`,
    label,
    slug: null,
    club: null,
    nationality: 'IRL',
    places: new Map(Object.entries(places)),
    ...over,
  };
}

describe('computeRanking', () => {
  test("the issue's worked example: Senior 8 beats Junior 9 across fleets", () => {
    const { rows } = computeRanking(IODAI, [
      // Junior fleet: 3rd at Nationals, regionals 2nd & 4th (a 6th discarded).
      entrant('Junior Sailor', {
        [NATIONALS]: 3,
        [SPRINGS]: 2,
        [ULSTERS]: 4,
        [MUNSTERS]: 6,
      }),
      // Senior fleet: 2nd at Nationals, regionals 1st & 5th.
      entrant('Senior Sailor', {
        [NATIONALS]: 2,
        [SPRINGS]: 1,
        [MUNSTERS]: 5,
      }),
    ]);
    expect(rows.map((r) => [r.rank, r.label, r.total])).toEqual([
      [1, 'Senior Sailor', 8],
      [2, 'Junior Sailor', 9],
    ]);
    // The Junior's 6th was discarded by best-2 — present in the bucket's
    // places (for the standings-style table) but not counted, and part of
    // the gross total alongside the net.
    const junior = rows[1];
    const regional = junior.buckets.find((b) => b.bucketId === 'regional')!;
    expect(regional.places).toEqual([
      { seriesId: SPRINGS, place: 2, counted: true, adjusted: false },
      { seriesId: ULSTERS, place: 4, counted: true, adjusted: false },
      { seriesId: MUNSTERS, place: 6, counted: false, adjusted: false },
    ]);
    expect(junior.gross).toBe(15); // 3 + 2 + 4 + 6
    // The Senior discarded nothing: gross equals net.
    expect(rows[0].gross).toBe(rows[0].total);
  });

  test('missing a bucket floor excludes from the ladder, into ineligible', () => {
    const { rows, ineligible } = computeRanking(IODAI, [
      entrant('Full Season', { [NATIONALS]: 1, [SPRINGS]: 1, [ULSTERS]: 1 }),
      // Sailed the Nationals but only one regional: regional min 2 unmet.
      entrant('One Regional', { [NATIONALS]: 2, [SPRINGS]: 2 }),
      // Never sailed the Nationals at all: national min 1 unmet.
      entrant('No Nationals', { [SPRINGS]: 1, [ULSTERS]: 2 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Full Season']);
    expect(ineligible.map((i) => i.label)).toEqual([
      'No Nationals',
      'One Regional',
    ]);
  });

  test('entrants with no place in any ranked series are absent entirely', () => {
    const { rows, ineligible } = computeRanking(IODAI, [
      entrant('Elsewhere', { 'series-unrelated': 1 }),
    ]);
    expect(rows).toEqual([]);
    expect(ineligible).toEqual([]);
  });

  test('ties share a rank and order alphabetically; the next rank skips', () => {
    const config: RankingConfig = {
      buckets: [
        {
          id: 'all',
          name: 'All',
          seriesIds: [SPRINGS, ULSTERS],
          countBest: 2,
          requiredMin: 1,
        },
      ],
    };
    const { rows } = computeRanking(config, [
      entrant('Zoe', { [SPRINGS]: 2, [ULSTERS]: 3 }), // 5
      entrant('Anna', { [SPRINGS]: 3, [ULSTERS]: 2 }), // 5
      entrant('Brid', { [SPRINGS]: 1, [ULSTERS]: 1 }), // 2
      entrant('Cara', { [SPRINGS]: 4, [ULSTERS]: 2 }), // 6
    ]);
    expect(rows.map((r) => [r.rank, r.label])).toEqual([
      [1, 'Brid'],
      [2, 'Anna'],
      [2, 'Zoe'],
      [4, 'Cara'],
    ]);
  });

  test('nationality filter drops other flags, case-insensitively', () => {
    const config: RankingConfig = {
      buckets: [
        { id: 'all', name: 'All', seriesIds: [SPRINGS], countBest: 1, requiredMin: 1 },
      ],
      nationality: 'irl',
    };
    const { rows } = computeRanking(config, [
      entrant('Home Sailor', { [SPRINGS]: 2 }, { nationality: 'IRL' }),
      entrant('Visitor', { [SPRINGS]: 1 }, { nationality: 'GBR' }),
      entrant('Unflagged', { [SPRINGS]: 3 }, { nationality: null }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Home Sailor']);
  });

  test('best-N with fewer than N sailed sums what exists (min permitting)', () => {
    const config: RankingConfig = {
      buckets: [
        {
          id: 'opens',
          name: 'Opens',
          seriesIds: [SPRINGS, ULSTERS, MUNSTERS],
          countBest: 2,
          requiredMin: 1,
        },
      ],
    };
    const { rows } = computeRanking(config, [
      entrant('Once Out', { [MUNSTERS]: 4 }),
      entrant('Twice Out', { [SPRINGS]: 3, [ULSTERS]: 5 }),
    ]);
    expect(rows.map((r) => [r.label, r.total])).toEqual([
      ['Once Out', 4],
      ['Twice Out', 8],
    ]);
  });

  test('an adjustment inserts a place for a missed series and grants the floor', () => {
    // The Donagh case: away at the Worlds for the Ulsters, given an averaged
    // 1.5 by the committee. The adjusted place counts toward the bucket
    // floor, enters best-N, and is flagged for the asterisk.
    const config: RankingConfig = {
      buckets: [
        {
          id: 'regional',
          name: 'Regional',
          seriesIds: [SPRINGS, ULSTERS, MUNSTERS],
          countBest: 2,
          requiredMin: 2,
        },
      ],
      adjustments: [
        { identityId: 'id-maeve', seriesId: ULSTERS, place: 1.5, note: 'Worlds team duty' },
      ],
    };
    const { rows, ineligible } = computeRanking(config, [
      entrant('Maeve', { [SPRINGS]: 1 }),
      entrant('Rival', { [SPRINGS]: 2, [MUNSTERS]: 2 }),
    ]);
    expect(ineligible).toEqual([]);
    expect(rows.map((r) => [r.rank, r.label, r.total])).toEqual([
      [1, 'Maeve', 2.5],
      [2, 'Rival', 4],
    ]);
    expect(rows[0].buckets[0].places).toEqual([
      { seriesId: SPRINGS, place: 1, counted: true, adjusted: false },
      { seriesId: ULSTERS, place: 1.5, counted: true, adjusted: true },
    ]);
  });

  test('an adjustment replaces a computed place and can itself be discarded', () => {
    const config: RankingConfig = {
      buckets: [
        {
          id: 'all',
          name: 'All',
          seriesIds: [SPRINGS, ULSTERS],
          countBest: 1,
          requiredMin: 1,
        },
      ],
      adjustments: [
        { identityId: 'id-anna', seriesId: SPRINGS, place: 4, note: 'Scoring review' },
      ],
    };
    const { rows } = computeRanking(config, [
      // Sailed Springs 1st, but the committee reset it to 4th; her Ulsters
      // 2nd now counts and the adjusted 4 is the discard.
      entrant('Anna', { [SPRINGS]: 1, [ULSTERS]: 2 }),
    ]);
    expect(rows[0].total).toBe(2);
    expect(rows[0].buckets[0].places).toEqual([
      { seriesId: ULSTERS, place: 2, counted: true, adjusted: false },
      { seriesId: SPRINGS, place: 4, counted: false, adjusted: true },
    ]);
  });
});

describe('compressPlaces', () => {
  test("the Dylan case: 2nd behind a visitor counts a 1st", () => {
    // Leinsters 2024: GBR sailor 1st, Dylan 2nd.
    const places = compressPlaces([
      { key: 'gbr', rank: 1, matches: false },
      { key: 'dylan', rank: 2, matches: true },
      { key: 'third', rank: 3, matches: true },
    ]);
    expect(places.get('dylan')).toBe(1);
    expect(places.get('third')).toBe(2);
    // Non-matching sailors stop occupying places and get none themselves.
    expect(places.has('gbr')).toBe(false);
  });

  test('ties survive compression', () => {
    // Two matching sailors tied 3rd behind a visitor: both become 2nd.
    const places = compressPlaces([
      { key: 'gbr', rank: 1, matches: false },
      { key: 'a', rank: 2, matches: true },
      { key: 'b', rank: 3, matches: true },
      { key: 'c', rank: 3, matches: true },
      { key: 'd', rank: 5, matches: true },
    ]);
    expect(places.get('a')).toBe(1);
    expect(places.get('b')).toBe(2);
    expect(places.get('c')).toBe(2);
    expect(places.get('d')).toBe(4);
  });
});

describe('matchesNationalityFilter', () => {
  test('no filter passes all; a blank nationality never passes a set one', () => {
    expect(matchesNationalityFilter(null, undefined)).toBe(true);
    expect(matchesNationalityFilter('GBR', undefined)).toBe(true);
    expect(matchesNationalityFilter('irl', 'IRL')).toBe(true);
    expect(matchesNationalityFilter(' IRL ', 'irl')).toBe(true);
    expect(matchesNationalityFilter('GBR', 'IRL')).toBe(false);
    expect(matchesNationalityFilter(null, 'IRL')).toBe(false);
    expect(matchesNationalityFilter('  ', 'IRL')).toBe(false);
  });
});

describe('formatPlace', () => {
  test('whole places stay whole, fractional show one decimal', () => {
    expect(formatPlace(1)).toBe('1');
    expect(formatPlace(1.5)).toBe('1.5');
    expect(formatPlace(13.25)).toBe('13.3');
  });
});

describe('matchesFleetFilter', () => {
  test('no filter passes every fleet, named or not', () => {
    expect(matchesFleetFilter('Junior', undefined)).toBe(true);
    expect(matchesFleetFilter(null, undefined)).toBe(true);
    expect(matchesFleetFilter('Junior', '  ')).toBe(true);
  });

  test('matches by name, case-insensitively and trimmed', () => {
    expect(matchesFleetFilter('Junior', 'junior')).toBe(true);
    expect(matchesFleetFilter(' Junior ', 'JUNIOR')).toBe(true);
    expect(matchesFleetFilter('Senior', 'Junior')).toBe(false);
    expect(matchesFleetFilter(null, 'Junior')).toBe(false);
    expect(matchesFleetFilter('Junior Bronze', 'Junior')).toBe(false);
  });
});
