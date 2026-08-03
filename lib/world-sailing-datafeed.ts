/**
 * World Sailing's datafeed — "does this Sailor ID exist, and is it the sailor
 * we think it is?"
 *
 * The service answers XRR (World Sailing's XML regatta-reporting schema)
 * over `datafeed.sailing.org/query`, documented at sailing.org/xml/. Two
 * lookups matter here:
 *
 *   ?type=Person&IFPersonID=IRLMM1,GBRHM15   — by Sailor ID, comma-separated
 *   ?type=Person&FamilyName=&GivenName=&NOC= — by name, to find an ID
 *
 * A biography carries far more than we asked for — date of birth, place of
 * birth, club, coach. We deliberately read only the name and nation, which is
 * all that answers the scorer's question; the rest is World Sailing's to hold,
 * not ours to copy into a scoring database.
 *
 * Nothing here throws on a bad ID. A lookup that finds nothing is an answer,
 * and the service being down is a "couldn't check" — never a reason a scorer
 * can't get on with scoring.
 */

/** Documented base URL. https works today; the published docs still say http. */
export const WORLD_SAILING_DATAFEED_URL = 'https://datafeed.sailing.org/query';

/** How many IDs go in one request. The service takes a comma-separated list;
 *  this keeps the URL well inside any sane limit and the response small. */
export const DATAFEED_BATCH_SIZE = 50;

/** A person as the datafeed describes them — the fields we choose to read. */
export interface DatafeedPerson {
  worldSailingId: string;
  familyName?: string;
  givenName?: string;
  nationality?: string;
}

export type DatafeedOutcome =
  /** The ID resolves, and the name and nation agree with ours. */
  | { status: 'valid'; person: DatafeedPerson }
  /** The ID resolves to someone else — the case that catches a transposed ID. */
  | { status: 'mismatch'; person: DatafeedPerson; on: ('name' | 'nation')[] }
  /** World Sailing has no such ID. */
  | { status: 'unknown' }
  /** Doesn't match the published format, so it was never sent. */
  | { status: 'malformed' }
  /** The service couldn't be reached or didn't answer usefully. */
  | { status: 'unavailable'; reason: string };

export interface DatafeedCheck {
  competitorId: string;
  worldSailingId: string;
  outcome: DatafeedOutcome;
}

export interface WorldSailingCheckResult {
  checks: DatafeedCheck[];
  /** Competitors carrying no Sailor ID at all — nothing was looked up for
   *  them, and that is not an error. */
  withoutId: string[];
}

/**
 * Pull `Person` records out of an XRR response.
 *
 * Deliberately attribute-scraping rather than a full XML parse: the payload
 * is a flat list of attribute-only elements, the schema has changed shape
 * before, and a tolerant reader degrades to "unknown" where a strict one
 * would throw and take the whole batch with it.
 */
export function parsePersonRecords(xml: string): DatafeedPerson[] {
  const people: DatafeedPerson[] = [];
  for (const match of xml.matchAll(/<Person\b([^>]*)\/?>/gi)) {
    const attrs = match[1];
    const attr = (name: string): string | undefined => {
      const hit = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(attrs);
      const value = hit?.[1]?.trim();
      return value ? value : undefined;
    };
    const id = attr('IFPersonID');
    if (!id) continue;
    people.push({
      worldSailingId: id.toUpperCase(),
      ...(attr('FamilyName') ? { familyName: attr('FamilyName') } : {}),
      ...(attr('GivenName') ? { givenName: attr('GivenName') } : {}),
      ...(attr('NOC') ? { nationality: attr('NOC')!.toUpperCase() } : {}),
    });
  }
  return people;
}

/** Split a list into fixed-size chunks. */
export function batchIds(ids: readonly string[], size = DATAFEED_BATCH_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push([...ids.slice(i, i + size)]);
  return out;
}

/** One batch lookup by Sailor ID. Returns whatever the service knew about;
 *  IDs it didn't recognise are simply absent from the result. */
export async function lookupPersonsByIds(
  ids: readonly string[],
  opts?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<DatafeedPerson[]> {
  if (ids.length === 0) return [];
  const doFetch = opts?.fetchImpl ?? fetch;
  const url = new URL(opts?.baseUrl ?? WORLD_SAILING_DATAFEED_URL);
  url.searchParams.set('type', 'Person');
  url.searchParams.set('IFPersonID', ids.join(','));
  const res = await doFetch(url.toString(), {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)',
    },
  });
  if (!res.ok) throw new Error(`World Sailing datafeed: HTTP ${res.status}`);
  return parsePersonRecords(await res.text());
}

/** Look a sailor up by name and nation, to find an ID we don't hold. */
export async function lookupPersonsByName(
  query: { familyName?: string; givenName?: string; nationality?: string },
  opts?: { baseUrl?: string; fetchImpl?: typeof fetch },
): Promise<DatafeedPerson[]> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const url = new URL(opts?.baseUrl ?? WORLD_SAILING_DATAFEED_URL);
  url.searchParams.set('type', 'Person');
  if (query.familyName) url.searchParams.set('FamilyName', query.familyName);
  if (query.givenName) url.searchParams.set('GivenName', query.givenName);
  if (query.nationality) url.searchParams.set('NOC', query.nationality.toUpperCase());
  const res = await doFetch(url.toString(), {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; SailScoring/1.0; +https://app.sailscoring.ie)',
    },
  });
  if (!res.ok) throw new Error(`World Sailing datafeed: HTTP ${res.status}`);
  return parsePersonRecords(await res.text());
}

/** Loose comparison for the mismatch check: accents, case, punctuation and
 *  name order are all differences we don't care about. Reused from the
 *  seeding-list join so "mismatch" means the same thing in both places. */
function looseName(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/**
 * Compare what we hold against what the datafeed returned.
 *
 * A name difference is reported, not corrected: the entry list is what the
 * event runs on, and a World Sailing record can be years stale. Nation is
 * compared only when we hold one — a blank nationality is a gap the scorer
 * may want to fill, not a contradiction.
 */
export function compareToRecord(
  held: { names: readonly string[]; nationality?: string },
  person: DatafeedPerson,
): DatafeedOutcome {
  const on: ('name' | 'nation')[] = [];
  const theirs = looseName([person.givenName, person.familyName].filter(Boolean).join(' '));
  const ours = held.names.map(looseName).filter(Boolean);
  // Any of the entry's primary names agreeing is agreement: a two-name entry
  // still only carries one Sailor ID.
  if (theirs && ours.length > 0 && !ours.includes(theirs)) on.push('name');
  if (
    held.nationality &&
    person.nationality &&
    held.nationality.toUpperCase() !== person.nationality
  ) {
    on.push('nation');
  }
  return on.length > 0 ? { status: 'mismatch', person, on } : { status: 'valid', person };
}
