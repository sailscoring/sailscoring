/**
 * The #240 acceptance target: import the real 2026 ILCA Leinsters `.blw` and
 * have its ten-prize table allocate correctly — the deterministic predicate
 * (fleet / axis / rank / gender clauses) over our own scored standings.
 *
 * Ground truth: the recipients below are cross-verified against Sailwave's own
 * per-competitor rank (`comprank`, stored in the file) plus each competitor's
 * Cat / HelmSex fields. Note the file's DNF/DNC config is "race finishers +
 * N", which our engine can't represent (the import warns; we score A5.2) — so
 * ~25 mid-table ranks differ from Sailwave's. None of those deltas touches a
 * prize: every one of the ten prizes awards the same boats under both
 * rankings, which is what this fixture pins down.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSailwaveBlw,
  buildSeriesFileFromSailwave,
  type SailwaveImportOptions,
} from '@/lib/sailwave-import';
import { calculateFleetStandings } from '@/lib/scoring';
import { allocatePrizes } from '@/lib/prizes';
import type { Competitor, Finish, Fleet, Race, RaceStart } from '@/lib/types';

const FIXTURE = 'tests/fixtures/sailwave/2026 ILCA Leinsters results.blw';

const OPTS: SailwaveImportOptions = {
  name: '',
  venue: '',
  defaultRaceDate: '2026-06-20',
  primaryLabel: 'helm',
  fleetScoringOverrides: new Map(),
  includeScratchCompanions: true,
  includeResults: true,
};

function loadLeinsters() {
  const bytes = readFileSync(join(process.cwd(), FIXTURE));
  const raw = parseSailwaveBlw(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  const file = buildSeriesFileFromSailwave(raw, OPTS);

  const fleets: Fleet[] = file.fleets.map((f) => ({
    id: f.id,
    seriesId: file.seriesId,
    name: f.name,
    displayOrder: f.displayOrder,
    scoringSystem: f.scoringSystem,
  }));
  const competitors: Competitor[] = file.competitors.map((c) => ({
    ...c,
    seriesId: file.seriesId,
    createdAt: 0,
  })) as Competitor[];
  const races: Race[] = file.races.map((r) => ({
    id: r.id,
    seriesId: file.seriesId,
    raceNumber: r.raceNumber,
    name: r.name ?? null,
    date: r.date,
    createdAt: 0,
  }));
  const raceStarts: RaceStart[] = file.races.flatMap((r) =>
    r.starts.map((s) => ({ id: s.id, raceId: r.id, fleetIds: s.fleetIds, startTime: s.startTime })),
  );
  const finishes: Finish[] = file.races.flatMap((r) =>
    r.finishes.map((f) => ({
      id: f.id,
      raceId: r.id,
      competitorId: f.competitorId,
      unknownSailNumber: f.unknownSailNumber,
      sortOrder: f.sortOrder,
      tiedWithPrevious: f.tiedWithPrevious ?? false,
      finishTime: f.finishTime,
      resultCode: f.resultCode,
      startPresent: f.startPresent,
      penaltyCode: f.penaltyCode,
      penaltyOverride: f.penaltyOverride,
      redressMethod: null,
      redressExcludeRaceIds: null,
      redressIncludeRaceIds: null,
      redressIncludeAllLater: false,
      redressPoints: null,
    })),
  );

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    finishes,
    file.series.discardThresholds,
    file.series.dnfScoring,
    raceStarts,
  );
  return { raw, file, fleetStandings };
}

/** The prize list as it should read at the prize-giving: [sailNo, helm] per
 *  place, in prize order. */
