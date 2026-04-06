import type { ResultCode, DiscardThreshold } from './types';
import { db } from './db';
import { seriesRepo, competitorRepo, raceRepo, finishRepo } from './dexie-repository';
import { calculateStandings, calculateRaceScores } from './scoring';

// ---- Public export type ----
//
// A stripped-down, public-facing snapshot of a series. Intentionally excludes all
// scorer-private fields: snapshotId, snapshotHistory, ftpHost, ftpPath, bilgeBundle,
// and all internal UUIDs (competitors are keyed by sailNumber instead).

export interface PublicSeriesExport {
  version: 1;
  exportedAt: string;
  series: {
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    discardThresholds: DiscardThreshold[];
    dnfScoring: 'seriesEntries' | 'startingArea';
  };
  competitors: {
    sailNumber: string;
    boatName?: string;
    name: string;
    club: string;
    gender: 'M' | 'F' | '';
    age: number | null;
  }[];
  races: {
    raceNumber: number;
    date: string;
    finishes: {
      sailNumber: string;
      finishPosition: number | null;
      resultCode: ResultCode | null;
      startPresent: boolean | null;
    }[];
  }[];
  standings: {
    rank: number;
    sailNumber: string;
    name: string;
    racePoints: number[];
    raceCodes: (ResultCode | null)[];
    raceDiscards: boolean[];
    totalPoints: number;
    netPoints: number;
  }[];
}

// ---- Builder ----

export async function buildPublicExport(seriesId: string): Promise<PublicSeriesExport | null> {
  const [series, competitors, races] = await Promise.all([
    seriesRepo.get(seriesId),
    competitorRepo.listBySeries(seriesId),
    raceRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const allFinishes = await finishRepo.listBySeries(seriesId, competitors.map((c) => c.id));
  const { standings } = calculateStandings(
    competitors,
    races,
    allFinishes,
    series.discardThresholds,
    series.dnfScoring,
  );

  // Map competitor IDs to sail numbers for denormalising finishes
  const sailNumberById = new Map(competitors.map((c) => [c.id, c.sailNumber]));

  const exportedRaces = races.map((race) => {
    const finishesForRace = allFinishes.filter((f) => f.raceId === race.id);
    // Include all competitors with a finish record for this race
    const raceScores = calculateRaceScores(finishesForRace, competitors, series.dnfScoring);
    const finishes = [...raceScores.entries()].map(([competitorId, score]) => ({
      sailNumber: sailNumberById.get(competitorId) ?? competitorId,
      finishPosition: score.place,
      resultCode: score.resultCode,
      startPresent: finishesForRace.find((f) => f.competitorId === competitorId)?.startPresent ?? null,
    }));
    return { raceNumber: race.raceNumber, date: race.date, finishes };
  });

  const exportedStandings = standings.map((s) => ({
    rank: s.rank,
    sailNumber: s.competitor.sailNumber,
    name: s.competitor.name,
    racePoints: s.racePoints,
    raceCodes: s.raceCodes,
    raceDiscards: s.raceDiscards,
    totalPoints: s.totalPoints,
    netPoints: s.netPoints,
  }));

  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    series: {
      name: series.name,
      venue: series.venue,
      startDate: series.startDate,
      endDate: series.endDate,
      discardThresholds: series.discardThresholds,
      dnfScoring: series.dnfScoring,
    },
    competitors: competitors.map((c) => ({
      sailNumber: c.sailNumber,
      ...(c.boatName ? { boatName: c.boatName } : {}),
      name: c.name,
      club: c.club,
      gender: c.gender,
      age: c.age,
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
 */
export async function importPublicExport(data: PublicSeriesExport): Promise<string> {
  const newSeriesId = crypto.randomUUID();
  const now = Date.now();

  // Map sailNumber → new competitor UUID for finish remapping
  const competitorIdBySail = new Map(data.competitors.map((c) => [c.sailNumber, crypto.randomUUID()]));

  const defaultFleetId = crypto.randomUUID();

  await db.transaction('rw', [db.series, db.fleets, db.competitors, db.races, db.finishes], async () => {
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
      discardThresholds: data.series.discardThresholds,
      dnfScoring: data.series.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      bilgeBundle: null,
      includeJsonExport: true,
    });

    await db.fleets.add({ id: defaultFleetId, seriesId: newSeriesId, name: 'Default', displayOrder: 0, scoringSystem: 'scratch' });

    for (const c of data.competitors) {
      await db.competitors.add({
        id: competitorIdBySail.get(c.sailNumber)!,
        seriesId: newSeriesId,
        fleetIds: [defaultFleetId],
        sailNumber: c.sailNumber,
        ...(c.boatName ? { boatName: c.boatName } : {}),
        name: c.name,
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
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
      for (const finish of race.finishes) {
        const competitorId = competitorIdBySail.get(finish.sailNumber);
        if (!competitorId) continue; // skip unknown sail numbers
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId,
          competitorId,
          finishPosition: finish.finishPosition,
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
