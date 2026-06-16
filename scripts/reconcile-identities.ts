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

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNotNull, isNull, notInArray, or } from 'drizzle-orm';

import {
  clusterCompetitors,
  isLongArc,
  LONG_ARC_YEARS,
  type ClusterInput,
  type ClusterResult,
  type IdentityCluster,
} from '@/lib/competitor-identity-cluster';
import {
  parseManifest,
  planManifestApply,
  type CompetitorCandidate,
  type ManifestPlan,
} from '@/lib/competitor-identity-manifest';
import { mintSlug } from '@/lib/competitor-slug';
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

/**
 * Build the `(seriesId, sailNumber)` → competitors index the manifest planner
 * resolves member rows against. A sail can repeat within a series (placeholder
 * sails in coached fleets, two siblings on a shared hull at one event — see the
 * iodai-archive identity audit), so each key maps to *all* its candidates and
 * the planner disambiguates by name. The collision count (keys with >1 row) is
 * returned for the operator's report.
 */
export async function collectCompetitorIndex(
  db: SailScoringDb,
  workspaceId: string,
): Promise<{ index: Map<string, CompetitorCandidate[]>; collisions: number }> {
  const rows = await db
    .select({
      competitorId: competitors.id,
      seriesId: competitors.seriesId,
      sailNumber: competitors.sailNumber,
      name: competitors.name,
    })
    .from(competitors)
    .where(eq(competitors.workspaceId, workspaceId));
  const index = new Map<string, CompetitorCandidate[]>();
  let collisions = 0;
  for (const r of rows) {
    const key = `${r.seriesId}|${r.sailNumber}`;
    const arr = index.get(key);
    if (arr) {
      arr.push({ competitorId: r.competitorId, name: r.name });
      collisions++;
    } else {
      index.set(key, [{ competitorId: r.competitorId, name: r.name }]);
    }
  }
  return { index, collisions };
}

/**
 * Write the manifest's identities and link their competitors, in one
 * transaction. Identity ids are deterministic (UUIDv5 of the slug), so this is
 * re-runnable: an `onConflictDoUpdate` on the id refreshes an existing row in
 * place. A pre-existing identity squatting on a manifest slug under a *different*
 * id is removed first so the deterministic insert doesn't trip the
 * `(workspace, slug)` unique index (the FK clears its links; the manifest
 * re-links below). Manifest links are authoritative — they overwrite any prior
 * link on a covered row, unlike the auto-pass which only fills blanks.
 */
export async function applyManifest(
  db: SailScoringDb,
  workspaceId: string,
  plan: ManifestPlan,
): Promise<{ identitiesWritten: number; competitorsLinked: number }> {
  const writable = plan.assignments.filter((a) => a.competitorIds.length > 0);
  const targetIds = writable.map((a) => a.identityId);
  const targetSlugs = writable.map((a) => a.slug);
  let identitiesWritten = 0;
  let competitorsLinked = 0;

  await db.transaction(async (tx) => {
    if (targetSlugs.length) {
      await tx
        .delete(competitorIdentities)
        .where(
          and(
            eq(competitorIdentities.workspaceId, workspaceId),
            inArray(competitorIdentities.slug, targetSlugs),
            notInArray(competitorIdentities.id, targetIds),
          ),
        );
    }

    for (const a of writable) {
      await tx
        .insert(competitorIdentities)
        .values({
          id: a.identityId,
          workspaceId,
          label: a.label,
          slug: a.slug,
          sailNumber: a.sailNumber,
          club: a.club,
          nationality: a.nationality,
        })
        .onConflictDoUpdate({
          target: competitorIdentities.id,
          set: {
            label: a.label,
            slug: a.slug,
            sailNumber: a.sailNumber,
            club: a.club,
            nationality: a.nationality,
          },
        });
      identitiesWritten++;

      const res = await tx
        .update(competitors)
        .set({ identityId: a.identityId })
        .where(
          and(
            eq(competitors.workspaceId, workspaceId),
            inArray(competitors.id, a.competitorIds),
          ),
        );
      competitorsLinked += res.count ?? 0;
    }
  });

  return { identitiesWritten, competitorsLinked };
}

interface ApplyResult {
  identitiesCreated: number;
  competitorsLinked: number;
  conflictsSkipped: number;
}

/**
 * Backfill slugs for any identities created before the slug column existed
 * (#217). Idempotent — only touches null-slug rows — so it's safe to run on
 * every `--apply`. New identities get their slug at insert in `applyClusters`;
 * this covers the pre-slug ones. Returns how many were filled.
 */
export async function ensureSlugs(
  db: SailScoringDb,
  workspaceId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: competitorIdentities.id,
        label: competitorIdentities.label,
        slug: competitorIdentities.slug,
      })
      .from(competitorIdentities)
      .where(eq(competitorIdentities.workspaceId, workspaceId));
    const reserved = new Set(
      rows.filter((r) => r.slug).map((r) => r.slug as string),
    );
    let filled = 0;
    for (const row of rows) {
      if (row.slug) continue;
      await tx
        .update(competitorIdentities)
        .set({ slug: mintSlug(row.label, reserved) })
        .where(eq(competitorIdentities.id, row.id));
      filled++;
    }
    return filled;
  });
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
    // Seed the reserved set with the workspace's existing slugs so a whole
    // batch of new identities can mint unique slugs without a round-trip each.
    const reserved = new Set(
      (
        await tx
          .select({ slug: competitorIdentities.slug })
          .from(competitorIdentities)
          .where(
            and(
              eq(competitorIdentities.workspaceId, workspaceId),
              isNotNull(competitorIdentities.slug),
            ),
          )
      ).map((r) => r.slug as string),
    );

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
          slug: mintSlug(cluster.label, reserved),
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
