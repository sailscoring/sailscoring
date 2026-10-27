import { describe, expect, test } from 'vitest';

import {
  courseResourceOf,
  finishesInOrder,
  raceResourceOf,
  storedWallClock,
} from '@/lib/public-api/workspace-resources';
import type { Finish, Race, RaceStart } from '@/lib/types';

const leg = (distanceNm: number) => ({ distanceNm, bearingDeg: 90, windDirectionDeg: 270 });

describe('the authenticated resources', () => {
  test('a start with no legs has no course', () => {
    expect(courseResourceOf({ id: 's', raceId: 'r', fleetIds: [] })).toBeNull();
  });

  test('a course kept in magnetic says so, and its length is its legs’ unless stated', () => {
    const start: RaceStart = {
      id: 's', raceId: 'r', fleetIds: [],
      courseLegs: [leg(0.66), leg(0.84)],
      course: { name: 'C', north: 'magnetic' },
    };
    expect(courseResourceOf(start)).toMatchObject({ name: 'C', north: 'magnetic', distanceNm: 1.5 });
    expect(courseResourceOf({ ...start, distanceNm: 1.6 })?.distanceNm).toBe(1.6);
    expect(courseResourceOf({ ...start, course: undefined })).toMatchObject({ name: null, north: 'true' });
  });

  test('a race’s starts come in gun order, those with no gun last', () => {
    const race = { id: 'r', seriesId: 'x', raceNumber: 3, name: null, date: '', createdAt: 0 } as Race;
    const starts: RaceStart[] = [
      { id: 'none', raceId: 'r', fleetIds: [] },
      { id: 'late', raceId: 'r', fleetIds: [], startTime: '11:10:00' },
      { id: 'early', raceId: 'r', fleetIds: [], startTime: '11:00:00' },
      { id: 'elsewhere', raceId: 'other', fleetIds: [], startTime: '10:00:00' },
    ];
    const res = raceResourceOf(race, starts);
    expect(res.date).toBeNull();
    expect(res.starts.map((s) => s.id)).toEqual(['early', 'late', 'none']);
  });

  test('finishers in order, then those who didn’t finish', () => {
    const f = (id: string, sortOrder: number | null) => ({ id, sortOrder }) as Finish;
    expect(finishesInOrder([f('dnf', null), f('b', 2), f('a', 1)]).map((x) => x.id)).toEqual(['a', 'b', 'dnf']);
  });

  test('a time given to the minute is stored to the second', () => {
    expect(storedWallClock('11:05')).toBe('11:05:00');
    expect(storedWallClock('11:05:30')).toBe('11:05:30');
  });
});
