/**
 * The pure bucketed best-N ranking engine (#209). The reference case is the
 * worked IODAI example from the issue: a National bucket (best 1, min 1) plus
 * a Regional bucket (best 2 of 3, min 2), summed ascending across one
 * combined pool.
 */
import { describe, expect, test } from 'vitest';

import {
  computeRanking,
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
    // The Junior's 6th was discarded by best-2.
    const junior = rows[1];
    const regional = junior.buckets.find((b) => b.bucketId === 'regional')!;
    expect(regional.counted.map((c) => c.place)).toEqual([2, 4]);
    expect(regional.sailed).toBe(3);
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
});
