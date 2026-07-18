/**
 * DB half of the cross-series competitor-identity reconcile pass (#212, #222).
 *
 * The pure clustering lives in `competitor-identity-cluster.ts`; this module
 * does the I/O around it — loading the flattened competitor rows, writing
 * `competitor_identities` and stamping `competitors.identity_id`. Shared by
 * the as-published archive apply (`lib/api-handlers/archive.ts`, driven by
 * the archive repos' CI) and the lazy on-demand hook
 * (`relinkIdentitiesAfterWrite`, #222) that runs the same pass after
 * competitor writes, so the two can never drift onto different matching
 * models or thresholds.
 *
 * Deliberately not `server-only`: the CLI runs it under tsx.
 */

import { randomUUID } from 'node:crypto';

import { and, eq, inArray, isNotNull, isNull, notInArray } from 'drizzle-orm';

import {
  clusterCompetitors,
  type ClusterInput,
  type ClusterResult,
} from '@/lib/competitor-identity-cluster';
import type {
  CompetitorCandidate,
  ManifestPlan,
} from '@/lib/competitor-identity-manifest';
import { formatPrimaryNames } from '@/lib/competitor-fields';
import { mintSlug } from '@/lib/competitor-slug';
import { getDb, type SailScoringDb } from '@/lib/db/client';
import { competitorIdentities, competitors, series } from '@/lib/db/schema/series';
import { workspaceOwnFeatureOn } from '@/lib/workspace-features';

/**
 * Delete every identity in the workspace (the FK's ON DELETE SET NULL clears
 * `competitors.identity_id` for us), so the next pass rebuilds from scratch.
 * Identities are derived data, so a rebuild is the clean way to retire a whole
 * class of bad merge after a matcher fix — but it also discards any manual
 * renames/splits, hence the CLI's `--reset` guard. Returns how many were
 * removed.
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

/** Load the flattened competitor rows the clusterer needs. */
export async function collectClusterInputs(
  db: SailScoringDb,
  workspaceId: string,
): Promise<ClusterInput[]> {
  const rows = await db
    .select({
      competitorId: competitors.id,
      names: competitors.names,
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
      name: formatPrimaryNames(r.names),
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
      names: competitors.names,
    })
    .from(competitors)
    .where(eq(competitors.workspaceId, workspaceId));
  const index = new Map<string, CompetitorCandidate[]>();
  let collisions = 0;
  for (const r of rows) {
    const key = `${r.seriesId}|${r.sailNumber}`;
    const arr = index.get(key);
    if (arr) {
      arr.push({ competitorId: r.competitorId, name: formatPrimaryNames(r.names) });
      collisions++;
    } else {
      index.set(key, [{ competitorId: r.competitorId, name: formatPrimaryNames(r.names) }]);
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
  // Zero-member assignments still write their identity row: a ranking-only
  // sailor (someone in season rankings but no imported series) exists to
  // anchor as-published ranking rows and their career arc.
  const writable = plan.assignments;
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
          // The manifest is the archive pipeline's authority (ADR-010): its
          // identities belong to git, and the reconcile UI leaves them alone.
          managedBy: 'archive',
        })
        .onConflictDoUpdate({
          target: competitorIdentities.id,
          set: {
            label: a.label,
            slug: a.slug,
            sailNumber: a.sailNumber,
            club: a.club,
            nationality: a.nationality,
            managedBy: 'archive',
          },
        });
      identitiesWritten++;

      if (a.competitorIds.length > 0) {
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
    }
  });

  return { identitiesWritten, competitorsLinked };
}

export interface ApplyResult {
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

export interface ApplyClustersOpts {
  /** Jurisdiction stamped on identities this pass creates (ADR-010). The
   *  in-app lazy pass and the plain CLI pass create 'app' identities; the
   *  archive ingest's pass creates 'archive' ones. Default 'app'. */
  managedBy?: 'app' | 'archive';
  /** When set, only these competitor rows are linked (and a cluster with
   *  none of them is skipped entirely) — the archive ingest's pass links
   *  rows in as-published series only, leaving live rows to the lazy pass. */
  onlyCompetitorIds?: ReadonlySet<string>;
}

/** Write identities + links for the clustering result, in one transaction. */
export async function applyClusters(
  db: SailScoringDb,
  workspaceId: string,
  result: ClusterResult,
  opts: ApplyClustersOpts = {},
): Promise<ApplyResult> {
  const managedBy = opts.managedBy ?? 'app';
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

      const targetIds = opts.onlyCompetitorIds
        ? cluster.competitorIds.filter((id) => opts.onlyCompetitorIds!.has(id))
        : cluster.competitorIds;
      if (targetIds.length === 0) continue;

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
          managedBy,
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
            inArray(competitors.id, targetIds),
          ),
        );
      competitorsLinked += res.count ?? 0;
    }
  });

  return { identitiesCreated, competitorsLinked, conflictsSkipped };
}

