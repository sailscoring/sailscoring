import type { ExportRepos } from './public-export';
import { bySailNumber } from './sail-number-sort';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceRatingOverride,
  RaceStart,
  Series,
  SeriesCourse,
  SeriesMark,
  SubSeries,
} from './types';

/** Everything a whole-series consumer needs in one in-memory value. */
export interface SeriesSnapshot {
  series: Series;
  competitors: Competitor[];
  fleets: Fleet[];
  races: Race[];
  subSeries: SubSeries[];
  finishes: Finish[];
  raceStarts: RaceStart[];
  ratingOverrides: RaceRatingOverride[];
  /** The course library (ORC constructed courses). Empty on a series with
   *  none; absent only from a bundle whose repos don't carry the library. */
  marks?: SeriesMark[];
  courses?: SeriesCourse[];
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
    subSeriesUnsorted,
    finishes,
    raceStarts,
    ratingOverrides,
    marksUnsorted,
    coursesUnsorted,
  ] = await Promise.all([
    repos.seriesRepo.get(seriesId),
    repos.competitorRepo.listBySeries(seriesId),
    repos.fleetRepo.listBySeries(seriesId),
    repos.raceRepo.listBySeries(seriesId),
    repos.subSeriesRepo.listBySeries(seriesId),
    repos.finishRepo.listBySeries(seriesId),
    repos.raceStartRepo.listBySeries(seriesId),
    repos.raceRatingOverrideRepo.listBySeries(seriesId),
    repos.seriesMarkRepo?.listBySeries(seriesId) ?? Promise.resolve([] as SeriesMark[]),
    repos.seriesCourseRepo?.listBySeries(seriesId) ?? Promise.resolve([] as SeriesCourse[]),
  ]);
  if (!series) return null;

  // The repositories already sort by these keys; sort defensively so every
  // consumer sees one deterministic order regardless of backend.
  const competitors = [...competitorsUnsorted].sort(bySailNumber);
  const fleets = [...fleetsUnsorted].sort((a, b) => a.displayOrder - b.displayOrder);
  const races = [...racesUnsorted].sort((a, b) => a.raceNumber - b.raceNumber);
  const subSeries = [...subSeriesUnsorted].sort((a, b) => a.displayOrder - b.displayOrder);
  const marks = [...marksUnsorted].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
  const courses = [...coursesUnsorted].sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));

  return { series, competitors, fleets, races, subSeries, finishes, raceStarts, ratingOverrides, marks, courses };
}
