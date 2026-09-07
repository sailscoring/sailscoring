import 'server-only';

import {
  readRaceSenseRegattaDocument,
  type FirestoreDocument,
  type RaceSenseRegatta,
} from './racesense-regatta';

/**
 * Fetch the regatta document behind a RaceSense player replay.
 *
 * The player is a Firebase app. Its Firestore rules let any signed-in user
 * read a regatta, and anonymous sign-in is enabled, so the read is: mint an
 * anonymous user with the player's public web key, then GET the document
 * with that user's ID token. Nothing here is a published API. Vakaros can
 * tighten the rules or rotate the key at any time, and when they do the
 * read fails cleanly with a sentence the scorer can act on — the
 * committee's workbook export is always the fallback.
 *
 * The anonymous token is kept for its hour rather than minted per fetch:
 * each sign-up creates a throwaway user on Vakaros's project, and a
 * championship re-reads the same regatta after every race.
 */

const PROJECT = 'vakaros-racesense';

/**
 * The player's public Firebase web key, as shipped in its page bundle. A
 * web key identifies the Firebase project to the client SDK; it is not a
 * secret and grants nothing the rules don't. Overridable in case it is
 * rotated between deploys.
 */
const WEB_KEY = process.env.RACESENSE_PLAYER_WEB_KEY ?? '';

const SIGN_UP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${WEB_KEY}`;

const documentUrl = (regattaId: string): string =>
  `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/regattas/${encodeURIComponent(regattaId)}`;

/** How long before the token's stated expiry to stop trusting it. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

/** A regatta document is ~10 MB of mostly positions; give it time. */
const FETCH_TIMEOUT_MS = 60_000;

export type RaceSensePlayerFailure =
  | 'refused'      // the sign-in or the read was rejected: the rules or the key changed
  | 'not-found'    // no regatta with that id
  | 'unreachable'  // network, timeout, or an answer that wasn't the document
  ;

/** A read that failed for a reason the scorer should hear in full. */
export class RaceSensePlayerError extends Error {
  constructor(public readonly failure: RaceSensePlayerFailure, message: string) {
    super(message);
    this.name = 'RaceSensePlayerError';
  }
}

const FALLBACK = 'Import the committee’s RaceSense export instead.';

interface CachedToken {
  idToken: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RaceSensePlayerError('unreachable',
      `Couldn’t reach the RaceSense player’s data (${reason}). ${FALLBACK}`);
  }
}

/** An anonymous user's ID token, minted or reused. */
async function anonymousToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.idToken;

  const res = await fetchWithTimeout(SIGN_UP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!res.ok) {
    throw new RaceSensePlayerError('refused',
      `The RaceSense player refused an anonymous sign-in (HTTP ${res.status}). Its data may no longer be open to read this way. ${FALLBACK}`);
  }
  const body = (await res.json()) as { idToken?: unknown; expiresIn?: unknown };
  if (typeof body.idToken !== 'string') {
    throw new RaceSensePlayerError('unreachable',
      `The RaceSense player’s sign-in answered without a token. ${FALLBACK}`);
  }
  const expiresIn = Number(body.expiresIn);
  cached = {
    idToken: body.idToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 3600_000) - TOKEN_MARGIN_MS,
  };
  return cached.idToken;
}

/** The raw document, as the REST API returns it. */
export async function fetchRaceSenseRegattaDocument(regattaId: string): Promise<FirestoreDocument> {
  const token = await anonymousToken();
  const res = await fetchWithTimeout(documentUrl(regattaId), {
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    throw new RaceSensePlayerError('not-found',
      `The RaceSense player has no regatta with the id ${regattaId}. Check the URL — the id is the part after /watch/.`);
  }
  if (res.status === 401 || res.status === 403) {
    // A stale token reads the same as tightened rules; drop it so the next
    // attempt signs in afresh, and say what a scorer can do now.
    cached = null;
    throw new RaceSensePlayerError('refused',
      `The RaceSense player refused the read (HTTP ${res.status}). Its data may no longer be open to read this way. ${FALLBACK}`);
  }
  if (!res.ok) {
    throw new RaceSensePlayerError('unreachable',
      `The RaceSense player’s data answered HTTP ${res.status}. ${FALLBACK}`);
  }
  const doc = (await res.json()) as FirestoreDocument;
  if (!doc || typeof doc !== 'object' || !doc.fields) {
    throw new RaceSensePlayerError('unreachable',
      `The RaceSense player answered with something other than a regatta. ${FALLBACK}`);
  }
  return doc;
}

/** The regatta, narrowed to what the import reads. */
export async function fetchRaceSenseRegatta(regattaId: string): Promise<RaceSenseRegatta> {
  const doc = await fetchRaceSenseRegattaDocument(regattaId);
  return readRaceSenseRegattaDocument(doc, regattaId);
}
