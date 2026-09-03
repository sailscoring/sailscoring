/**
 * Reading a published data file into a spectator view (#475, ADR-012).
 *
 * The import that fills a workspace from an export already exists, and it
 * writes through repository interfaces — so pointing it at collecting
 * in-memory repositories is the whole of the work. Nothing here touches the
 * server, and nothing it produces can be written back.
 *
 * Imported only by the route that opens a view, never by the transport: it
 * pulls in the whole public-export module, which has no business in every
 * page's bundle.
 */
import { importPublicExport, type ImportRepos, type PublicSeriesExport } from '../public-export';
import type { SeriesFileSplitRound } from '../series-file';
import type { SplitFleetConfig, SplitRound } from '../split-fleets';
import type {
  Competitor,
  Finish,
  Fleet,
  Race,
  RaceStart,
  Series,
  SubSeries,
} from '../types';
import {
  putSpectatorSeries,
  rememberSpectatorSource,
  SPECTATOR_ID_PREFIX,
  type SpectatorSeries,
} from './store';

/** Raised for a source path or file the viewer will not open. `gone` marks
 *  the one case worth its own words: the results were unpublished. */
export class SpectatorOpenError extends Error {
  constructor(message: string, readonly gone = false) {
    super(message);
    this.name = 'SpectatorOpenError';
  }
}

/**
 * Whether a path may be fetched as a data file.
 *
 * Only a plain, same-origin path under `/p/` — the published tree. An
 * absolute URL, or anything reaching upwards, is refused rather than turning
 * this into a relay that fetches whatever it is handed.
 */
export function isSpectatorSource(source: string): boolean {
  return /^\/p\/[^?#]+$/.test(source) && !source.includes('..');
}

/**
 * Stable 32-bit FNV-1a over the source path. The viewer's ids derive from
 * this, so re-opening the same file rebuilds the same series and any link
 * into it still resolves. Not security-bearing: a collision would only mean
 * two views sharing a slot in a single tab.
 */
function sourceHash(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) {
    h ^= source.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The series id a given data file opens as. */
export function spectatorSeriesId(source: string): string {
  return `${SPECTATOR_ID_PREFIX}${sourceHash(source)}`;
}

/** Collecting repositories: the subset of the import's writes, kept in
 *  memory. Anything the import does not call is deliberately absent — the
 *  cast is the contract that this is a write sink, not a repository. */
function collectingRepos(): { repos: ImportRepos; collected: Collected } {
  const collected: Collected = {
    series: undefined,
    fleets: [],
    competitors: [],
    races: [],
    raceStarts: [],
    finishes: [],
    subSeries: [],
    splitFleets: null,
  };
  const repos = {
    listSeriesNames: async () => [],
    seriesRepo: { save: async (s: Series) => { collected.series = s; return s; } },
    fleetRepo: { save: async (f: Fleet) => { collected.fleets.push(f); return f; } },
    competitorRepo: { save: async (c: Competitor) => { collected.competitors.push(c); return c; } },
    raceRepo: { save: async (r: Race) => { collected.races.push(r); return r; } },
    raceStartRepo: { save: async (s: RaceStart) => { collected.raceStarts.push(s); return s; } },
    finishRepo: { saveMany: async (list: Finish[]) => { collected.finishes.push(...list); } },
    subSeriesRepo: { saveMany: async (list: SubSeries[]) => { collected.subSeries.push(...list); } },
    splitFleets: {
      get: async () => null,
      replace: async (
        seriesId: string,
        data: { config: SplitFleetConfig | null; rounds: SeriesFileSplitRound[] },
      ) => {
        collected.splitFleets = data.config
          ? {
              config: data.config,
              rounds: data.rounds.map((r) => ({
                ...r,
                seriesId,
                // The export carries the method as written, since a build
                // that meets a newer one should not silently deal the round
                // again under a method it does know.
                method: r.method as SplitRound['method'],
                basis: r.basis ?? null,
              })),
            }
          : null;
        // Round ownership on the fleets, which nothing else carries: the
        // server writer derives it from each round's fleet list, and the
        // fleet colours and the entry list's current-fleet collapse both
        // read it back off the fleet.
        const roundIdByFleetId = new Map(
          data.rounds.flatMap((r) => r.fleetIds.map((id) => [id, r.id] as const)),
        );
        for (const fleet of collected.fleets) {
          const roundId = roundIdByFleetId.get(fleet.id);
          if (roundId) fleet.splitRoundId = roundId;
        }
      },
    },
  } as unknown as ImportRepos;
  return { repos, collected };
}

interface Collected {
  series: Series | undefined;
  fleets: Fleet[];
  competitors: Competitor[];
  races: Race[];
  raceStarts: RaceStart[];
  finishes: Finish[];
  subSeries: SubSeries[];
  splitFleets: { config: SplitFleetConfig; rounds: SplitRound[] } | null;
}

/** Read an already-parsed export into a view, without holding it. */
export function buildSpectatorSeries(
  data: PublicSeriesExport,
  source: string,
): Promise<SpectatorSeries> {
  const seriesId = spectatorSeriesId(source);
  const hash = sourceHash(source);
  let n = 0;
  const { repos, collected } = collectingRepos();
  return importPublicExport(data, repos, {
    seriesId,
    newId: () => `${hash}-${(++n).toString(36)}`,
  }).then(() => {
    if (!collected.series) {
      throw new SpectatorOpenError('That results file has no series in it.');
    }
    return {
      seriesId,
      source,
      series: collected.series,
      fleets: collected.fleets,
      competitors: collected.competitors,
      races: collected.races,
      raceStarts: collected.raceStarts,
      finishes: collected.finishes,
      subSeries: collected.subSeries,
      splitFleets: collected.splitFleets,
    };
  });
}

/**
 * Fetch a published data file and hold it as a spectator view, returning the
 * series id to route to. Idempotent for a given path: re-opening rebuilds the
 * identical series, which is what makes a reload work.
 */
export async function openSpectatorSeries(source: string): Promise<string> {
  if (!isSpectatorSource(source)) {
    throw new SpectatorOpenError('That is not a Sail Scoring results link.');
  }

  let res: Response;
  try {
    res = await fetch(source);
  } catch {
    throw new SpectatorOpenError('Could not reach the results data. Check your connection and try again.');
  }
  if (res.status === 404) {
    throw new SpectatorOpenError(
      'These results are no longer published, so there is nothing left to open.',
      true,
    );
  }
  if (!res.ok) {
    throw new SpectatorOpenError('Could not read the results data from that link.');
  }

  let data: PublicSeriesExport;
  try {
    data = (await res.json()) as PublicSeriesExport;
    if (!(data.version >= 1) || !data.series?.name) throw new Error('unrecognised');
  } catch {
    throw new SpectatorOpenError('That file is not in a format this version can read.');
  }

  const view = await buildSpectatorSeries(data, source);
  putSpectatorSeries(view);
  rememberSpectatorSource(view.seriesId, source);
  return view.seriesId;
}
