/**
 * The spectator viewer's read-only transport (#475, ADR-012).
 *
 * `apiFetch` consults this before going to the network. A request that names
 * a spectator series — by series id, or by a race or competitor belonging to
 * one — is answered from the in-memory store; everything else falls through
 * untouched, so a signed-in scorer's app is not on this path at all.
 *
 * Two deliberate failures. A non-GET aimed at a spectator series throws:
 * the viewer is read-only, so a write reaching here is a bug and should
 * announce itself rather than appear to succeed. So does a GET for a
 * resource this table doesn't know — better a named error naming the path
 * than a page silently rendering as if the data were empty.
 */
import {
  getSpectatorSeries,
  getSpectatorSeriesByCompetitor,
  getSpectatorSeriesByRace,
  isSpectatorSeriesId,
  type SpectatorSeries,
} from './store';

/** Raised when the viewer is asked for something it cannot answer. Never
 *  expected in a working build — see the note above. */
export class SpectatorTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpectatorTransportError';
  }
}

/** A matched answer. Wrapped so that `undefined` and `null` bodies stay
 *  distinguishable from "not a spectator request". */
export interface SpectatorAnswer {
  body: unknown;
}

/**
 * Answer `path` from the spectator store, or null to let it go to the
 * network. `path` may carry a query string; only the pathname is matched.
 */
export function spectatorRequest(path: string, method: string): SpectatorAnswer | null {
  if (!path.startsWith('/api/v1/')) return null;
  const segments = path.split('?')[0].split('/').filter(Boolean).slice(2);
  const [kind, id, sub, ...rest] = segments;
  if (!id || rest.length > 0) return null;

  const view = resolve(kind, id);
  if (!view) return null;

  if (method !== 'GET') {
    throw new SpectatorTransportError(
      `spectator views are read-only; refusing ${method} ${path}`,
    );
  }
  return { body: read(view, kind, id, sub, path) };
}

/** Which opened view, if any, a path's leading `{kind}/{id}` names. */
function resolve(kind: string, id: string): SpectatorSeries | undefined {
  if (kind === 'series') return isSpectatorSeriesId(id) ? getSpectatorSeries(id) : undefined;
  if (kind === 'races') return getSpectatorSeriesByRace(id);
  if (kind === 'competitors') return getSpectatorSeriesByCompetitor(id);
  return undefined;
}

function read(
  view: SpectatorSeries,
  kind: string,
  id: string,
  sub: string | undefined,
  path: string,
): unknown {
  if (kind === 'series') {
    switch (sub) {
      case undefined: return view.series;
      case 'fleets': return view.fleets;
      case 'competitors': return view.competitors;
      case 'races': return view.races;
      case 'race-starts': return view.raceStarts;
      case 'finishes': return view.finishes;
      case 'sub-series': return view.subSeries;
      // Progressive-handicap history is recomputed from finishes and starting
      // ratings on render, and an import carries no stored overrides — so
      // both are legitimately empty rather than missing.
      case 'rating-overrides': return [];
      case 'tcf-history': return [];
      // A spectator view is nobody's publication and has no split-fleet
      // rounds behind it (a championship publishes no data file at all).
      // Answered rather than refused so a build that asks gets the truth.
      case 'split-fleets': return { config: null, rounds: [] };
      case 'publish': return {
        workspaceSlug: '',
        suggestedSlug: '',
        published: null,
        seasons: [],
        suggestedSeason: '',
      };
    }
  }

  if (kind === 'races') {
    switch (sub) {
      case undefined: return view.races.find((r) => r.id === id);
      case 'finishes': return view.finishes.filter((f) => f.raceId === id);
      case 'starts': return view.raceStarts.filter((s) => s.raceId === id);
      case 'rating-overrides': return [];
    }
  }

  if (kind === 'competitors') {
    switch (sub) {
      case undefined: return view.competitors.find((c) => c.id === id);
      // Who last touched a row: nobody did — this series was read from a file.
      case 'audit': return null;
    }
  }

  throw new SpectatorTransportError(`spectator view cannot answer GET ${path}`);
}