/**
 * Delete identities with no linked competitor rows — debris left when rows
 * are replaced under them (a re-import, or the as-published conversion
 * re-minting row ids, ADR-010). An orphan serves nothing: its public
 * timeline already 404s, and in the reconcile UI it's an empty card. Safe
 * for either jurisdiction — an archive-managed orphan the manifest still
 * wants is recreated on the next apply. `keepIds` exempts identities that
 * are wanted despite having no competitor links — ranking-only sailors
 * (#309), whose rows live in as-published rankings, not series. Returns
 * how many were removed.
 */
export async function gcOrphanIdentities(
  db: SailScoringDb,
  workspaceId: string,
  keepIds: readonly string[] = [],
): Promise<number> {
  const removed = await db
    .delete(competitorIdentities)
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        keepIds.length
          ? notInArray(competitorIdentities.id, [...keepIds])
          : undefined,
        notInArray(
          competitorIdentities.id,
          db
            .select({ id: competitors.identityId })
            .from(competitors)
            .where(
              and(
                eq(competitors.workspaceId, workspaceId),
                isNotNull(competitors.identityId),
              ),
            ),
        ),
      ),
    )
    .returning({ id: competitorIdentities.id });
  return removed.length;
}

// ─── lazy on-demand population (#222) ────────────────────────────────────────

/**
 * Whether the workspace's own metadata switches the `competitor-identity`
 * feature on — the spine gate the public pages use too. Deliberately the
 * workspace's *own* flags, not `computeEffectiveFeatures`: the spine is
 * adopted workspace by workspace (operator-managed), and a personal workspace
 * inheriting a club's flag must not start growing identities of its own.
 */
export async function workspaceIdentityFeatureOn(
  db: SailScoringDb,
  workspaceId: string,
): Promise<boolean> {
  return workspaceOwnFeatureOn(db, workspaceId, 'competitor-identity');
}

/**
 * Lazy on-demand identity population (#222): run the reconcile pass after a
 * competitor write, so the spine fills itself as series are scored instead of
 * waiting for the batch CLI. This *is* the batch pass — same clusterer, same
 * write semantics (`applyClusters`: only fills NULL `identity_id`, never
 * touches a confirmed link, skips clusters spanning two confirmed identities) —
 * so there is exactly one matching model. No-op (returns null) when the
 * workspace hasn't adopted the spine or has nothing unlinked.
 */
export async function relinkIdentitiesAfterWrite(
  workspaceId: string,
  db: SailScoringDb = getDb(),
): Promise<ApplyResult | null> {
  if (!(await workspaceIdentityFeatureOn(db, workspaceId))) return null;

  // Jurisdiction (ADR-010): the lazy pass links rows in live series only —
  // as-published rows are the archive ingest's to link. The probe and the
  // apply share the same scope.
  const unlinkedLive = await db
    .select({ id: competitors.id })
    .from(competitors)
    .innerJoin(series, eq(competitors.seriesId, series.id))
    .where(
      and(
        eq(competitors.workspaceId, workspaceId),
        isNull(competitors.identityId),
        eq(series.asPublished, false),
      ),
    );
  if (unlinkedLive.length === 0) return null;

  const inputs = await collectClusterInputs(db, workspaceId);
  const result = clusterCompetitors(inputs);
  return applyClusters(db, workspaceId, result, {
    onlyCompetitorIds: new Set(unlinkedLive.map((r) => r.id)),
  });
}

/**
 * `relinkIdentitiesAfterWrite` as a post-save enrichment: identity linking
 * must never fail the competitor write it follows, so errors are logged and
 * swallowed. Handlers call this after their transaction commits.
 */
export async function relinkIdentitiesBestEffort(
  workspaceId: string,
): Promise<void> {
  try {
    await relinkIdentitiesAfterWrite(workspaceId);
  } catch (err) {
    console.error('competitor-identity relink failed:', err);
  }
}
