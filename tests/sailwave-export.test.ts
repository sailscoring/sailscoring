import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSailwaveBlw,
  buildSeriesFileFromSailwave,
  type SailwaveImportOptions,
} from '@/lib/sailwave-import';
import {
  buildSailwaveBlw,
  discardListFor,
  encodeWindows1252,
} from '@/lib/sailwave-export';
import type { SeriesFile } from '@/lib/series-file';

const HYC = 'tests/fixtures/sailwave/hyc-2026';

const OPTS: SailwaveImportOptions = {
  name: 'Round trip',
  venue: 'HYC',
  defaultRaceDate: '2026-05-05',
  primaryLabel: 'helm',
  fleetScoringOverrides: new Map(),
  includeScratchCompanions: true,
  includeResults: true,
};

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function importFixture(path: string): SeriesFile {
  const bytes = readFileSync(join(process.cwd(), path));
  return buildSeriesFileFromSailwave(parseSailwaveBlw(toArrayBuffer(bytes)), OPTS);
}

/** Export a SeriesFile to `.blw` and read it back through the importer. */
function roundTrip(file: SeriesFile) {
  const { blw, warnings } = buildSailwaveBlw(file);
  const back = buildSeriesFileFromSailwave(
    parseSailwaveBlw(toArrayBuffer(encodeWindows1252(blw))),
    OPTS,
  );
  return { blw, warnings, back };
}

/** The scoring inputs of a SeriesFile in a form that ignores ids and ordering
 *  noise — what has to survive the trip to Sailwave and back. */
function digest(file: SeriesFile) {
  const fleetName = new Map(file.fleets.map((f) => [f.id, f.name]));
  const fleets = file.fleets
    .map((f) => `${f.name}=${f.scoringSystem}`)
    .sort();
  const competitors = file.competitors
    .map((c) => ({
      sail: c.sailNumber,
      name: c.names.join(' & '),
      boat: c.boatName ?? '',
      fleets: c.fleetIds.map((id) => fleetName.get(id)).sort(),
      irc: c.ircTcc ?? null,
      nhc: c.nhcStartingTcf ?? null,
      py: c.pyNumber ?? null,
      excluded: c.excluded ?? false,
    }))
    .sort((a, b) => a.sail.localeCompare(b.sail) || a.name.localeCompare(b.name));
  const sailOf = new Map(file.competitors.map((c) => [c.id, c.sailNumber]));
  const races = file.races
    .map((r) => ({
      n: r.raceNumber,
      date: r.date,
      starts: r.starts
        .flatMap((s) => s.fleetIds.map((id) => `${fleetName.get(id)}@${s.startTime ?? ''}`))
        .sort(),
      finishers: r.finishes
        .filter((f) => f.sortOrder != null)
        .sort((a, b) => a.sortOrder! - b.sortOrder!)
        .map((f) => `${sailOf.get(f.competitorId!)}@${f.finishTime ?? ''}`),
      coded: r.finishes
        .filter((f) => f.sortOrder == null && f.resultCode !== 'DNC')
        .map((f) => `${sailOf.get(f.competitorId!)}:${f.resultCode}${f.redressPoints != null ? `=${f.redressPoints}` : ''}`)
        .sort(),
    }))
    .sort((a, b) => a.n - b.n);
  return {
    fleets,
    competitors,
    races,
    discards: file.series.discardThresholds,
    dnf: file.series.dnfScoring,
  };
}

