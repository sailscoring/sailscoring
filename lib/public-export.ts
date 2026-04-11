import type { ResultCode, DiscardThreshold, CompetitorFieldKey } from './types';
import { db } from './db';
import { seriesRepo, competitorRepo, raceRepo, finishRepo, fleetRepo, raceStartRepo } from './dexie-repository';
import { calculateFleetStandings, calculateRaceScores } from './scoring';
import { defaultEnabledCompetitorFields } from './competitor-fields';

// ---- Public export type ----
//
// A stripped-down, public-facing snapshot of a series. Intentionally excludes all
// scorer-private fields: snapshotId, snapshotHistory, ftpHost, ftpPath, bilgeBundle,
// and all internal UUIDs (competitors are keyed by sailNumber instead).

export interface PublicSeriesExport {
  version: 2 | 3;
  exportedAt: string;
  series: {
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    discardThresholds: DiscardThreshold[];
    dnfScoring: 'seriesEntries' | 'startingArea';
    /** v3+: which optional competitor fields the scorer has chosen to show.
     *  Display hint for re-renderers; competitor data is still exported in
     *  full regardless of this setting. */
    displayFields?: CompetitorFieldKey[];
    /** v3+: series-level scoring mode (scratch or handicap). */
    scoringMode?: 'scratch' | 'handicap';
  };
  fleets: {
    name: string;
    displayOrder: number;
    scoringSystem: 'scratch' | 'irc' | 'py';
  }[];
  competitors: {
    sailNumber: string;
    boatName?: string;
    name: string;
    crewName?: string;  // v3+
    club: string;
    gender: 'M' | 'F' | '';
    age: number | null;
    fleetNames: string[];
    ircTcc?: number;
    pyNumber?: number;
  }[];
  races: {
    raceNumber: number;
    date: string;
    starts: {
      fleetNames: string[];
      startTime: string;
    }[];
    finishes: {
      sailNumber: string;
      sortOrder: number | null;
      finishTime?: string;
      resultCode: ResultCode | null;
      startPresent: boolean | null;
    }[];
  }[];
  standings: {
    fleetName: string;
    rows: {
      rank: number;
      sailNumber: string;
      name: string;
      racePoints: number[];
      raceCodes: (ResultCode | null)[];
      raceDiscards: boolean[];
      totalPoints: number;
      netPoints: number;
    }[];
  }[];
}

// ---- Builder ----

