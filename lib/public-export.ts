import type { ResultCode, PenaltyCode, DiscardThreshold, CompetitorFieldKey, PrimaryPersonLabel } from './types';
import { db } from './db';
import { seriesRepo, competitorRepo, raceRepo, finishRepo, fleetRepo, raceStartRepo, listSeriesNames } from './dexie-repository';
import { calculateFleetStandings, calculateRaceScores } from './scoring';
import { defaultEnabledCompetitorFields, DEFAULT_PRIMARY_PERSON_LABEL } from './competitor-fields';
import { disambiguateSeriesName } from './series-name';

// ---- Public export type ----
//
// A stripped-down, public-facing snapshot of a series. Intentionally excludes all
// scorer-private fields: snapshotId, snapshotHistory, ftpHost, ftpPath, bilgeBundle,
// and all internal UUIDs (competitors are keyed by sailNumber instead).

/** Start sequence group as it appears in the public export. Refers to fleets
 *  by name rather than by internal UUID (mirroring how `races[].starts` does).
 *  Unlike the internal `StartGroup`, the public schema carries cumulative
 *  minutes from the first start — unambiguous in JSON-as-data, and stable for
 *  downstream consumers (e.g. bilge). The export converts intervals → cumulative
 *  on the way out, and the importer converts cumulative → intervals on the way in. */
export interface ExportStartGroup {
  fleetNames: string[];
  offsetMinutes: number;
}

export interface PublicSeriesExport {
  version: 1;
  exportedAt: string;
  series: {
    name: string;
    venue: string;
    startDate: string;
    endDate: string;
    venueLogoUrl?: string;
    eventLogoUrl?: string;
    discardThresholds: DiscardThreshold[];
    dnfScoring: 'seriesEntries' | 'startingArea';
    /** Which optional competitor fields the scorer has chosen to show.
     *  Display hint for re-renderers; competitor data is still exported in
     *  full regardless of this setting. */
    displayFields: CompetitorFieldKey[];
    /** Label for the primary person slot (`Competitor.name`). Display hint —
     *  "competitor" / "entrant" / "helm" / "owner". Absent in exports produced
     *  by older builds; importers default to "competitor". */
    primaryPersonLabel?: PrimaryPersonLabel;
    scoringMode: 'scratch' | 'handicap';
    /** NHC publish-rating-calculations toggle (display hint). */
    publishRatingCalculations?: boolean;
    /** Default start sequence used when new races are created. */
    defaultStartSequence?: ExportStartGroup[];
  };
  fleets: {
    name: string;
    displayOrder: number;
    scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
    /** NHC blend rate α (present iff scoringSystem === 'nhc'). */
    nhcAlpha?: number;
    /** ECHO blend rate α (present iff scoringSystem === 'echo'). */
    echoAlpha?: number;
  }[];
  competitors: {
    sailNumber: string;
    boatName?: string;
    boatClass?: string;
    name: string;
    /** Owner, when recorded separately from the primary (helm-primary series). */
    owner?: string;
    /** Helm, when recorded separately from the primary (owner-primary series). */
    helm?: string;
    crewName?: string;
    club: string;
    gender: 'M' | 'F' | '';
    age: number | null;
    fleetNames: string[];
    ircTcc?: number;
    pyNumber?: number;
    /** NHC starting TCF (race-1 input). */
    nhcStartingTcf?: number;
    /** ECHO starting handicap (race-1 input). */
    echoStartingTcf?: number;
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
      /** Set when the finish is unresolved (scorer recorded a crossing
       *  but no matching competitor). When present, `sailNumber` is empty. */
      unknownSailNumber?: string;
      sortOrder: number | null;
      finishTime?: string;
      resultCode: ResultCode | null;
      startPresent: boolean | null;
      /** Additive penalty applied on top of the finish (ZFP/SCP/DPI). */
      penaltyCode?: PenaltyCode | null;
      /** SCP %, DPI points, or null to use code default. */
      penaltyOverride?: number | null;
      /** Redress (RDG) configuration — all fields together reproduce
       *  the A9 average. Present iff resultCode === 'RDG'. */
      redressMethod?: 'all_races' | 'races_before' | 'stated' | null;
      redressExcludeRaces?: number[] | null;
      redressIncludeRaces?: number[] | null;
      redressIncludeAllLater?: boolean;
      redressPoints?: number | null;
    }[];
    /** NHC per-fleet scoring intermediates for this race (one entry per NHC
     *  fleet, keyed by fleet name). Carries the fleet-race aggregates used in
     *  the explainability fleet header line, plus the per-boat intermediate
     *  calculations needed to reproduce New TCF. */
    nhcByFleet?: Record<string, NhcRaceFleetExport>;
    /** ECHO per-fleet scoring intermediates for this race (one entry per
     *  ECHO fleet, keyed by fleet name). Carries the IS-formula fleet
     *  inputs (ΣH_S, Σ(1/T_E)) so a downstream consumer can reproduce
     *  PI = ΣH_S / (T_E × Σ(1/T_E)) directly. */
    echoByFleet?: Record<string, EchoRaceFleetExport>;
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
      racePenaltyCodes: (PenaltyCode | null)[];
      racePenaltyOverrides: (number | null)[];
      raceNonDiscardable: boolean[];
      raceRedressFlags: boolean[];
      totalPoints: number;
      netPoints: number;
    }[];
  }[];
}

