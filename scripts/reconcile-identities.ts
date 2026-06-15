/**
 * Cross-series competitor-identity reconcile pass (#212).
 *
 * Loads every competitor row in a workspace, clusters them into recurring
 * identities with the pure core in `lib/competitor-identity-cluster.ts`, and —
 * with `--apply` — writes a `competitor_identities` row per cluster and stamps
 * `competitors.identity_id`. This is the batch backfill for the IODAI corpus
 * (≈180 series back to 2009): you don't hand-link ~15k rows, you cluster them,
 * eyeball the stats and suggestions, then confirm in the reconcile UI.
 *
 * Re-runnable and idempotent: rows already linked seed their cluster, a
 * second pass with no new competitors is a no-op, and a cluster that would span
 * two already-confirmed identities is reported as a conflict and never merged.
 *
 * Usage:
 *   pnpm reconcile-identities <workspace>            # dry run: stats + samples
 *   pnpm reconcile-identities <workspace> --apply    # write identities + links
 *   pnpm reconcile-identities <workspace> --json      # machine-readable clusters
 *
 * <workspace> is an organization slug or id. Reads DATABASE_URL.
 */

import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, or } from 'drizzle-orm';

import {
  clusterCompetitors,
  isLongArc,
  LONG_ARC_YEARS,
  type ClusterInput,
  type ClusterResult,
  type IdentityCluster,
} from '@/lib/competitor-identity-cluster';
import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { competitorIdentities, competitors, series } from '@/lib/db/schema/series';

/**
 * Delete every identity in the workspace (the FK's ON DELETE SET NULL clears
 * `competitors.identity_id` for us), so the next pass rebuilds from scratch.
 * Identities are derived data, so a rebuild is the clean way to retire a whole
 * class of bad merge after a matcher fix — but it also discards any manual
 * renames/splits, hence the `--reset` guard. Returns how many were removed.
 */
export async function resetIdentities(
  db: SailScoringDb,
  workspaceId: string,
): Promise<number> {
  const removed = await db
    .delete(competitorIdentities)
    .where(eq(competitorIdentities.workspaceId, workspaceId))
    .returning({ id: competitorIdentities.id });
  return removed.length;
}

/** Resolve a slug or id to a workspace (organization) id + display name. */
async function resolveWorkspace(
  db: SailScoringDb,
  ref: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(or(eq(organization.id, ref), eq(organization.slug, ref)))
    .limit(1);
  return rows[0] ?? null;
}

/** Load the flattened competitor rows the clusterer needs. */
export async function collectClusterInputs(
  db: SailScoringDb,
  workspaceId: string,
): Promise<ClusterInput[]> {
  const rows = await db
    .select({
      competitorId: competitors.id,
      name: competitors.name,
      sailNumber: competitors.sailNumber,
      club: competitors.club,
      nationality: competitors.nationality,
      age: competitors.age,
      startDate: series.startDate,
      existingIdentityId: competitors.identityId,
    })
    .from(competitors)
    .innerJoin(series, eq(competitors.seriesId, series.id))
    .where(eq(competitors.workspaceId, workspaceId));

  return rows.map((r) => {
    const year = Number.parseInt((r.startDate ?? '').slice(0, 4), 10);
    return {
      competitorId: r.competitorId,
      name: r.name,
      sailNumber: r.sailNumber,
      club: r.club ?? undefined,
      nationality: r.nationality ?? undefined,
      age: r.age,
      raceYear: Number.isFinite(year) ? year : null,
      existingIdentityId: r.existingIdentityId ?? null,
    };
  });
}

interface ApplyResult {
  identitiesCreated: number;
  competitorsLinked: number;
  conflictsSkipped: number;
}

/** Write identities + links for the clustering result, in one transaction. */
export async function applyClusters(
  db: SailScoringDb,
  workspaceId: string,
  result: ClusterResult,
): Promise<ApplyResult> {
  let identitiesCreated = 0;
  let competitorsLinked = 0;
  let conflictsSkipped = 0;

  await db.transaction(async (tx) => {
    for (const cluster of result.clusters) {
      const existing = cluster.existingIdentityIds;
      if (existing.length >= 2) {
        // A confirmed-identity collision — never auto-merge what a human split.
        conflictsSkipped++;
        continue;
      }

      let identityId: string;
      if (existing.length === 1) {
        identityId = existing[0];
      } else {
        identityId = randomUUID();
        await tx.insert(competitorIdentities).values({
          id: identityId,
          workspaceId,
          label: cluster.label,
          sailNumber: cluster.sailNumber,
          club: cluster.club,
          nationality: cluster.nationality,
        });
        identitiesCreated++;
      }

      // Only touch currently-unlinked rows: the reuse case leaves confirmed
      // links untouched, which is what keeps a re-run idempotent.
      const res = await tx
        .update(competitors)
        .set({ identityId })
        .where(
          and(
            eq(competitors.workspaceId, workspaceId),
            isNull(competitors.identityId),
            inArray(competitors.id, cluster.competitorIds),
          ),
        );
      competitorsLinked += res.count ?? 0;
    }
  });

  return { identitiesCreated, competitorsLinked, conflictsSkipped };
}

// ─── rendering ───────────────────────────────────────────────────────────────

