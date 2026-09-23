// Not marked `server-only`: the desk script (`pnpm racesense:inspect`) reads
// the player from node with the same code. Nothing here is a secret, and
// the API handler that fronts it is the server seam.

import {
  currentRevision,
  readRaceSenseRegatta,
  type RaceSenseRegatta,
  type RaceSenseRegattaHistory,
} from './racesense-regatta';

/**
 * Fetch the regatta behind a RaceSense player replay.
 *
 * The player serves its own event metadata, unauthenticated, and this is
 * the read its replay runs on. Nothing here is a published API: Vakaros
 * can change or close it at any time, and when they do the read fails
 * cleanly with a sentence the scorer can act on — the committee's workbook
 * export is the fallback.
 *
 * `docs/notes/racesense/regatta-api.md` describes what comes back.
 */

const ENDPOINT = 'https://player.vakaros.com/api/regatta';

const documentUrl = (regattaId: string): string =>
  `${ENDPOINT}?event=${encodeURIComponent(regattaId)}`;

/** A regatta is a few hundred KB; give a championship's worth room. */
const FETCH_TIMEOUT_MS = 30_000;

export type RaceSensePlayerFailure =
  | 'refused'      // the read was rejected: the endpoint is no longer open
  | 'not-found'    // no regatta with that id
  | 'unreachable'  // network, timeout, or an answer that wasn't a regatta
  ;

/** A read that failed for a reason the scorer should hear in full. */
export class RaceSensePlayerError extends Error {
  constructor(public readonly failure: RaceSensePlayerFailure, message: string) {
    super(message);
    this.name = 'RaceSensePlayerError';
  }
}

const FALLBACK = 'Import the committee’s RaceSense export instead.';

async function fetchWithTimeout(url: string): Promise<Response> {
  try {
    return await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RaceSensePlayerError('unreachable',
      `Couldn’t reach the RaceSense player’s data (${reason}). ${FALLBACK}`);
  }
}

/** The regatta's revision history, as the endpoint returns it. */
export async function fetchRaceSenseRegattaHistory(
  regattaId: string,
): Promise<RaceSenseRegattaHistory> {
  const res = await fetchWithTimeout(documentUrl(regattaId));
  if (res.status === 404) {
    throw new RaceSensePlayerError('not-found',
      `The RaceSense player has no regatta with the id ${regattaId}. Check the URL — the id is the part after /watch/.`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new RaceSensePlayerError('refused',
      `The RaceSense player refused the read (HTTP ${res.status}). Its data may no longer be open to read this way. ${FALLBACK}`);
  }
  if (!res.ok) {
    throw new RaceSensePlayerError('unreachable',
      `The RaceSense player’s data answered HTTP ${res.status}. ${FALLBACK}`);
  }
  let history: unknown;
  try {
    history = await res.json();
  } catch {
    throw new RaceSensePlayerError('unreachable',
      `The RaceSense player answered with something other than a regatta. ${FALLBACK}`);
  }
  if (currentRevision(history) === null) {
    throw new RaceSensePlayerError('unreachable',
      `The RaceSense player answered with something other than a regatta. ${FALLBACK}`);
  }
  return history as RaceSenseRegattaHistory;
}

/** The regatta, narrowed to what the import reads. */
export async function fetchRaceSenseRegatta(regattaId: string): Promise<RaceSenseRegatta> {
  const history = await fetchRaceSenseRegattaHistory(regattaId);
  return readRaceSenseRegatta(currentRevision(history) ?? {}, regattaId);
}
