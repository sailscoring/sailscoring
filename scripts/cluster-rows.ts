/**
 * Pure clustering bridge (#218): cluster competitor rows fed in as JSON, with no
 * database.
 *
 * The as-published archive apply clusters a live workspace; this exposes the
 * same canonical matcher (`lib/competitor-identity-cluster.ts`) to an
 * *external* caller that already owns its rows — notably the `iodai-archive`
 * manifest bootstrap, which clusters the reconstructed corpus keyed by its own
 * `(series-slug, sail)` identifiers (the app mints fresh competitor ids on
 * import, so those can't be recovered after the fact). Keeping one matcher
 * means the draft manifest matches what the workspace apply would produce.
 *
 * Reads a `ClusterInput[]` JSON array on stdin, writes the `ClusterResult` JSON
 * to stdout. The caller's `competitorId` strings are opaque to the matcher and
 * come back verbatim in each cluster's `competitorIds`, so the caller maps them
 * back to whatever it likes.
 *
 *   cat rows.json | pnpm cluster-rows > clusters.json
 *
 * Stdin is either the `ClusterInput[]` array itself, or
 * `{ homeClub?, rows: ClusterInput[] }` when the corpus needs a setting the
 * workspace apply would read from the workspace (#507).
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
    // A caller clustering a crewed corpus must be able to say which slot a
    // person came out of (#348) — otherwise it gets the workspace apply's
    // answer for a single-handed class and drafts a manifest the apply won't
    // reproduce.
    ...(r.role === 'crew' ? { role: 'crew' as const } : {}),
  };
}

export function clusterRowsJson(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`input is not valid JSON: ${(err as Error).message}`);
  }
  // A bare array is the rows; an object carries them under `rows` alongside
  // the settings the workspace apply would read from the workspace itself —
  // today just `homeClub` (#507), which an archive of a club whose entries
  // mostly state no club needs in order to draft the manifest the apply will
  // reproduce.
  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null
      ? (parsed as { rows?: unknown }).rows
      : undefined;
  if (!Array.isArray(rows)) {
    throw new Error(
      'input must be a JSON array of competitor rows, or an object with a "rows" array',
    );
  }
  const homeClub =
    !Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null
      ? (parsed as { homeClub?: unknown }).homeClub
      : undefined;
  if (homeClub !== undefined && typeof homeClub !== 'string') {
    throw new Error('"homeClub" must be a string');
  }
  const inputs = rows.map(toClusterInput);
  return JSON.stringify(clusterCompetitors(inputs, { homeClub }));
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
