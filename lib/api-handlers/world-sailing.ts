import 'server-only';

import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import {
  batchIds,
  compareToRecord,
  lookupPersonsByIds,
  WORLD_SAILING_DATAFEED_URL,
  type DatafeedCheck,
  type DatafeedPerson,
  type WorldSailingCheckResult,
} from '@/lib/world-sailing-datafeed';
import { isValidWorldSailingId, normalizeWorldSailingId } from '@/lib/world-sailing';

export type { WorldSailingCheckResult };

/** Where lookups go. Overridable for e2e, which points it at an RFC 6761
 *  `.test` host — never routable, and stubbed below. */
function datafeedUrl(): string {
  return process.env.WORLD_SAILING_DATAFEED_URL || WORLD_SAILING_DATAFEED_URL;
}

/**
 * Check a series' Sailor IDs against World Sailing's datafeed.
 *
 * Server-side because the datafeed is a third-party host a browser can't
 * reach cross-origin — and because sending an event's entry list off to
 * World Sailing is a disclosure that belongs on a route we control rather
 * than in a script tag.
 *
 * The service being unreachable is reported per competitor as
 * "couldn't check", not raised: a scorer's Sailor IDs being unverifiable at
 * 0700 on race day must never be something that blocks the day's scoring.
 */
export async function checkWorldSailingIds(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<WorldSailingCheckResult> {
  // Enforced here, not merely by hiding the button: the route reaches an
  // external service, so a direct hit has to fail closed.
  requireFeature(workspace, 'world-sailing-id');
  const repos = createRepos(workspace);
  const competitors = await repos.competitors.listBySeries(seriesId);

  const withoutId: string[] = [];
  const checks: DatafeedCheck[] = [];
  const wanted: { competitorId: string; id: string; names: string[]; nationality?: string }[] = [];

  for (const c of competitors) {
    const id = normalizeWorldSailingId(c.worldSailingId);
    if (!id) {
      withoutId.push(c.id);
      continue;
    }
    if (!isValidWorldSailingId(id)) {
      // Never sent: a malformed ID can only come back "unknown", which reads
      // as "World Sailing doesn't have them" rather than "this isn't an ID".
      checks.push({ competitorId: c.id, worldSailingId: id, outcome: { status: 'malformed' } });
      continue;
    }
    wanted.push({
      competitorId: c.id,
      id,
      names: c.names,
      ...(c.nationality ? { nationality: c.nationality } : {}),
    });
  }

  const url = datafeedUrl();
  const stubbed = new URL(url).hostname.endsWith('.test');
  const found = new Map<string, DatafeedPerson>();
  let unavailable: string | null = null;

  if (!stubbed) {
    // Distinct IDs only — a doubled ID is a data problem the seeding join
    // reports; there's no reason to ask World Sailing about it twice.
    const ids = [...new Set(wanted.map((w) => w.id))];
    for (const batch of batchIds(ids)) {
      try {
        for (const person of await lookupPersonsByIds(batch, { baseUrl: url })) {
          found.set(person.worldSailingId, person);
        }
      } catch (err) {
        unavailable = err instanceof Error ? err.message : String(err);
        break;
      }
    }
  } else {
    unavailable = 'the datafeed is stubbed in this environment';
  }

  for (const w of wanted) {
    const person = found.get(w.id);
    checks.push({
      competitorId: w.competitorId,
      worldSailingId: w.id,
      outcome: person
        ? compareToRecord({ names: w.names, ...(w.nationality ? { nationality: w.nationality } : {}) }, person)
        : unavailable != null
          ? { status: 'unavailable', reason: unavailable }
          : { status: 'unknown' },
    });
  }

  return { checks, withoutId };
}
