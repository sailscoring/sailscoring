/**
 * Build a `.sailscoring` SeriesFile (format v6) from parsed HalSail fleet
 * results. Produces *input only* — competitors with ratings, races, starts,
 * finishes and result codes — so that scoring (corrected times, points,
 * discards, the ECHO progression) is recomputed independently by the app and
 * can be compared against HalSail's published standings.
 *
 * Scoped to the DBSC Thursday Blue cruiser group (one committee vessel, one
 * finish sheet): Cruisers 0/1/2/3 scored under ECHO, Cruisers 0/1/2 also under
 * IRC, plus the J/109 and Sigma 33 one-design fleets that ride the same sheet.
 * See `docs/design/dbsc-parity-plan.md`.
 *
 * The file-format interfaces below mirror `lib/series-file.ts` (which doesn't
 * export them); the format is just JSON, so we construct it directly.
 */

import type { CompetitorFieldKey, PrimaryPersonLabel } from '../types';
import type { HalsailFleet } from './parse-results';

interface FileFleet {
  id: string;
  name: string;
  displayOrder: number;
  scoringSystem: 'scratch' | 'irc' | 'py' | 'nhc' | 'echo';
  echoAlpha?: number;
}
interface FileCompetitor {
  id: string;
  fleetIds: string[];
  sailNumber: string;
  boatName?: string;
  boatClass?: string;
  name: string;
  owner?: string;
  helm?: string;
  club: string;
  gender: 'M' | 'F' | '';
  age: number | null;
  ircTcc?: number;
  echoStartingTcf?: number;
}
interface FileFinish {
  id: string;
  competitorId: string | null;
  sortOrder: number | null;
  finishTime?: string;
  resultCode: string | null;
  startPresent: boolean | null;
  penaltyCode: null;
  penaltyOverride: null;
  redressMethod?: 'all_races' | 'all_races_excl_dnc' | 'races_before';
}

// HalSail redress types (rendered as e.g. "RDG 2") → Sail Scoring methods.
// Types 4 (points-for-place) and 5 (stated points) have no engine equivalent
// yet; see docs/design/horizon.md.
const RDG_TYPE_TO_METHOD: Record<number, 'all_races' | 'all_races_excl_dnc' | 'races_before'> = {
  1: 'all_races',
  2: 'all_races_excl_dnc',
  3: 'races_before',
};
interface FileRaceStart {
  id: string;
  fleetIds: string[];
  startTime: string;
}
interface FileRace {
  id: string;
  raceNumber: number;
  date: string;
  starts: FileRaceStart[];
  finishes: FileFinish[];
}
interface FileSeries {
  id: string;
  name: string;
  venue: string;
  startDate: string;
  endDate: string;
  venueLogoUrl: string;
  eventLogoUrl: string;
  venueUrl: string;
  eventUrl: string;
  discardThresholds: { minRaces: number; discardCount: number }[];
  dnfScoring: 'seriesEntries' | 'startingArea' | 'startingAreaInclDnc';
  ftpHost: string;
  ftpPath: string;
  includeJsonExport: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  primaryPersonLabel: PrimaryPersonLabel;
  subdivisionLabel: string;
  scoringMode: 'scratch' | 'handicap';
}
export interface SeriesFile {
  formatVersion: number;
  seriesId: string;
  snapshotId: string;
  snapshotHistory: string[];
  exportedAt: string;
  series: FileSeries;
  fleets: FileFleet[];
  competitors: FileCompetitor[];
  races: FileRace[];
}

export interface ClassInput {
  classNum: 0 | 1 | 2 | 3;
  echo: HalsailFleet; // Cruisers N ECHO (Thu) — authoritative roster + finishes + ECHO seed
  irc?: HalsailFleet; // Cruisers N IRC (classes 0–2) — IRC TCC
}

export interface OneDesignInput {
  fleetId: string; // e.g. "cf-j109"
  name: string; // e.g. "J/109"
  parentClass: 1 | 2; // the cruiser class whose start it shares
  fleet: HalsailFleet; // roster only (which sails belong)
}

export interface BuildOptions {
  seriesName?: string;
  venue?: string;
  seriesId?: string;
  snapshotId?: string; // must be a valid UUID (lands in series.last_snapshot_id)
  exportedAt?: string;
}

// DBSC sliding discard ladder (SI A13.4): <4→0, 4–6→1, 7–11→2, 12–17→3,
// 18–24→4, 25–31→5, 32+→6.
const DBSC_DISCARDS = [
  { minRaces: 4, discardCount: 1 },
  { minRaces: 7, discardCount: 2 },
  { minRaces: 12, discardCount: 3 },
  { minRaces: 18, discardCount: 4 },
  { minRaces: 25, discardCount: 5 },
  { minRaces: 32, discardCount: 6 },
];