/** Per-(race, fleet) NHC scoring details for the public export. */
export interface NhcRaceFleetExport {
  alpha: number;
  finisherCount: number;
  ctAvgSecs: number;
  meanTcf: number;
  rows: {
    sailNumber: string;
    tcfApplied: number;
    newTcf: number;
    /** Intermediates present iff the boat finished this race. */
    ctRatio?: number;
    fairTcf?: number;
    adjustment?: number;
  }[];
}

/** Per-(race, fleet) ECHO scoring details for the public export.
 *  Same per-row shape as NHC; the fleet-level header carries the
 *  IS-formula inputs (sumH, sumReciprocalEt) and the suppression flag. */
export interface EchoRaceFleetExport {
  alpha: number;
  finisherCount: number;
  ctAvgSecs: number;
  meanTcf: number;
  /** ΣH_S — sum of starting handicaps across finishers. */
  sumH: number;
  /** Σ(1/T_E) — sum of reciprocals of elapsed times across finishers. */
  sumReciprocalEt: number;
  /** True when the IS guide's ≤2-finisher gate fired (no rating update). */
  updateSuppressed: boolean;
  rows: {
    sailNumber: string;
    tcfApplied: number;
    newTcf: number;
    /** Intermediates present iff the boat finished this race. */
    ctRatio?: number;
    fairTcf?: number;        // = PI_i in IS notation
    adjustment?: number;
    /** 1/T_E_i in seconds⁻¹ — present iff the boat finished. Lets a
     *  consumer verify Σ(1/T_E) by summing the column. */
    reciprocalEt?: number;
  }[];
}

// ---- Builder ----

/**
 * Repository surface needed to read a series for export.
 * Callers pass the runtime-selected backend (dexie or api), so the
 * export path works in either mode.
 */
export interface ExportRepos {
  seriesRepo: typeof seriesRepo;
  competitorRepo: typeof competitorRepo;
  raceRepo: typeof raceRepo;
  fleetRepo: typeof fleetRepo;
  finishRepo: typeof finishRepo;
  raceStartRepo: typeof raceStartRepo;
}