describe('buildSailwaveBlw', () => {
  it.each([
    '2026 Sat Cruisers Series 1.blw',
    '2026 Tues Series 1.blw',
    '2026 Wed Series 1.blw',
    '2026 Dinghies Series 1.blw',
  ])('round-trips %s through the importer unchanged', (name) => {
    const original = importFixture(`${HYC}/${name}`);
    const { back, warnings } = roundTrip(original);
    expect(digest(back)).toEqual(digest(original));
    expect(warnings).toEqual([]);
  });

  it('writes Sailwave-shaped rows: quoted, CRLF, four columns', () => {
    const original = importFixture(`${HYC}/2026 Tues Series 1.blw`);
    const { blw } = roundTrip(original);
    const rows = blw.split('\r\n').filter(Boolean);
    expect(rows[0]).toMatch(/^"ser[a-z]+","[^"]*","",""$/);
    expect(rows.every((r) => r.startsWith('"'))).toBe(true);
    expect(rows.some((r) => r.startsWith('"serversion","2.38.02"'))).toBe(true);
    expect(rows.filter((r) => r.startsWith('"column"'))).toHaveLength(213);
  });

  it('writes a cell for every record in every race, empty where nothing was recorded', () => {
    // Sailwave refuses a file with "missing results" and repairs it by adding
    // the empty cells itself; write them up front.
    const original = importFixture(`${HYC}/2026 Tues Series 1.blw`);
    const { blw } = roundTrip(original);
    const rows = blw.split('\r\n');
    const records = rows.filter((r) => r.startsWith('"compsailno"')).length;
    const races = rows.filter((r) => r.startsWith('"racerank"')).length;
    const cells = rows.filter((r) => r.startsWith('"rrestyp"'));
    expect(cells).toHaveLength(records * races);
    expect(cells.some((r) => r.startsWith('"rrestyp","0"'))).toBe(true);
    expect(rows.filter((r) => r.startsWith('"compmedicalflag","0"'))).toHaveLength(records);
    expect(rows.some((r) => r.startsWith('"comprating",""'))).toBe(false);
  });

  it('models a boat in two fleets as a primary record plus an alias', () => {
    const original = importFixture(`${HYC}/2026 Tues Series 1.blw`);
    const dual = original.competitors.find((c) => c.fleetIds.length === 2)!;
    expect(dual).toBeDefined();
    const { blw } = roundTrip(original);
    const rows = blw.split('\r\n');
    const sailRows = rows.filter((r) => r.startsWith(`"compsailno","${dual.sailNumber}"`));
    expect(sailRows).toHaveLength(2);
    const handles = sailRows.map((r) => r.split('","')[2].replace(/"/g, ''));
    expect(rows).toContain(`"compalias","0","${handles[0]}",""`);
    expect(rows).toContain(`"compalias","${handles[0]}","${handles[1]}",""`);
  });

  it('sets the DNC / DNF bases from the series A5 choice', () => {
    const original = importFixture(`${HYC}/2026 Sat Cruisers Series 1.blw`);
    const a52 = buildSailwaveBlw({ ...original, series: { ...original.series, dnfScoring: 'seriesEntries' } }).blw;
    expect(a52).toContain('"scrcode","DNF|Boats in series +|1|');
    const a53 = buildSailwaveBlw({ ...original, series: { ...original.series, dnfScoring: 'startingArea' } }).blw;
    expect(a53).toContain('"scrcode","DNF|Boats in race +|1|');
    expect(a53).toContain('"scrcode","DNC|Boats in series +|1|');
  });

  it('reports what Sailwave cannot carry instead of dropping it silently', () => {
    const original = importFixture(`${HYC}/2026 Sat Cruisers Series 1.blw`);
    const race = original.races[0];
    const modified: SeriesFile = {
      ...original,
      races: [{ ...race, pointsMultiplier: 2, discardPolicy: 'mustCount' }, ...original.races.slice(1)],
      subSeries: [{ id: 's', name: 'Spring', raceIds: [race.id], discardThresholds: [], dnfScoring: 'seriesEntries', displayOrder: 0 } as unknown as NonNullable<SeriesFile['subSeries']>[number]],
    };
    const { warnings } = buildSailwaveBlw(modified);
    expect(warnings.map((w) => w.code).sort()).toEqual(['discard-policy', 'points-multiplier', 'sub-series']);
  });
});

describe('buildSailwaveBlw unrated boats', () => {
  it('warns once per fleet about boats with no rating for it', () => {
    const original = importFixture(`${HYC}/2026 Sat Cruisers Series 1.blw`);
    const irc = original.fleets.find((f) => f.scoringSystem === 'irc')!;
    const boats = original.competitors.filter((c) => c.fleetIds.includes(irc.id));
    expect(boats.length).toBeGreaterThan(0);
    const stripped: SeriesFile = {
      ...original,
      competitors: original.competitors.map((c) => {
        if (!c.fleetIds.includes(irc.id)) return c;
        const { ircTcc: _drop, ...rest } = c;
        return rest;
      }),
    };
    const { warnings } = buildSailwaveBlw(stripped);
    const noRating = warnings.filter((w) => w.code === 'no-rating');
    expect(noRating).toHaveLength(1);
    expect(noRating[0].message).toContain(`Fleet "${irc.name}"`);
    for (const b of boats) expect(noRating[0].message).toContain(b.sailNumber);
  });
});

describe('discardListFor', () => {
  it('expands thresholds into a cumulative per-race list with headroom', () => {
    expect(discardListFor([{ minRaces: 4, discardCount: 1 }, { minRaces: 8, discardCount: 2 }], undefined, 7))
      .toBe('0,0,0,1,1,1,1,2,2,2,2,2,2,2,2,2,2,2');
  });
  it('expands a proportional rule', () => {
    expect(discardListFor([], { firstAt: 3, everyRaces: 3 }, 2).split(',').slice(0, 9))
      .toEqual(['0', '0', '1', '1', '1', '2', '2', '2', '3']);
  });
});

describe('encodeWindows1252', () => {
  it('maps Latin-1 and the cp1252 extras, and replaces the rest', () => {
    expect([...encodeWindows1252('Ó€a–')]).toEqual([0xd3, 0x80, 0x61, 0x96]);
    expect([...encodeWindows1252('☃')]).toEqual([0x3f]);
  });
});
