import { describe, expect, test } from 'vitest';

import {
  summariseArchive,
  summarisePublicExport,
  summariseSnapshot,
} from '@/lib/publication-summary';
import type { AsPublishedFleetResults } from '@/lib/archive-kit/types';
import type { Fleet, Race } from '@/lib/types';

function race(n: number, date: string): Race {
  return { id: `r${n}`, seriesId: 's', raceNumber: n, name: null, date, createdAt: 0 } as Race;
}

function fleet(name: string, order: number, extra: Partial<Fleet> = {}): Fleet {
  return { id: name, seriesId: 's', name, displayOrder: order, scoringSystem: 'scratch', ...extra } as Fleet;
}

function results(headers: (string | undefined)[], tables = 0): AsPublishedFleetResults {
  return {
    leadColumns: [],
    raceHeaders: headers.map((date, i) => ({ label: `R${i + 1}`, ...(date ? { date } : {}) })),
    summaryColumns: [],
    rows: [],
    ...(tables ? { raceTables: Array.from({ length: tables }, (_, i) => ({ label: `R${i + 1}`, columns: [{ key: 'a', label: 'A' }], rows: [] })) } : {}),
  };
}

describe('summariseSnapshot', () => {
  test('counts races and boats, takes the date range, lists fleets in order', () => {
    const s = summariseSnapshot(
      {
        races: [race(2, '2026-06-13'), race(1, '2026-06-06'), race(3, '')],
        competitors: [{}, {}, {}] as never,
        fleets: [fleet('Class 2', 2, { scoringSystem: 'echo' }), fleet('Class 1', 1, { scoringSystem: 'irc' })],
      },
      false,
    );
    expect(s).toEqual({
      firstRaceDate: '2026-06-06',
      lastRaceDate: '2026-06-13',
      races: 3,
      boats: 3,
      fleets: [
        { name: 'Class 1', scoringSystem: 'irc' },
        { name: 'Class 2', scoringSystem: 'echo' },
      ],
    });
  });

  test('a split-fleet championship leaves its round fleets out and says what it is', () => {
    const s = summariseSnapshot(
      {
        races: [],
        competitors: [],
        fleets: [fleet('Laser', 1), fleet('Yellow', 2, { splitRoundId: 'round-1' })],
      },
      true,
    );
    expect(s.fleets).toEqual([{ name: 'Laser', scoringSystem: 'scratch' }]);
    expect(s.splitFleet).toBe(true);
    expect(s.firstRaceDate).toBeNull();
    expect(s.lastRaceDate).toBeNull();
  });

  test('a race date carrying a time still dates by its day', () => {
    const s = summariseSnapshot(
      { races: [race(1, '2026-06-06T10:00:00Z')], competitors: [], fleets: [] },
      false,
    );
    expect(s.firstRaceDate).toBe('2026-06-06');
  });
});

describe('summarisePublicExport', () => {
  test('reads the data file, naming fleets by their real name and leaving round fleets out', () => {
    const s = summarisePublicExport({
      races: [{ raceNumber: 1, date: '2026-07-04' }, { raceNumber: 2, date: '2026-07-05' }] as never,
      competitors: [{}, {}] as never,
      fleets: [
        { name: 'Gold (2)', label: 'Gold', displayOrder: 1, scoringSystem: 'scratch' },
        { name: 'Yellow', displayOrder: 2, scoringSystem: 'scratch', color: '#ff0' },
      ],
      splitFleets: {} as never,
    });
    expect(s).toEqual({
      firstRaceDate: '2026-07-04',
      lastRaceDate: '2026-07-05',
      races: 2,
      boats: 2,
      fleets: [{ name: 'Gold', scoringSystem: 'scratch' }],
      splitFleet: true,
    });
  });
});

describe('summariseArchive', () => {
  test('races are the widest structural fleet; dates come from the race headers', () => {
    const s = summariseArchive({
      fleets: [
        { name: 'Class 1', results: results(['2019-05-01', '2019-05-08', undefined]) },
        { name: 'Class 2', results: results(['2019-05-01']) },
        { name: 'Overall', displayOnly: true, results: results(['2019-04-01', 'x', 'x', 'x', 'x'] as string[]) },
      ],
      boats: 12,
      startDate: '2019',
    });
    expect(s).toEqual({
      firstRaceDate: '2019-05-01',
      lastRaceDate: '2019-05-08',
      races: 3,
      boats: 12,
      fleets: [{ name: 'Class 1' }, { name: 'Class 2' }],
      asPublished: true,
    });
  });

  test('a race-results-only page counts its race tables', () => {
    expect(summariseArchive({ fleets: [{ name: 'A', results: results([], 2) }], boats: 1 }).races).toBe(2);
  });

  test('falls back to the series dates only when they name a day', () => {
    const dated = summariseArchive({
      fleets: [{ name: 'A', results: results([undefined]) }],
      boats: 1,
      startDate: '2018-08-10',
      endDate: '2018-08-12',
    });
    expect([dated.firstRaceDate, dated.lastRaceDate]).toEqual(['2018-08-10', '2018-08-12']);
    const yearOnly = summariseArchive({
      fleets: [{ name: 'A', results: results([undefined]) }],
      boats: 1,
      startDate: '2018',
    });
    expect(yearOnly.firstRaceDate).toBeNull();
  });
});
