/**
 * Cross-series competitor-identity reconcile pass (#212) — the batch CLI.
 *
 * Loads every competitor row in a workspace, clusters them into recurring
 * identities with the pure core in `lib/competitor-identity-cluster.ts`, and —
 * with `--apply` — writes a `competitor_identities` row per cluster and stamps
 * `competitors.identity_id`. This is the batch backfill for the IODAI corpus
 * (≈180 series back to 2009): you don't hand-link ~15k rows, you cluster them,
 * eyeball the stats and suggestions, then confirm in the reconcile UI.
 *
 * The DB operations live in `lib/competitor-identity-reconcile.ts`, shared
 * with the lazy on-demand hook (#222) that runs the same pass after competitor
 * writes — this script is the CLI and reporting around them.
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

import { readFileSync } from 'node:fs';

import { eq, or } from 'drizzle-orm';

import {
  clusterCompetitors,
  isLongArc,
  LONG_ARC_YEARS,
  type ClusterResult,
  type IdentityCluster,
} from '@/lib/competitor-identity-cluster';
import {
  parseManifest,
  planManifestApply,
  type ManifestPlan,
} from '@/lib/competitor-identity-manifest';
import {
  applyClusters,
  applyManifest,
  collectClusterInputs,
  collectCompetitorIndex,
  ensureSlugs,
  resetIdentities,
} from '@/lib/competitor-identity-reconcile';
import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';

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

function renderManifestPlan(plan: ManifestPlan, collisions: number): string {
  const writable = plan.assignments.filter((a) => a.competitorIds.length > 0);
  const linked = writable.reduce((n, a) => n + a.competitorIds.length, 0);
  const lines: string[] = [];
  lines.push('Manifest plan');
  lines.push('─────────────');
  lines.push(`identities:         ${plan.assignments.length}`);
  lines.push(`  with members:     ${writable.length}`);
  lines.push(`competitors linked: ${linked}`);
  lines.push(`unresolved members: ${plan.unresolvedMembers.length}`);
  if (plan.duplicateSlugs.length) {
    lines.push(`duplicate slugs:    ${plan.duplicateSlugs.length}  (${plan.duplicateSlugs.join(', ')})`);
  }
  if (collisions) {
    lines.push(`index collisions:   ${collisions}  ((series, sail) not unique — first row wins)`);
  }
  if (plan.unresolvedMembers.length) {
    lines.push('');
    lines.push('Unresolved members (first 20):');
    plan.unresolvedMembers.slice(0, 20).forEach((m) => {
      lines.push(`  ${m.reason.padEnd(15)} ${m.slug}  →  (${m.seriesSlug}, ${m.sailNumber})`);
    });
  }
  return lines.join('\n');
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function usage(): string {
  return `reconcile-identities — cluster a workspace's competitors into recurring identities (#212, #218)

  pnpm reconcile-identities <workspace> [--manifest <file>] [--apply] [--reset] [--json]

  <workspace>        organization slug or id
  --manifest <file>  apply a golden-record identity manifest (JSON) before the
                     fuzzy auto-pass: each entry's members (series-slug, sail) are
                     resolved to competitors and linked under a deterministic id.
                     Rows the manifest doesn't cover fall through to the auto-pass.
                     Without --apply, just reports what the manifest would do.
  --apply            write competitor_identities rows and stamp competitors.identity_id
                     (default is a dry run that writes nothing)
  --reset            before applying, delete the workspace's existing identities and
                     rebuild from scratch (requires --apply). With --manifest this
                     gives a byte-stable rebuild. Discards manual renames/splits.
  --json             emit the full clustering result as JSON

Reads DATABASE_URL.`;
}

export async function runCli(argv: string[]): Promise<number> {
  let workspaceRef: string | undefined;
  let apply = false;
  let reset = false;
  let json = false;
  let manifestPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--reset') reset = true;
    else if (arg === '--json') json = true;
    else if (arg === '--manifest') {
      manifestPath = argv[++i];
      if (!manifestPath) {
        console.error('--manifest needs a file path\n');
        console.error(usage());
        return 1;
      }
    } else if (arg === '--help' || arg === '-h') {
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

  if (!json) console.log(`Workspace: ${ws.name} (${ws.id})`);

  if (reset) {
    const removed = await resetIdentities(db, ws.id);
    console.log(`Reset: removed ${removed} existing identities (links cleared).`);
  }

  // Manifest stage (#218): apply the golden-record manifest before the fuzzy
  // auto-pass, so the auto-pass only drafts identities for the uncovered tail
  // (its applyClusters only touches still-unlinked rows).
  if (manifestPath) {
    const manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
    const { index, collisions } = await collectCompetitorIndex(db, ws.id);
    const plan = planManifestApply(
      manifest,
      ws.id,
      (seriesId, sail) => index.get(`${seriesId}|${sail}`),
    );
    if (!json) {
      console.log(renderManifestPlan(plan, collisions));
      console.log('');
    }
    if (apply) {
      const r = await applyManifest(db, ws.id, plan);
      console.log(
        `Manifest applied: ${r.identitiesWritten} identities written, ${r.competitorsLinked} competitors linked.\n`,
      );
    }
  }

  const inputs = await collectClusterInputs(db, ws.id);
  const result = clusterCompetitors(inputs);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  console.log(renderReport(result));

  if (apply) {
    const backfilled = await ensureSlugs(db, ws.id);
    const applied = await applyClusters(db, ws.id, result);
    console.log('Applied:');
    if (backfilled > 0) {
      console.log(`  slugs backfilled:   ${backfilled}`);
    }
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