function clusterLine(c: IdentityCluster): string {
  const span =
    c.firstYear != null && c.lastYear != null
      ? c.firstYear === c.lastYear
        ? `${c.firstYear}`
        : `${c.firstYear}–${c.lastYear}`
      : '????';
  const n = c.competitorIds.length;
  return `  ${c.label.padEnd(24)} ${String(n).padStart(2)} series  ${span.padEnd(9)} ${c.sailNumber.padEnd(8)} ${c.club ?? ''}`;
}

function renderReport(result: ClusterResult): string {
  const { stats, clusters, suggestions } = result;
  const lines: string[] = [];
  lines.push('Reconcile dry run');
  lines.push('─────────────────');
  lines.push(`competitors:        ${stats.competitors}`);
  lines.push(`→ identities:       ${stats.clusters}`);
  lines.push(`  singletons:       ${stats.singletons}`);
  lines.push(`  multi-series:     ${stats.multiRowClusters}`);
  lines.push(`  largest:          ${stats.largestCluster} series`);
  lines.push(`rows w/o surname:   ${stats.withoutSurname}`);
  lines.push(`review suggestions: ${stats.suggestions}`);
  lines.push(`confirmed conflicts:${stats.conflicts}`);
  lines.push(`long arcs (>${LONG_ARC_YEARS}y):    ${stats.longArcs}  (likely over-merges to split)`);
  lines.push('');
  lines.push(
    `cluster sizes: ${Object.entries(stats.sizeHistogram)
      .sort((a, b) => (a[0] === '10+' ? 1 : b[0] === '10+' ? -1 : Number(a[0]) - Number(b[0])))
      .map(([k, v]) => `${k}×${v}`)
      .join('  ')}`,
  );
  lines.push('');

  // Over-long arcs first — these are the most likely over-merges to split.
  const longArcs = clusters
    .filter(isLongArc)
    .sort((a, b) => b.competitorIds.length - a.competitorIds.length)
    .slice(0, 15);
  if (longArcs.length) {
    lines.push(`Suspiciously long arcs (>${LONG_ARC_YEARS}y span — review for over-merge):`);
    longArcs.forEach((c) => lines.push(clusterLine(c)));
    lines.push('');
  }

  // The deepest arcs by series count — eyeball these too.
  const deepest = [...clusters]
    .filter((c) => c.competitorIds.length >= 2)
    .sort((a, b) => b.competitorIds.length - a.competitorIds.length)
    .slice(0, 15);
  if (deepest.length) {
    lines.push(`Deepest career arcs (top ${deepest.length}):`);
    deepest.forEach((c) => lines.push(clusterLine(c)));
    lines.push('');
  }

  if (suggestions.length) {
    lines.push(`Review suggestions (name matches, no corroboration) — top 15:`);
    suggestions.slice(0, 15).forEach((s) => {
      const a = clusters[s.a];
      const b = clusters[s.b];
      lines.push(
        `  ? "${a.label}" (${a.sailNumber}, ${a.club ?? '—'}) ~ "${b.label}" (${b.sailNumber}, ${b.club ?? '—'})`,
      );
    });
    lines.push('');
  }
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function usage(): string {
  return `reconcile-identities — cluster a workspace's competitors into recurring identities (#212)

  pnpm reconcile-identities <workspace> [--apply] [--reset] [--json]

  <workspace>   organization slug or id
  --apply       write competitor_identities rows and stamp competitors.identity_id
                (default is a dry run that writes nothing)
  --reset       before applying, delete the workspace's existing identities and
                rebuild from scratch (requires --apply). Use after a matcher fix
                to retire bad merges wholesale. Discards manual renames/splits.
  --json        emit the full clustering result as JSON

Reads DATABASE_URL.`;
}

export async function runCli(argv: string[]): Promise<number> {
  let workspaceRef: string | undefined;
  let apply = false;
  let reset = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--apply') apply = true;
    else if (arg === '--reset') reset = true;
    else if (arg === '--json') json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      return 0;
    } else if (arg.startsWith('-')) {
      console.error(`unknown flag: ${arg}\n`);
      console.error(usage());
      return 1;
    } else if (!workspaceRef) {
      workspaceRef = arg;
    } else {
      console.error(`unexpected argument: ${arg}\n`);
      console.error(usage());
      return 1;
    }
  }
  if (!workspaceRef) {
    console.error('a workspace slug or id is required\n');
    console.error(usage());
    return 1;
  }
  if (reset && !apply) {
    console.error('--reset rewrites data; pass --apply to confirm the rebuild\n');
    console.error(usage());
    return 1;
  }

  const db = getDb();
  const ws = await resolveWorkspace(db, workspaceRef);
  if (!ws) {
    console.error(`no workspace matching "${workspaceRef}"`);
    return 1;
  }

  if (reset) {
    const removed = await resetIdentities(db, ws.id);
    console.log(`Reset: removed ${removed} existing identities (links cleared).`);
  }

  const inputs = await collectClusterInputs(db, ws.id);
  const result = clusterCompetitors(inputs);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(`Workspace: ${ws.name} (${ws.id})`);
  console.log(renderReport(result));

  if (apply) {
    const applied = await applyClusters(db, ws.id, result);
    console.log('Applied:');
    console.log(`  identities created: ${applied.identitiesCreated}`);
    console.log(`  competitors linked: ${applied.competitorsLinked}`);
    if (applied.conflictsSkipped) {
      console.log(`  conflicts skipped:  ${applied.conflictsSkipped} (review manually)`);
    }
  } else {
    console.log('Dry run — nothing written. Re-run with --apply to persist.');
  }
  return 0;
}

const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
