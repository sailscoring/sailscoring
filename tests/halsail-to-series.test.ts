import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseHalsailFleet } from '../lib/halsail/parse-results';
import { buildCruiserDaySeries } from '../lib/halsail/to-series';

const DIR = join(__dirname, '..', 'reference', 'data', '2026-dbsc-summer-series', 'halsail');
const load = (f: string) => parseHalsailFleet(readFileSync(join(DIR, f), 'utf8'));

const file = buildCruiserDaySeries(
  [
    { classNum: 0, echo: load('c0-echo-95445.html'), irc: load('c0-irc-95446.html') },
    { classNum: 1, echo: load('c1-echo-95452.html'), irc: load('c1-irc-95450.html') },
    { classNum: 2, echo: load('c2-echo-95460.html'), irc: load('c2-irc-95458.html') },
    { classNum: 3, echo: load('c3-echo-95466.html') },
  ],
  [
    { fleetId: 'cf-j109', name: 'J/109', parentClass: 1, fleet: load('j109-95454.html') },
    { fleetId: 'cf-sigma33', name: 'Sigma 33', parentClass: 2, fleet: load('sigma33-95462.html') },
  ],
);

describe('buildCruiserDaySeries', () => {
  it('emits a v8 file with no snapshot-lineage fields', () => {
    expect(file.formatVersion).toBe(8);
    expect(file).not.toHaveProperty('snapshotId');
    expect(file).not.toHaveProperty('snapshotHistory');
  });

  it('builds 9 fleets (3 IRC, 4 ECHO, 2 one-design) and the cruiser roster', () => {
    expect(file.fleets.filter((f) => f.scoringSystem === 'irc')).toHaveLength(3);
    expect(file.fleets.filter((f) => f.scoringSystem === 'echo')).toHaveLength(4);
    expect(file.fleets.filter((f) => f.scoringSystem === 'scratch')).toHaveLength(2);
    expect(file.competitors).toHaveLength(37);
  });

  it('puts a J/109 in Cruisers 1 into its IRC, ECHO and one-design fleets', () => {
    const wm = file.competitors.find((c) => c.sailNumber === '1242')!;
    expect(wm.fleetIds).toEqual(expect.arrayContaining(['cf-1-irc', 'cf-1-echo', 'cf-j109']));
    expect(wm.ircTcc).toBe(1.002);
    expect(wm.echoStartingTcf).toBeGreaterThan(0);
  });

  it('configures DBSC scoring (handicap, modified A5.3, sliding discards)', () => {
    expect(file.series.scoringMode).toBe('handicap');
    expect(file.series.dnfScoring).toBe('startingAreaInclDnc');
    expect(file.series.discardThresholds[0]).toEqual({ minRaces: 4, discardCount: 1 });
  });

  it('includes only sailed races; Cruisers 2/3 absent from Race 1', () => {
    expect(file.races.map((r) => r.raceNumber)).toEqual([1, 3, 5, 6]);
    const r1 = file.races.find((r) => r.raceNumber === 1)!;
    // Only Cruisers 0 and 1 start Race 1 (two starts), not C2/C3.
    expect(r1.starts).toHaveLength(2);
  });
});
