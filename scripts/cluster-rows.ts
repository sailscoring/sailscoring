/**
 * Pure clustering bridge (#218): cluster competitor rows fed in as JSON, with no
 * database.
 *
 * `reconcile-identities` clusters a live workspace; this exposes the same
 * canonical matcher (`lib/competitor-identity-cluster.ts`) to an *external*
 * caller that already owns its rows — notably the `iodai-archive` manifest
 * bootstrap, which clusters the reconstructed corpus keyed by its own
 * `(series-slug, sail)` identifiers (the app mints fresh competitor ids on
 * import, so those can't be recovered after the fact). Keeping one matcher means
 * the draft manifest matches what `reconcile-identities` would produce.
 *
 * Reads a `ClusterInput[]` JSON array on stdin, writes the `ClusterResult` JSON
 * to stdout. The caller's `competitorId` strings are opaque to the matcher and
 * come back verbatim in each cluster's `competitorIds`, so the caller maps them
 * back to whatever it likes.
 *
 *   cat rows.json | pnpm cluster-rows > clusters.json
 */

import { clusterCompetitors, type ClusterInput } from '@/lib/competitor-identity-cluster';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Coerce one parsed object into a ClusterInput, tolerating missing optionals. */
export function toClusterInput(raw: unknown, i: number): ClusterInput {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`row ${i} is not an object`);
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.competitorId !== 'string' || !r.competitorId) {
    throw new Error(`row ${i} is missing a string "competitorId"`);
  }
  if (typeof r.name !== 'string') {
    throw new Error(`row ${i} is missing a string "name"`);
  }
  return {
    competitorId: r.competitorId,
    name: r.name,
    sailNumber: typeof r.sailNumber === 'string' ? r.sailNumber : '',
    club: typeof r.club === 'string' ? r.club : undefined,
    nationality: typeof r.nationality === 'string' ? r.nationality : undefined,
    age: typeof r.age === 'number' ? r.age : null,
    raceYear: typeof r.raceYear === 'number' ? r.raceYear : null,
    existingIdentityId:
      typeof r.existingIdentityId === 'string' ? r.existingIdentityId : null,
  };
}

export function clusterRowsJson(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`input is not valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('input must be a JSON array of competitor rows');
  }
  const inputs = parsed.map(toClusterInput);
  return JSON.stringify(clusterCompetitors(inputs));
}

const isMain = require.main === module;
if (isMain) {
  void (async () => {
    try {
      const out = clusterRowsJson(await readStdin());
      process.stdout.write(out + '\n');
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  })();
}