export async function buildPublicExport(
  seriesId: string,
  repos: ExportRepos = { seriesRepo, competitorRepo, raceRepo, fleetRepo, finishRepo, raceStartRepo },
): Promise<PublicSeriesExport | null> {
  const [series, competitors, races, fleets] = await Promise.all([
    repos.seriesRepo.get(seriesId),
    repos.competitorRepo.listBySeries(seriesId),
    repos.raceRepo.listBySeries(seriesId),
    repos.fleetRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const [allFinishes, allRaceStarts] = await Promise.all([
    repos.finishRepo.listBySeries(seriesId, competitors.map((c) => c.id)),
    repos.raceStartRepo.listByRaces(races.map((r) => r.id)),
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

  // For each NHC fleet, index per-race scores + aggregates by raceId for fast lookup below.
  const nhcByFleetByRaceId = new Map<string, Map<string, NhcRaceFleetExport>>();
  for (const fr of fleetStandings) {
    if (!fr.nhcRaceScoresByRaceId || !fr.nhcAggregatesByRaceId) continue;
    const fleetName = isSingleDefault ? 'Default' : fr.fleet.name;
    for (const [raceId, scores] of fr.nhcRaceScoresByRaceId) {
      const agg = fr.nhcAggregatesByRaceId.get(raceId);
      if (!agg) continue;
      const rows = [...scores.entries()]
        .filter(([, s]) => s.tcfApplied != null && s.newTcf != null)
        .map(([cid, s]) => ({
          sailNumber: sailNumberById.get(cid) ?? cid,
          tcfApplied: s.tcfApplied!,
          newTcf: s.newTcf!,
          ...(s.nhc ? { ctRatio: s.nhc.ctRatio, fairTcf: s.nhc.fairTcf, adjustment: s.nhc.adjustment } : {}),
        }));
      const entry: NhcRaceFleetExport = {
        alpha: agg.alpha,
        finisherCount: agg.finisherCount,
        ctAvgSecs: agg.ctAvg,
        meanTcf: agg.meanTcf,
        rows,
      };
      const byFleet = nhcByFleetByRaceId.get(raceId) ?? new Map();
      byFleet.set(fleetName, entry);
      nhcByFleetByRaceId.set(raceId, byFleet);
    }
  }

  // Same indexing for ECHO fleets.
  const echoByFleetByRaceId = new Map<string, Map<string, EchoRaceFleetExport>>();
  for (const fr of fleetStandings) {
    if (!fr.echoRaceScoresByRaceId || !fr.echoAggregatesByRaceId) continue;
    const fleetName = isSingleDefault ? 'Default' : fr.fleet.name;
    for (const [raceId, scores] of fr.echoRaceScoresByRaceId) {
      const agg = fr.echoAggregatesByRaceId.get(raceId);
      if (!agg) continue;
      const rows = [...scores.entries()]
        .filter(([, s]) => s.tcfApplied != null && s.newTcf != null)
        .map(([cid, s]) => ({
          sailNumber: sailNumberById.get(cid) ?? cid,
          tcfApplied: s.tcfApplied!,
          newTcf: s.newTcf!,
          ...(s.echo ? { ctRatio: s.echo.ctRatio, fairTcf: s.echo.fairTcf, adjustment: s.echo.adjustment } : {}),
          ...(s.elapsedTime != null && s.elapsedTime > 0 && s.resultCode == null ? { reciprocalEt: 1 / s.elapsedTime } : {}),
        }));
      const entry: EchoRaceFleetExport = {
        alpha: agg.alpha,
        finisherCount: agg.finisherCount,
        ctAvgSecs: agg.ctAvg,
        meanTcf: agg.meanTcf,
        sumH: agg.sumH,
        sumReciprocalEt: agg.sumReciprocalEt,
        updateSuppressed: agg.updateSuppressed,
        rows,
      };
      const byFleet = echoByFleetByRaceId.get(raceId) ?? new Map();
      byFleet.set(fleetName, entry);
      echoByFleetByRaceId.set(raceId, byFleet);
    }
  }

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
        ...(finish?.penaltyCode ? { penaltyCode: finish.penaltyCode } : {}),
        ...(finish?.penaltyOverride != null ? { penaltyOverride: finish.penaltyOverride } : {}),
        ...(finish?.resultCode === 'RDG' ? {
          redressMethod: finish.redressMethod,
          ...(finish.redressExcludeRaces ? { redressExcludeRaces: finish.redressExcludeRaces } : {}),
          ...(finish.redressIncludeRaces ? { redressIncludeRaces: finish.redressIncludeRaces } : {}),
          ...(finish.redressIncludeAllLater ? { redressIncludeAllLater: true } : {}),
          ...(finish.redressPoints != null ? { redressPoints: finish.redressPoints } : {}),
        } : {}),
      };
    });
    // Unresolved finishes — not in raceScores (no competitor to key on) — are
    // appended separately so a round-trip preserves them as unknown crossings.
    for (const f of finishesForRace) {
      if (f.competitorId != null) continue;
      finishes.push({
        sailNumber: '',
        ...(f.unknownSailNumber ? { unknownSailNumber: f.unknownSailNumber } : {}),
        sortOrder: f.sortOrder ?? null,
        ...(f.finishTime ? { finishTime: f.finishTime } : {}),
        resultCode: f.resultCode,
        startPresent: f.startPresent ?? null,
      } as (typeof finishes)[number]);
    }
    const starts = allRaceStarts
      .filter((rs) => rs.raceId === race.id)
      .map((rs) => ({
        fleetNames: rs.fleetIds.map((id) => fleetNameById.get(id) ?? id),
        startTime: rs.startTime,
      }));
    const nhcByFleetMap = nhcByFleetByRaceId.get(race.id);
    const nhcByFleet = nhcByFleetMap && nhcByFleetMap.size > 0
      ? Object.fromEntries(nhcByFleetMap)
      : undefined;
    const echoByFleetMap = echoByFleetByRaceId.get(race.id);
    const echoByFleet = echoByFleetMap && echoByFleetMap.size > 0
      ? Object.fromEntries(echoByFleetMap)
      : undefined;
    return {
      raceNumber: race.raceNumber,
      date: race.date,
      starts,
      finishes,
      ...(nhcByFleet ? { nhcByFleet } : {}),
      ...(echoByFleet ? { echoByFleet } : {}),
    };
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
      racePenaltyCodes: s.racePenaltyCodes,
      racePenaltyOverrides: s.racePenaltyOverrides,
      raceNonDiscardable: s.raceNonDiscardable,
      raceRedressFlags: s.raceRedressFlags,
      totalPoints: s.totalPoints,
      netPoints: s.netPoints,
    })),
  }));

  let cumulativeOffset = 0;
  const exportedDefaultStartSequence: ExportStartGroup[] | undefined = series.defaultStartSequence?.length
    ? series.defaultStartSequence.map((g, i) => {
        if (i > 0) cumulativeOffset += g.intervalMinutes;
        return {
          fleetNames: g.fleetIds.map((id) => fleetNameById.get(id) ?? id),
          offsetMinutes: cumulativeOffset,
        };
      })
    : undefined;

  return {
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    series: {
      name: series.name,
      venue: series.venue,
      startDate: series.startDate,
      endDate: series.endDate,
      ...(series.venueLogoUrl ? { venueLogoUrl: series.venueLogoUrl } : {}),
      ...(series.eventLogoUrl ? { eventLogoUrl: series.eventLogoUrl } : {}),
      discardThresholds: series.discardThresholds,
      dnfScoring: series.dnfScoring,
      displayFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
      primaryPersonLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
      scoringMode: series.scoringMode ?? 'scratch',
      ...(series.publishRatingCalculations != null ? { publishRatingCalculations: series.publishRatingCalculations } : {}),
      ...(exportedDefaultStartSequence ? { defaultStartSequence: exportedDefaultStartSequence } : {}),
    },
    fleets: fleets.map((f) => ({
      name: f.name,
      displayOrder: f.displayOrder,
      scoringSystem: f.scoringSystem,
      ...(f.nhcAlpha != null ? { nhcAlpha: f.nhcAlpha } : {}),
      ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
    })),
    competitors: competitors.map((c) => ({
      sailNumber: c.sailNumber,
      ...(c.boatName ? { boatName: c.boatName } : {}),
      ...(c.boatClass ? { boatClass: c.boatClass } : {}),
      name: c.name,
      ...(c.owner ? { owner: c.owner } : {}),
      ...(c.helm ? { helm: c.helm } : {}),
      ...(c.crewName ? { crewName: c.crewName } : {}),
      club: c.club,
      gender: c.gender,
      age: c.age,
      fleetNames: c.fleetIds.map((id) => fleetNameById.get(id) ?? id),
      ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
      ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
      ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
      ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
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
  const seriesName = disambiguateSeriesName(data.series.name, await listSeriesNames());

  // Each competitor gets a unique UUID. Key by (sailNumber, fleetNames) to handle
  // collisions where different-fleet boats share a sail number.
  const competitorIdBySailFleet = new Map<string, string>();
  // Secondary sail-only multi-map for finish remapping (finishes lack fleet info).
  const competitorIdsBySail = new Map<string, string[]>();
  for (const c of data.competitors) {
    const key = `${c.sailNumber}\0${[...c.fleetNames].sort().join('\0')}`;
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
  for (const f of data.fleets) {
    fleetIdByName.set(f.name, crypto.randomUUID());
  }

  await db.transaction('rw', [db.series, db.fleets, db.competitors, db.races, db.finishes, db.raceStarts, db.nhcTcfHistory], async () => {
    // Resolve exported defaultStartSequence (fleetNames) → internal fleetIds,
    // and convert cumulative offsets back to per-step intervals.
    const importedDefaultStartSequence = data.series.defaultStartSequence?.length
      ? (() => {
          const resolved = data.series.defaultStartSequence!
            .map((g) => ({
              fleetIds: g.fleetNames.map((n) => fleetIdByName.get(n)).filter((id): id is string => id != null),
              offsetMinutes: g.offsetMinutes,
            }))
            .filter((g) => g.fleetIds.length > 0);
          return resolved.map((g, i) => ({
            fleetIds: g.fleetIds,
            intervalMinutes: i === 0 ? 0 : Math.max(0, g.offsetMinutes - resolved[i - 1].offsetMinutes),
          }));
        })()
      : undefined;

    await db.series.add({
      id: newSeriesId,
      name: seriesName,
      venue: data.series.venue,
      startDate: data.series.startDate,
      endDate: data.series.endDate,
      venueLogoUrl: data.series.venueLogoUrl ?? '',
      eventLogoUrl: data.series.eventLogoUrl ?? '',
      createdAt: now,
      lastSnapshotId: null,
      lastSavedAt: null,
      lastModifiedAt: now,
      snapshotHistory: [],
      scoringMode: data.series.scoringMode,
      ...(importedDefaultStartSequence?.length ? { defaultStartSequence: importedDefaultStartSequence } : {}),
      discardThresholds: data.series.discardThresholds,
      dnfScoring: data.series.dnfScoring,
      ftpHost: '',
      ftpPath: '',
      bilgeBundle: null,
      includeJsonExport: true,
      ...(data.series.publishRatingCalculations != null ? { publishRatingCalculations: data.series.publishRatingCalculations } : {}),
      enabledCompetitorFields: data.series.displayFields ?? defaultEnabledCompetitorFields(),
      primaryPersonLabel: data.series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
    });

    for (const f of data.fleets) {
      await db.fleets.add({
        id: fleetIdByName.get(f.name)!,
        seriesId: newSeriesId,
        name: f.name,
        displayOrder: f.displayOrder,
        scoringSystem: f.scoringSystem,
        ...(f.nhcAlpha != null ? { nhcAlpha: f.nhcAlpha } : {}),
        ...(f.echoAlpha != null ? { echoAlpha: f.echoAlpha } : {}),
      });
    }

    for (const c of data.competitors) {
      const fleetIds = c.fleetNames
        .map((n) => fleetIdByName.get(n))
        .filter((id): id is string => id != null);
      await db.competitors.add({
        id: competitorIdBySailFleet.get(competitorKey(c.sailNumber, c.fleetNames))!,
        seriesId: newSeriesId,
        fleetIds,
        sailNumber: c.sailNumber,
        ...(c.boatName ? { boatName: c.boatName } : {}),
        ...(c.boatClass ? { boatClass: c.boatClass } : {}),
        name: c.name,
        ...(c.owner ? { owner: c.owner } : {}),
        ...(c.helm ? { helm: c.helm } : {}),
        ...(c.crewName ? { crewName: c.crewName } : {}),
        club: c.club,
        gender: c.gender,
        age: c.age,
        createdAt: now,
        ...(c.ircTcc != null ? { ircTcc: c.ircTcc } : {}),
        ...(c.pyNumber != null ? { pyNumber: c.pyNumber } : {}),
        ...(c.nhcStartingTcf != null ? { nhcStartingTcf: c.nhcStartingTcf } : {}),
        ...(c.echoStartingTcf != null ? { echoStartingTcf: c.echoStartingTcf } : {}),
      });
    }

    // Build (sailNumber, fleetName) → competitorId map for progressive-TCF
    // history reconstruction (NHC and ECHO share the same DB table).
    // A boat in two NHC fleets needs distinct rows per fleet — keyed by both.
    const competitorIdBySailFleetName = new Map<string, string>();
    for (const c of data.competitors) {
      const cId = competitorIdBySailFleet.get(competitorKey(c.sailNumber, c.fleetNames));
      if (!cId) continue;
      for (const fn of c.fleetNames) {
        competitorIdBySailFleetName.set(`${c.sailNumber}\0${fn}`, cId);
      }
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
      for (const start of race.starts) {
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
        // A finish with unknownSailNumber set (and typically empty sailNumber)
        // represents an unresolved crossing — store it with competitorId: null
        // so it survives the round trip.
        const exportedUnknownSail = finish.unknownSailNumber;
        const candidates = finish.sailNumber
          ? competitorIdsBySail.get(finish.sailNumber) ?? []
          : [];
        const competitorId = candidates.find((id) => !usedIds.has(id)) ?? candidates[0];
        if (!competitorId && !exportedUnknownSail) continue;
        if (competitorId) usedIds.add(competitorId);
        await db.finishes.add({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitorId ?? null,
          ...(!competitorId && exportedUnknownSail ? { unknownSailNumber: exportedUnknownSail } : {}),
          sortOrder: finish.sortOrder,
          ...(finish.finishTime ? { finishTime: finish.finishTime } : {}),
          resultCode: finish.resultCode,
          startPresent: finish.startPresent,
          penaltyCode: finish.penaltyCode ?? null,
          penaltyOverride: finish.penaltyOverride ?? null,
          redressMethod: finish.redressMethod ?? null,
          redressExcludeRaces: finish.redressExcludeRaces ?? null,
          redressIncludeRaces: finish.redressIncludeRaces ?? null,
          redressIncludeAllLater: finish.redressIncludeAllLater ?? false,
          redressPoints: finish.redressPoints ?? null,
        });
      }

      // Reconstruct nhcTcfHistory rows from per-(race, fleet) intermediates.
      // Engine-recompute would also work, but persisting directly avoids
      // needing to re-score on every render after import. The same table
      // covers ECHO history.
      const nhcByFleet = race.nhcByFleet;
      if (nhcByFleet) {
        for (const [fleetName, entry] of Object.entries(nhcByFleet)) {
          const fleetId = fleetIdByName.get(fleetName);
          if (!fleetId) continue;
          for (const row of entry.rows) {
            const competitorId = competitorIdBySailFleetName.get(`${row.sailNumber}\0${fleetName}`);
            if (!competitorId) continue;
            await db.nhcTcfHistory.add({
              id: crypto.randomUUID(),
              raceId,
              competitorId,
              fleetId,
              tcfApplied: row.tcfApplied,
              newTcf: row.newTcf,
            });
          }
        }
      }
      const echoByFleet = race.echoByFleet;
      if (echoByFleet) {
        for (const [fleetName, entry] of Object.entries(echoByFleet)) {
          const fleetId = fleetIdByName.get(fleetName);
          if (!fleetId) continue;
          for (const row of entry.rows) {
            const competitorId = competitorIdBySailFleetName.get(`${row.sailNumber}\0${fleetName}`);
            if (!competitorId) continue;
            await db.nhcTcfHistory.add({
              id: crypto.randomUUID(),
              raceId,
              competitorId,
              fleetId,
              tcfApplied: row.tcfApplied,
              newTcf: row.newTcf,
            });
          }
        }
      }
    }
  });

  return newSeriesId;
}
