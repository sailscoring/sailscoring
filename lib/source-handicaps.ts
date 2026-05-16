/**
 * Source-of-handicaps resolution for the Update Handicaps dialog (#144).
 *
 * Pure functions over already-loaded data. The dialog asks: "for each
 * competitor in some prior series, what is its end-of-series TCF per
 * fleet?" — and uses the answers as starting TCFs for the same boats
 * in a target series.
 *
 * Scope of this module:
 * - {@link endOfSeriesTcfs} resolves end-of-series progressive-handicap
 *   TCFs (NHC, ECHO) from a persisted `TcfRecord[]` history.
 *
 * The diff planner that consumes this and produces preview rows lives
 * in a follow-up module (Phase B of the implementation plan).
 */

import type { Competitor, Fleet, Race, TcfRecord } from './types';

/**
 * The progressive-handicap systems whose end-of-series TCF we can read
 * out of the persisted `TcfRecord` history. Static-TCF systems (IRC, PY)
 * carry no per-race history — they are sourced directly from the
 * competitor record by the diff planner instead.
 */
export type ProgressiveHandicapSystem = 'nhc' | 'echo';

export interface EndOfSeriesTcf {
  competitorId: string;
  fleetId: string;
  system: ProgressiveHandicapSystem;
  /** TCF the boat should carry into race 1 of the target series. */
  endTcf: number;
  /** The race whose `newTcf` we read. Surfaced so the dialog can show
   *  "handicaps as of {raceNumber}". */
  lastRaceId: string;
  lastRaceNumber: number;
}

/** Composite key for the returned map. Encodes `competitorId × fleetId` —
 *  a boat in two progressive-handicap fleets in the source series has an
 *  entry per fleet, and the consumer keeps both separate. */
export function endOfSeriesTcfKey(competitorId: string, fleetId: string): string {
  return `${competitorId}::${fleetId}`;
}

/**
 * For every `(competitor, progressive-fleet)` pairing in the source
 * series, return the `newTcf` from the latest scored race.
 *
 * "Latest" is defined by race date first, then race number — matching
 * the order the scoring engine processes races in.
 *
 * A pairing with no `TcfRecord` rows is omitted (the fleet either has
 * no scored races, or the boat never raced in any of them). The
 * consumer treats omissions as "not found in source" and leaves the
 * target competitor's current TCF in place.
 */
export function endOfSeriesTcfs(
  competitors: readonly Competitor[],
  fleets: readonly Fleet[],
  races: readonly Race[],
  history: readonly TcfRecord[],
): Map<string, EndOfSeriesTcf> {
  // Index fleets that even produce progressive history.
  const progressiveFleetSystem = new Map<string, ProgressiveHandicapSystem>();
  for (const f of fleets) {
    if (f.scoringSystem === 'nhc' || f.scoringSystem === 'echo') {
      progressiveFleetSystem.set(f.id, f.scoringSystem);
    }
  }
  if (progressiveFleetSystem.size === 0) return new Map();

  // Order races so "latest" is well-defined. Date first (ISO sorts
  // lexicographically), then raceNumber so two races on the same day
  // resolve deterministically. Races missing from the input list (a
  // history record references a race we weren't given) are excluded
  // from the ordering — their records become unreachable and are
  // skipped below.
  const raceOrder = new Map<string, { date: string; raceNumber: number }>();
  for (const r of races) raceOrder.set(r.id, { date: r.date, raceNumber: r.raceNumber });

  function isLater(
    a: { date: string; raceNumber: number },
    b: { date: string; raceNumber: number },
  ): boolean {
    if (a.date !== b.date) return a.date > b.date;
    return a.raceNumber > b.raceNumber;
  }

  // Walk every history record, keep the latest per (competitor, fleet).
  type Pick = { record: TcfRecord; order: { date: string; raceNumber: number } };
  const latest = new Map<string, Pick>();
  for (const rec of history) {
    const system = progressiveFleetSystem.get(rec.fleetId);
    if (!system) continue;
    const order = raceOrder.get(rec.raceId);
    if (!order) continue;
    const key = endOfSeriesTcfKey(rec.competitorId, rec.fleetId);
    const prior = latest.get(key);
    if (!prior || isLater(order, prior.order)) {
      latest.set(key, { record: rec, order });
    }
  }

  // Materialise — only for competitors actually present in the source
  // series (a history record for a deleted competitor is dropped).
  const competitorIds = new Set(competitors.map((c) => c.id));
  const result = new Map<string, EndOfSeriesTcf>();
  for (const [key, pick] of latest) {
    if (!competitorIds.has(pick.record.competitorId)) continue;
    const system = progressiveFleetSystem.get(pick.record.fleetId)!;
    result.set(key, {
      competitorId: pick.record.competitorId,
      fleetId: pick.record.fleetId,
      system,
      endTcf: pick.record.newTcf,
      lastRaceId: pick.record.raceId,
      lastRaceNumber: pick.order.raceNumber,
    });
  }
  return result;
}