export async function buildPublicExport(seriesId: string): Promise<PublicSeriesExport | null> {
  const [series, competitors, races, fleets] = await Promise.all([
    seriesRepo.get(seriesId),
    competitorRepo.listBySeries(seriesId),
    raceRepo.listBySeries(seriesId),
    fleetRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const [allFinishes, allRaceStarts] = await Promise.all([
    finishRepo.listBySeries(seriesId, competitors.map((c) => c.id)),
    raceStartRepo.listByRaces(races.map((r) => r.id)),
  ]);

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds,
    series.dnfScoring,
    allRaceStarts,
  );

  // Build fleet name lookup
  const fleetNameById = new Map(fleets.map((f) => [f.id, f.name]));
  const sailNumberById = new Map(competitors.map((c) => [c.id, c.sailNumber]));

  const isSingleDefault = fleets.length <= 1 && fleets[0]?.name === 'Default';

  const exportedRaces = races.map((race) => {
    const finishesForRace = allFinishes.filter((f) => f.raceId === race.id);
    const raceScores = calculateRaceScores(finishesForRace, competitors, series.dnfScoring);
    const finishes = [...raceScores.entries()].map(([competitorId, score]) => {
      const finish = finishesForRace.find((f) => f.competitorId === competitorId);
      return {
        sailNumber: sailNumberById.get(competitorId) ?? competitorId,
        sortOrder: finish?.sortOrder ?? null,
        ...(finish?.finishTime ? { finishTime: finish.finishTime } : {}),
        resultCode: score.resultCode,
        startPresent: finish?.startPresent ?? null,
      };
    });
    const starts = allRaceStarts
      .filter((rs) => rs.raceId === race.id)
      .map((rs) => ({
        fleetNames: rs.fleetIds.map((id) => fleetNameById.get(id) ?? id),
        startTime: rs.startTime,
      }));
    return { raceNumber: race.raceNumber, date: race.date, starts, finishes };
  });

  const exportedStandings = fleetStandings.map(({ fleet, standings }) => ({
    fleetName: isSingleDefault ? 'Default' : fleet.name,
    rows: standings.map((s) => ({
      rank: s.rank,
      sailNumber: s.competitor.sailNumber,
      name: s.competitor.name,
      racePoints: s.racePoints,
      raceCodes: s.raceCodes,
      raceDiscards: s.raceDiscards,
      totalPoints: s.totalPoints,
      netPoints: s.netPoints,
    })),
  }));

  return {
    version: 3 as const,
    exportedAt: new Date().toISOString(),
    series: {
      name: series.name,
      venue: series.venue,
      startDate: series.startDate,
      endDate: series.endDate,
      discardThresholds: series.discardThresholds,
      dnfScoring: series.dnfScoring,
      displayFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
      scoringMode: series.scoringMode ?? 'scratch',
    },
    fleets: fleets.map((f) => ({
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
    })),
    competitors: competitors.map((c) => ({
      sailNumber: c.sailNumber,
      ...(c.boatName ? { boatName: c.boatName } : {}),
      name: c.name,
      ...(c.crewName ? { crewName: c.crewName } : {}),
      club: c.club,
      gender: c.gender,
      age: c.age,
      fleetNames: c.fleetIds.map((id) => fleetNameById.get(id) ?? id),
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
    })),
    races: exportedRaces,
    standings: exportedStandings,
  };
}

// ---- Importer ----

/**
 * Create a new series from a PublicSeriesExport. Fresh UUIDs are assigned to all
 * entities — the imported series has no file history, no snapshot lineage, and no
 * publishing config. Returns the new seriesId.
 *
 * Handles v1 (single-fleet, no handicap data), v2 (multi-fleet, handicap),
 * and v3 (crew names, display hints) formats.
 */
export async function importPublicExport(data: PublicSeriesExport): Promise<string> {
  const newSeriesId = crypto.randomUUID();
  const now = Date.now();

  // Each competitor gets a unique UUID. Key by (sailNumber, fleetNames) to handle
  // collisions where different-fleet boats share a sail number.
  const competitorIdBySailFleet = new Map<string, string>();
  // Secondary sail-only multi-map for finish remapping (finishes lack fleet info).
  const competitorIdsBySail = new Map<string, string[]>();
  for (const c of data.competitors) {
    const fleetNames = (c as { fleetNames?: string[] }).fleetNames ?? [];
    const key = `${c.sailNumber}\0${[...fleetNames].sort().join('\0')}`;
    const id = crypto.randomUUID();
    competitorIdBySailFleet.set(key, id);
    const arr = competitorIdsBySail.get(c.sailNumber);
    if (arr) arr.push(id);
    else competitorIdsBySail.set(c.sailNumber, [id]);
  }
  function competitorKey(sailNumber: string, fleetNames: string[]): string {
    return `${sailNumber}\0${[...fleetNames].sort().join('\0')}`;
  }

  // Build fleet name → new fleet ID map
  const fleetIdByName = new Map<string, string>();
  const exportedFleets = (data as { fleets?: PublicSeriesExport['fleets'] }).fleets ?? [];
  if (exportedFleets.length > 0) {
    for (const f of exportedFleets) {
      fleetIdByName.set(f.name, crypto.randomUUID());
    }
  } else {
    fleetIdByName.set('Default', crypto.randomUUID());
  }

  await db.transaction('rw', [db.series, db.fleets, db.competitors, db.races, db.finishes, db.raceStarts], async () => {
    await db.series.add({
      id: newSeriesId,
      name: data.series.name,
      venue: data.series.venue,
      startDate: data.series.startDate,
      endDate: data.series.endDate,
      venueLogoUrl: '',
      eventLogoUrl: '',
      createdAt: now,
      lastSnapshotId: null,
      lastSavedAt: null,
      lastModifiedAt: now,
      snapshotHistory: [],
      scoringMode: data.series.scoringMode ?? 'scratch',
      discardThresholds: data.series.discardThresholds,
      dnfScoring: data.series.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      bilgeBundle: null,
      includeJsonExport: true,
      enabledCompetitorFields: data.series.displayFields ?? defaultEnabledCompetitorFields(),
    });

    if (exportedFleets.length > 0) {
      for (const f of exportedFleets) {
        await db.fleets.add({
          id: fleetIdByName.get(f.name)!,
          seriesId: newSeriesId,
          name: f.name,
          displayOrder: f.displayOrder,
          scoringSystem: f.scoringSystem,
        });
      }
    } else {
      await db.fleets.add({
        id: fleetIdByName.get('Default')!,
        seriesId: newSeriesId,
        name: 'Default',
        displayOrder: 0,
        scoringSystem: 'scratch',
      });
    }

    for (const c of data.competitors) {
      const cFleetNames = (c as { fleetNames?: string[] }).fleetNames ?? [];
      const fleetIds = cFleetNames.length > 0
        ? cFleetNames.map((n) => fleetIdByName.get(n)).filter((id): id is string => id != null)
        : [fleetIdByName.get('Default')!];
      await db.competitors.add({
        id: competitorIdBySailFleet.get(competitorKey(c.sailNumber, cFleetNames))!,
        seriesId: newSeriesId,
        fleetIds,
        sailNumber: c.sailNumber,
        ...(c.boatName ? { boatName: c.boatName } : {}),
        name: c.name,
        ...((c as { crewName?: string }).crewName ? { crewName: (c as { crewName: string }).crewName } : {}),
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
        ...((c as { ircTcc?: number }).ircTcc != null ? { ircTcc: (c as { ircTcc: number }).ircTcc } : {}),
        ...((c as { pyNumber?: number }).pyNumber != null ? { pyNumber: (c as { pyNumber: number }).pyNumber } : {}),
      });
    }

    for (const race of data.races) {
      const raceId = crypto.randomUUID();
      await db.races.add({
        id: raceId,
        seriesId: newSeriesId,
        raceNumber: race.raceNumber,
        date: race.date,
        createdAt: now,
      });
      // Import race starts (v2)
      const starts = (race as { starts?: { fleetNames: string[]; startTime: string }[] }).starts ?? [];
      for (const start of starts) {
        const startFleetIds = start.fleetNames
          .map((n) => fleetIdByName.get(n))
          .filter((id): id is string => id != null);
        if (startFleetIds.length > 0) {
          await db.raceStarts.add({
            id: crypto.randomUUID(),
            raceId,
            fleetIds: startFleetIds,
            startTime: start.startTime,
          });
        }
      }
      const usedIds = new Set<string>();
      for (const finish of race.finishes) {
        const candidates = competitorIdsBySail.get(finish.sailNumber) ?? [];
        const competitorId = candidates.find((id) => !usedIds.has(id)) ?? candidates[0];
        if (!competitorId) continue;
        usedIds.add(competitorId);
        // Back-compat: older v2 exports used finishPosition; v3 uses sortOrder
        const legacyFinishPosition = (finish as { finishPosition?: number | null }).finishPosition;
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId,
          competitorId,
          sortOrder: finish.sortOrder ?? legacyFinishPosition ?? null,
          ...((finish as { finishTime?: string }).finishTime ? { finishTime: (finish as { finishTime: string }).finishTime } : {}),
          resultCode: finish.resultCode,
          startPresent: finish.startPresent,
          penaltyCode: null,
          penaltyOverride: null,
          redressMethod: null,
          redressExcludeRaces: null,
          redressIncludeRaces: null,
          redressIncludeAllLater: false,
          redressPoints: null,
        });
      }
    }
  });

  return newSeriesId;
}
