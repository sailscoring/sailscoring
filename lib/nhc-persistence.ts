/**
 * NHC TCF history persistence — recompute and write fresh records to the DB.
 *
 * The history is purely derived state (recomputable from finishes + starting TCFs
 * + α). We persist it so the series file format and public JSON export can carry
 * it without callers needing to re-score, and so non-finishers (which have no
 * Finish row) still leave a trail.
 *
 * This helper does a full overwrite of all NHC fleets' history for the series.
 * Cheap at realistic scales (≤30 boats × ≤20 races × N fleets).
 */

import { db } from './db';
import { calculateFleetStandings } from './scoring';

export async function recomputeNhcHistoryForSeries(seriesId: string): Promise<void> {
  const [series, fleets, competitors, races] = await Promise.all([
    db.series.get(seriesId),
    db.fleets.where('seriesId').equals(seriesId).toArray(),
    db.competitors.where('seriesId').equals(seriesId).toArray(),
    db.races.where('seriesId').equals(seriesId).sortBy('raceNumber'),
  ]);
  if (!series) return;
  const nhcFleetIds = fleets.filter((f) => f.scoringSystem === 'nhc').map((f) => f.id);
  if (nhcFleetIds.length === 0) {
    // Nothing to do; clean up any stale rows for this series's races
    if (races.length > 0) {
      await db.nhcTcfHistory.where('raceId').anyOf(races.map((r) => r.id)).delete();
    }
    return;
  }

  const raceIds = races.map((r) => r.id);
  const [allFinishes, allRaceStarts] = await Promise.all([
    raceIds.length > 0 ? db.finishes.where('raceId').anyOf(raceIds).toArray() : Promise.resolve([]),
    raceIds.length > 0 ? db.raceStarts.where('raceId').anyOf(raceIds).toArray() : Promise.resolve([]),
  ]);

  const { fleetStandings } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
  );

  await db.transaction('rw', db.nhcTcfHistory, async () => {
    if (raceIds.length > 0) {
      await db.nhcTcfHistory.where('raceId').anyOf(raceIds).delete();
    }
    for (const fr of fleetStandings) {
      if (!fr.nhcTcfHistory) continue;
      for (const h of fr.nhcTcfHistory) {
        await db.nhcTcfHistory.add(h);
      }
    }
  });
}
