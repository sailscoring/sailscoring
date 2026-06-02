import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHalsailFleet } from '../lib/halsail/parse-results';

const DIR = join(__dirname, '..', 'reference', 'data', '2026-dbsc-summer-series', 'halsail');
const load = (f: string) => parseHalsailFleet(readFileSync(join(DIR, f), 'utf8'));

describe('parseHalsailFleet — Cruisers 1 IRC (Thursday)', () => {
  const fleet = load('c1-irc-95450.html');

  it('reads the fleet title', () => {
    expect(fleet.title).toBe('Cruisers 1 IRC, Thursday Overall');
  });

  it('reads the scored race numbers from the summary', () => {
    expect(fleet.scoredRaceNumbers).toEqual([1, 3, 5, 6]);
  });

  it('parses a known competitor with its IRC TCC', () => {
    const wm = fleet.competitors.find((c) => c.sail === '1242');
    expect(wm).toMatchObject({
      sail: '1242',
      type: 'J109',
      hcap: 1.002,
      name: 'White Mischief',
      club: 'Royal Irish Yacht Club',
    });
  });

  it('keeps only sailed races (1, 3, 5, 6), skipping cancelled/empty ones', () => {
    expect(fleet.races.map((r) => r.raceNumber)).toEqual([1, 3, 5, 6]);
    expect(fleet.races[0].date).toBe('2026-04-23');
  });

  it('distinguishes finishers from coded results within a race', () => {
    const r1 = fleet.races.find((r) => r.raceNumber === 1)!;
    const wm = r1.finishers.find((f) => f.sail === '1242')!;
    expect(wm.finish).toMatch(/^\d{1,2}:\d{2}:\d{2}$/);
    expect(wm.code).toBeNull();
    // Boat 1383 retired/did-not-finish race 1 → coded, no finish time.
    const coded = r1.finishers.find((f) => f.sail === '1383')!;
    expect(coded.finish).toBeNull();
    expect(coded.code).toBeTruthy();
  });
});

describe('parseHalsailFleet — ECHO carries the progressive rating', () => {
  const fleet = load('c1-echo-95452.html');

  it('exposes the applied and next handicap per race (the ECHO seed + step)', () => {
    const r1 = fleet.races.find((r) => r.raceNumber === 1)!;
    const riders = r1.finishers.find((f) => f.sail === '53222')!;
    // Race 1 applied Hcap is the ECHO seed; Next Hcap is the post-race rating.
    expect(riders.hcap).toBe(1.015);
    expect(riders.nextHcap).toBe(1.034);
  });
});
