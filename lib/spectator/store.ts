/**
 * The spectator viewer's in-memory series (#475, ADR-012).
 *
 * A published `.sailscoring.json` data file, read into the shapes the series
 * tabs already consume, and held in this module for the life of the tab. The
 * viewer is strictly read-only: nothing here is ever written back, and the
 * transport beside this file answers only GETs.
 *
 * Two things make the series routable as itself rather than needing a
 * parallel UI. Its id carries the `spectator-` prefix, which is what keeps
 * `/series/spectator-…` outside the login gate and what tells the series
 * layout it is showing a spectator view. And the id, along with every id
 * beneath it, is derived deterministically from the source path, so a reload
 * that re-reads the same file rebuilds exactly the same series and any link
 * into it still resolves.
 *
 * Kept free of heavy imports: `lib/api-client` reaches this on every page, so
 * the seeding side (which pulls in the whole public-export module) lives in
 * `seed.ts` and is loaded only by the route that opens a view.
 */
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '../types';

export const SPECTATOR_ID_PREFIX = 'spectator-';

/** Whether a series id names a spectator view rather than a stored series.
 *  Stored ids are UUIDs, so the prefix can never collide with one. */
export function isSpectatorSeriesId(id: string): boolean {
  return id.startsWith(SPECTATOR_ID_PREFIX);
}

/** One opened data file, in the shapes the series tabs read. */
export interface SpectatorSeries {
  seriesId: string;
  /** Site-relative path of the data file this was read from, so a reload can
   *  fetch it again. */
  source: string;
  series: Series;
  fleets: Fleet[];
  competitors: Competitor[];
  races: Race[];
  raceStarts: RaceStart[];
  finishes: Finish[];
  subSeries: SubSeries[];
}

const bySeriesId = new Map<string, SpectatorSeries>();
const seriesIdByRaceId = new Map<string, string>();
const seriesIdByCompetitorId = new Map<string, string>();

/** Hold an opened view, replacing any earlier read of the same series. */
export function putSpectatorSeries(view: SpectatorSeries): void {
  bySeriesId.set(view.seriesId, view);
  for (const race of view.races) seriesIdByRaceId.set(race.id, view.seriesId);
  for (const c of view.competitors) seriesIdByCompetitorId.set(c.id, view.seriesId);
}

export function getSpectatorSeries(seriesId: string): SpectatorSeries | undefined {
  return bySeriesId.get(seriesId);
}

/** The view a race belongs to — the race-scoped endpoints carry no series id. */
export function getSpectatorSeriesByRace(raceId: string): SpectatorSeries | undefined {
  const seriesId = seriesIdByRaceId.get(raceId);
  return seriesId ? bySeriesId.get(seriesId) : undefined;
}

export function getSpectatorSeriesByCompetitor(
  competitorId: string,
): SpectatorSeries | undefined {
  const seriesId = seriesIdByCompetitorId.get(competitorId);
  return seriesId ? bySeriesId.get(seriesId) : undefined;
}

/** Test seam: drop everything held. */
export function clearSpectatorSeries(): void {
  bySeriesId.clear();
  seriesIdByRaceId.clear();
  seriesIdByCompetitorId.clear();
}

// ---- Surviving a reload ----
//
// The store above is module state, so it survives navigation between tabs but
// not a reload. The source path is kept in sessionStorage so a reload can
// re-read the file and rebuild the identical series. sessionStorage is
// per-tab: a spectator URL pasted into someone else's browser finds nothing
// and is told to open the view from the published page, which is the honest
// answer — the shareable link is the published page, not this.

const SOURCE_KEY_PREFIX = 'spectator-source:';

export function rememberSpectatorSource(seriesId: string, source: string): void {
  try {
    sessionStorage.setItem(SOURCE_KEY_PREFIX + seriesId, source);
  } catch {
    // Private mode, or storage disabled. The view still works until reload.
  }
}

export function readSpectatorSource(seriesId: string): string | null {
  try {
    return sessionStorage.getItem(SOURCE_KEY_PREFIX + seriesId);
  } catch {
    return null;
  }
}
