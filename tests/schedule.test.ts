import { describe, expect, it } from 'vitest';

import { buildSchedule } from '@/lib/schedule';
import type { Fleet, Race, RaceStart } from '@/lib/types';

const fleets: Fleet[] = [
  { id: 'f1', seriesId: 's', name: 'Cruisers 1', displayOrder: 0, scoringSystem: 'irc' },
  { id: 'f2', seriesId: 's', name: 'White Sails', displayOrder: 1, scoringSystem: 'echo' },
];

function race(id: string, raceNumber: number, date: string, name: string | null = null): Race {
  return { id, seriesId: 's', raceNumber, name, date, createdAt: 0 };
}

describe('buildSchedule', () => {
  it('lists every race by date with its guns, sailed or not', () => {
    const schedule = buildSchedule({
      races: [race('r2', 2, '2026-10-18'), race('r1', 1, '2026-10-11', 'Round the Islands')],
      raceStarts: [
        { id: 's2', raceId: 'r1', fleetIds: ['f2'], startTime: '11:00:00' },
        { id: 's1', raceId: 'r1', fleetIds: ['f1'], startTime: '10:55:00' },
      ] as RaceStart[],
      fleets,
      sailedRaceIds: new Set(['r1']),
    });
    expect(schedule).toEqual([
      {
        raceId: 'r1', race: 1, name: 'Round the Islands', date: '2026-10-11', sailed: true,
        starts: [
          { time: '10:55:00', fleetNames: ['Cruisers 1'] },
          { time: '11:00:00', fleetNames: ['White Sails'] },
        ],
      },
      { raceId: 'r2', race: 2, name: null, date: '2026-10-18', sailed: false, starts: [] },
    ]);
  });

  it('keeps a start with no gun, after the timed ones', () => {
    const [r] = buildSchedule({
      races: [race('r1', 1, '2026-10-25')],
      raceStarts: [
        { id: 'a', raceId: 'r1', fleetIds: ['f1', 'f2'] },
        { id: 'b', raceId: 'r1', fleetIds: ['f1'], startTime: '10:30:00' },
      ] as RaceStart[],
      fleets,
      sailedRaceIds: new Set(),
    });
    expect(r.starts).toEqual([
      { time: '10:30:00', fleetNames: ['Cruisers 1'] },
      { time: null, fleetNames: ['Cruisers 1', 'White Sails'] },
    ]);
  });

  it('orders a double-header by race number within the day', () => {
    const schedule = buildSchedule({
      races: [race('b', 7, '2026-10-25'), race('a', 6, '2026-10-25')],
      raceStarts: [],
      fleets,
      sailedRaceIds: new Set(),
    });
    expect(schedule.map((r) => r.race)).toEqual([6, 7]);
  });
});