const EXPECTED: Record<string, [string, string][]> = {
  'ILCA 7: Overall 1st, 2nd, 3rd': [
    ['163459', 'Jules Kerr'],
    ['211133', 'Riley Joyce'],
    ['227049', 'Casey Zane'],
  ],
  'ILCA 7: Master 1st, 2nd, 3rd': [
    ['163459', 'Jules Kerr'],
    ['219804', 'Devon Dunne'],
    ['223953', 'Kai Sloane'],
  ],
  'ILCA 7: Youth 1st': [['204045', 'Skyler Tate']],
  'ILCA 6: Overall 1st, 2nd, 3rd': [
    ['218869', 'Reese Ives'],
    ['223326', 'Jamie Pryce'],
    ['223341', 'Emerson Byrne'],
  ],
  'ILCA 6: Silver 1st, 2nd, 3rd': [],
  'ILCA 6: Lady 1st, 2nd, 3rd': [
    ['216116', 'Parker Bell'],
    ['210100', 'Jules Kerr'],
    ['224488', 'Taylor Ward'],
  ],
  'ILCA 6: Master 1st, 2nd, 3rd': [
    ['206890', 'Frankie Mason'],
    ['211171', 'Lane Crowe'],
    ['204042', 'Harper Flynn'],
  ],
  'ILCA 4: Overall 1st, 2nd, 3rd': [
    ['208735', 'Hayden Read'],
    ['211091', 'Alex Ash'],
    ['224480', 'Blake Oakes'],
  ],
  'ILCA 4: Silver 1st, 2nd, 3rd': [],
  'ILCA 4: Lady 1st, 2nd, 3rd': [
    ['208735', 'Hayden Read'],
    ['215244', 'Jordan Frost'],
    ['1211260', 'Jamie Pryce'],
  ],
};

describe('2026 ILCA Leinsters — the #240 baseline, end to end', () => {
  const { raw, file, fleetStandings } = loadLeinsters();
  const allocations = allocatePrizes(
    file.series.prizes ?? [],
    fleetStandings,
    file.series.subdivisionAxes ?? [],
  );

  it('imports all ten prizes in Sailwave order', () => {
    expect(allocations.map((a) => a.prize.name)).toEqual(Object.keys(EXPECTED));
  });

  it('every Overall podium matches Sailwave’s own ranks exactly', () => {
    const comps = Object.values(raw.competitors ?? {}).filter((c) => c.compexclude !== '1');
    for (const fs of fleetStandings) {
      const swTop3 = comps
        .filter((c) => (c.compfleet ?? '') === fs.fleet.name && Number(c.comprank) >= 1 && Number(c.comprank) <= 3)
        .sort((a, b) => Number(a.comprank) - Number(b.comprank))
        .map((c) => c.compsailno);
      expect(
        fs.standings.slice(0, 3).map((s) => s.competitor.sailNumber),
        fs.fleet.name,
      ).toEqual(swTop3);
    }
  });

  it('allocates each prize to the published recipients', () => {
    for (const a of allocations) {
      const got = a.recipients.map((r) => [r.standing.competitor.sailNumber, r.standing.competitor.name]);
      expect(got, a.prize.name).toEqual(EXPECTED[a.prize.name]);
    }
  });

  it('the Silver prizes surface "field has no data", not a silent empty award', () => {
    // The scorer configured Silver prizes but recorded no Division values —
    // the exact empty-field case #240 calls out.
    for (const name of ['ILCA 6: Silver 1st, 2nd, 3rd', 'ILCA 4: Silver 1st, 2nd, 3rd']) {
      const a = allocations.find((x) => x.prize.name === name)!;
      expect(a.eligibleCount).toBe(0);
      expect(a.warnings.some((w) => w.kind === 'axis-no-data')).toBe(true);
    }
  });

  it('the Lady prizes filter on the imported helm gender', () => {
    const lady6 = allocations.find((a) => a.prize.name === 'ILCA 6: Lady 1st, 2nd, 3rd')!;
    // Five female helms in ILCA 6 — all eligible, top three awarded.
    expect(lady6.eligibleCount).toBe(5);
    expect(lady6.recipients.every((r) => r.standing.competitor.gender === 'F')).toBe(true);
  });
});