const echoFleetId = (n: number) => `cf-${n}-echo`;
const ircFleetId = (n: number) => `cf-${n}-irc`;
const compId = (sail: string) => `comp-${sail.replace(/[^A-Za-z0-9]/g, '')}`;

/** First applied handicap for a sail across the fleet's sailed races, in race
 *  order — the ECHO seed (the rating going into the boat's first race). */
function firstAppliedHcap(echo: HalsailFleet, sail: string): number | null {
  for (const race of echo.races) {
    const f = race.finishers.find((x) => x.sail === sail);
    if (f && f.hcap != null) return f.hcap;
  }
  return null;
}

export function buildThursdayBlueSeries(
  classes: ClassInput[],
  oneDesigns: OneDesignInput[],
  opts: BuildOptions = {},
): SeriesFile {
  const fleets: FileFleet[] = [];
  let order = 0;
  for (const cl of classes) {
    if (cl.irc) fleets.push({ id: ircFleetId(cl.classNum), name: `Cruisers ${cl.classNum} IRC`, displayOrder: order++, scoringSystem: 'irc' });
    fleets.push({ id: echoFleetId(cl.classNum), name: `Cruisers ${cl.classNum} ECHO`, displayOrder: order++, scoringSystem: 'echo', echoAlpha: 0.25 });
  }
  for (const od of oneDesigns) {
    fleets.push({ id: od.fleetId, name: od.name, displayOrder: order++, scoringSystem: 'scratch' });
  }

  // Membership lookups for the one-design fleets, by sail.
  const odBySail = new Map<string, string[]>();
  for (const od of oneDesigns) {
    for (const c of od.fleet.competitors) {
      if (!odBySail.has(c.sail)) odBySail.set(c.sail, []);
      odBySail.get(c.sail)!.push(od.fleetId);
    }
  }

  // Competitors — roster from each class's ECHO fragment.
  const competitors: FileCompetitor[] = [];
  const sailToComp = new Map<string, string>();
  for (const cl of classes) {
    const ircBySail = new Map(cl.irc?.competitors.map((c) => [c.sail, c]) ?? []);
    for (const c of cl.echo.competitors) {
      if (sailToComp.has(c.sail)) continue; // a sail belongs to one class
      const id = compId(c.sail);
      const fleetIds = [echoFleetId(cl.classNum)];
      const ircComp = ircBySail.get(c.sail);
      // Prefer the per-race applied TCC over the summary value: HalSail flags a
      // mid-series rating change with "*" in the summary Hcap (unparseable), but
      // the detail tables still carry the numeric rating. A boat joins the IRC
      // fleet only when we have a usable TCC for it.
      const ircTcc = cl.irc && ircComp ? (firstAppliedHcap(cl.irc, c.sail) ?? ircComp.hcap ?? null) : null;
      if (ircTcc != null) fleetIds.push(ircFleetId(cl.classNum));
      for (const odId of odBySail.get(c.sail) ?? []) fleetIds.push(odId);
      const seed = firstAppliedHcap(cl.echo, c.sail);
      competitors.push({
        id,
        fleetIds,
        sailNumber: c.sail,
        ...(c.name ? { boatName: c.name } : {}),
        ...(c.type ? { boatClass: c.type } : {}),
        name: c.owner || c.name || c.sail,
        ...(c.owner ? { owner: c.owner } : {}),
        ...(c.helm ? { helm: c.helm } : {}),
        club: c.club ?? '',
        gender: '',
        age: null,
        ...(ircTcc != null ? { ircTcc } : {}),
        ...(seed != null ? { echoStartingTcf: seed } : {}),
      });
      sailToComp.set(c.sail, id);
    }
  }

  // Per-class extra fleets that share the class start (one-designs).
  const extraStartFleets = new Map<number, string[]>();
  for (const od of oneDesigns) {
    if (!extraStartFleets.has(od.parentClass)) extraStartFleets.set(od.parentClass, []);
    extraStartFleets.get(od.parentClass)!.push(od.fleetId);
  }

  // Races — union of race numbers across classes; each class contributes only
  // the races it sailed (the engine excludes a race for a fleet with no
  // finishers, so absent classes are correctly not scored that race).
  const raceNumbers = [...new Set(classes.flatMap((cl) => cl.echo.races.map((r) => r.raceNumber)))].sort((a, b) => a - b);

  const races: FileRace[] = [];
  for (const rn of raceNumbers) {
    const starts: FileRaceStart[] = [];
    let date = '';
    interface Crossing { compId: string; sail: string; finish: string | null; code: string | null; redressType: number | null; }
    const crossings: Crossing[] = [];

    for (const cl of classes) {
      const race = cl.echo.races.find((r) => r.raceNumber === rn);
      if (!race) continue;
      if (race.date) date ||= race.date;
      const startFleets = [echoFleetId(cl.classNum)];
      if (cl.irc) startFleets.push(ircFleetId(cl.classNum));
      startFleets.push(...(extraStartFleets.get(cl.classNum) ?? []));
      starts.push({
        id: `rs-${rn}-c${cl.classNum}`,
        fleetIds: startFleets,
        startTime: race.startTime ?? '18:45:00',
      });
      for (const f of race.finishers) {
        const cid = sailToComp.get(f.sail);
        if (!cid) continue; // a sail in detail but not in the summary roster
        // Record DNC implicitly: a boat that did not come to the start is
        // simply omitted, and the engine scores any competitor with no finish
        // record in a counted race as DNC. Boats that came but didn't finish
        // (DNF/RET/OCS/…) are kept as explicit coded finishes so they count
        // toward the "came to the starting area" tally.
        if (!f.finish && (f.code === 'DNC' || !f.code)) continue;
        crossings.push({ compId: cid, sail: f.sail, finish: f.finish, code: f.code, redressType: f.redressType });
      }
    }

    // Crossing order across the whole sheet, by finish time of day.
    const finished = crossings.filter((c) => c.finish).sort((a, b) => a.finish!.localeCompare(b.finish!));
    const finishes: FileFinish[] = [];
    let sortOrder = 0;
    for (const c of finished) {
      sortOrder++;
      finishes.push({
        id: `fin-${rn}-${c.compId}`,
        competitorId: c.compId,
        sortOrder,
        finishTime: c.finish!,
        resultCode: null,
        startPresent: true,
        penaltyCode: null,
        penaltyOverride: null,
      });
    }
    for (const c of crossings.filter((x) => !x.finish)) {
      // Map HalSail's RDG type to the engine's redress method. The engine then
      // computes the per-fleet value (a single stated figure can't be right for
      // IRC and ECHO at once). Types 4/5 have no engine equivalent yet.
      let redress: { redressMethod?: 'all_races' | 'all_races_excl_dnc' | 'races_before' } = {};
      if (c.code === 'RDG') {
        const method = c.redressType != null ? RDG_TYPE_TO_METHOD[c.redressType] : undefined;
        if (method) {
          redress = { redressMethod: method };
        } else {
          console.warn(`  ! Unsupported RDG type ${c.redressType ?? '?'} for sail ${c.sail} race ${rn}; falling back to all-races average. See horizon.`);
          redress = { redressMethod: 'all_races' };
        }
      }
      finishes.push({
        id: `fin-${rn}-${c.compId}`,
        competitorId: c.compId,
        sortOrder: null,
        resultCode: c.code!, // non-DNC (DNCs were omitted above)
        startPresent: true, // came to the start but didn't finish
        penaltyCode: null,
        penaltyOverride: null,
        ...redress,
      });
    }

    races.push({ id: `race-${rn}`, raceNumber: rn, date: date || '2026-01-01', starts, finishes });
  }

  const startDate = races.length ? races.map((r) => r.date).sort()[0] : '2026-01-01';
  const endDate = races.length ? races.map((r) => r.date).sort()[races.length - 1] : startDate;
  const seriesId = opts.seriesId ?? 'dbsc-thursday-blue-2026';
  // snapshotId lands in the `series.last_snapshot_id` UUID column on import, so
  // it must be a valid UUID (unlike seriesId/fleet/competitor ids, which are
  // remapped to fresh UUIDs by openSeriesFromFile). Fixed literal for stable,
  // byte-identical regeneration.
  const snapshotId = opts.snapshotId ?? 'f9a1c0de-2026-4b1e-8c00-000000000001';

  return {
    formatVersion: 6,
    seriesId,
    snapshotId,
    snapshotHistory: [snapshotId],
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    series: {
      id: seriesId,
      name: opts.seriesName ?? 'DBSC Thursday Blue — Cruisers (2026)',
      venue: opts.venue ?? 'Dublin Bay Sailing Club',
      startDate,
      endDate,
      venueLogoUrl: '',
      eventLogoUrl: '',
      venueUrl: '',
      eventUrl: '',
      discardThresholds: DBSC_DISCARDS,
      // DBSC SI A13.2: a boat that did not come to the start is scored from the
      // number that came + 1 (not series entries + 1).
      dnfScoring: 'startingAreaInclDnc',
      ftpHost: '',
      ftpPath: '',
      includeJsonExport: true,
      enabledCompetitorFields: ['boatName', 'boatClass', 'helm', 'club'],
      primaryPersonLabel: 'owner',
      subdivisionLabel: 'Division',
      scoringMode: 'handicap',
    },
    fleets,
    competitors,
    races,
  };
}
