import type { ExportRepos } from './public-export';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceRatingOverride,
  RaceStart,
  Series,
} from './types';

/** Everything a whole-series consumer needs in one in-memory value. */
export interface SeriesSnapshot {
  series: Series;
  competitors: Competitor[];
  fleets: Fleet[];
  races: Race[];
  finishes: Finish[];
  raceStarts: RaceStart[];
  ratingOverrides: RaceRatingOverride[];
}

/**
 * The canonical whole-series fan-in, shared by the `.sailscoring` file
 * builder, the public JSON export, the per-fleet HTML renderer, and the TCF
 * history handler. Every read is series-scoped, so all seven run in
 * parallel.
 *
 * Returns `null` when the series doesn't exist; empty-series semantics
 * (no competitors / no races) are each caller's own business.
 */
export async function loadSeriesSnapshot(
  repos: ExportRepos,
  seriesId: string,
): Promise<SeriesSnapshot | null> {
  const [
    series,
    competitorsUnsorted,
    fleetsUnsorted,
    racesUnsorted,
    finishes,
    raceStarts,
    ratingOverrides,
  ] = await Promise.all([
    repos.seriesRepo.get(seriesId),
    repos.competitorRepo.listBySeries(seriesId),
    repos.fleetRepo.listBySeries(seriesId),
    repos.raceRepo.listBySeries(seriesId),
    repos.finishRepo.listBySeries(seriesId),
    repos.raceStartRepo.listBySeries(seriesId),
    repos.raceRatingOverrideRepo.listBySeries(seriesId),
  ]);
  if (!series) return null;

  // The repositories already sort by these keys; sort defensively so every
  // consumer sees one deterministic order regardless of backend.
  const competitors = [...competitorsUnsorted].sort((a, b) =>
    a.sailNumber.localeCompare(b.sailNumber),
  );
  const fleets = [...fleetsUnsorted].sort((a, b) => a.displayOrder - b.displayOrder);
  const races = [...racesUnsorted].sort((a, b) => a.raceNumber - b.raceNumber);

  return { series, competitors, fleets, races, finishes, raceStarts, ratingOverrides };
}
