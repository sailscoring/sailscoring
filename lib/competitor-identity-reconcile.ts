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
import {
  isLowSignalPersonName,
  normalizePersonName,
  personNamesMatch,
  splitCrewCell,
} from '@/lib/competitor-identity-match';
import { mintSlug } from '@/lib/competitor-slug';
import { getDb, type SailScoringDb } from '@/lib/db/client';
import { competitorIdentities, competitorIdentityLinks, competitors, series } from '@/lib/db/schema/series';
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

/** The people a competitor row's crew field names (#348), one per person:
 *  the stored list, with any cell that packs several people into one string
 *  split out, and the unrecognisable ones dropped. */
function crewPersons(crewNames: string[] | null): string[] {
  return (crewNames ?? [])
    .flatMap((cell) => splitCrewCell(cell))
    .filter((name) => !isLowSignalPersonName(name));
}

/**
 * Attribute a slot's existing memberships to its people. Each link is used at
 * most once, matched to the person its identity label names. A slot holding a
 * single person keeps its first link regardless of label, which is what lets a
 * renamed identity stay confirmed. Links matching no person are left alone —
 * they surface in the review queue as stale.
 */
function attributeLinks(
  persons: string[],
  links: { identityId: string; label: string }[],
): (string | null)[] {
  if (persons.length <= 1) return [links[0]?.identityId ?? null];
  const used = new Set<number>();
  return persons.map((person) => {
    const normPerson = normalizePersonName(person);
    for (let i = 0; i < links.length; i++) {
      if (used.has(i)) continue;
      if (personNamesMatch(normPerson, normalizePersonName(links[i].label))) {
        used.add(i);
        return links[i].identityId;
      }
    }
    return null;
  });
}

export interface CollectInputsOpts {
  /** Whether the crew slot contributes people of its own (#348). Off by
   *  default: a workspace adopts crew identities deliberately, because
   *  switching them on changes which identities exist. */
  includeCrew?: boolean;
}

/**
 * Load the flattened inputs the clusterer needs: **one input per person** on
 * each row. A single-person row behaves exactly as before. For a multi-person
 * primary ("J. & M. Murphy") each co-owner is an independent matching unit,
 * flagged `fromMultiPersonRow` so the clusterer demands harder corroboration
 * for the fragment names.
 *
 * With `includeCrew`, everyone in the row's crew list is a matching unit too
 * (#348) — otherwise a sailor who only ever crews has no identity at all, and
 * a sailor who helms some seasons and crews others shows half a career. Crew
 * are flagged as fragments for the same reason co-owners are: they share the
 * boat's club and sail by construction, so those signals can't corroborate.
 *
 * Attribution is per slot, so a row's crew membership can never be mistaken
 * for its primary one (or vice versa) — which matters most exactly when an
 * identity has been renamed away from the name it was linked from.
 */
export async function collectClusterInputs(
  db: SailScoringDb,
  workspaceId: string,
  opts: CollectInputsOpts = {},
): Promise<ClusterInput[]> {
  const rows = await db
    .select({
      competitorId: competitors.id,
      names: competitors.names,
      crewNames: competitors.crewNames,
      sailNumber: competitors.sailNumber,
      club: competitors.club,
      nationality: competitors.nationality,
      age: competitors.age,
      startDate: series.startDate,
    })
    .from(competitors)
    .innerJoin(series, eq(competitors.seriesId, series.id))
    .where(eq(competitors.workspaceId, workspaceId));
  const linkRows = await db
    .select({
      competitorId: competitorIdentityLinks.competitorId,
      identityId: competitorIdentityLinks.identityId,
      role: competitorIdentityLinks.role,
      label: competitorIdentities.label,
    })
    .from(competitorIdentityLinks)
    .innerJoin(
      competitorIdentities,
      eq(competitorIdentities.id, competitorIdentityLinks.identityId),
    )
    .where(eq(competitorIdentityLinks.workspaceId, workspaceId));
  const linksByRow = new Map<
    string,
    { identityId: string; role: string; label: string }[]
  >();
  for (const l of linkRows) {
    const arr = linksByRow.get(l.competitorId);
    if (arr) arr.push(l);
    else linksByRow.set(l.competitorId, [l]);
  }

  const inputs: ClusterInput[] = [];
  for (const r of rows) {
    const year = Number.parseInt((r.startDate ?? '').slice(0, 4), 10);
    const base = {
      competitorId: r.competitorId,
      sailNumber: r.sailNumber,
      club: r.club ?? undefined,
      nationality: r.nationality ?? undefined,
      age: r.age,
      raceYear: Number.isFinite(year) ? year : null,
    };
    const links = linksByRow.get(r.competitorId) ?? [];

    const persons = r.names.filter((n) => n.trim());
    const attributed = attributeLinks(
      persons,
      links.filter((l) => l.role === 'primary'),
    );
    // A row with no usable primary name still contributes one input, so its
    // membership is accounted for; the clusterer never matches a blank.
    (persons.length ? persons : ['']).forEach((name, i) => {
      inputs.push({
        ...base,
        name,
        role: 'primary',
        existingIdentityId: attributed[i] ?? null,
        ...(persons.length > 1 ? { fromMultiPersonRow: true } : {}),
      });
    });

    if (!opts.includeCrew) continue;
    const crew = crewPersons(r.crewNames);
    const crewAttributed = attributeLinks(
      crew,
      links.filter((l) => l.role === 'crew'),
    );
    crew.forEach((name, i) => {
      inputs.push({
        ...base,
        name,
        role: 'crew',
        existingIdentityId: crewAttributed[i] ?? null,
        fromMultiPersonRow: true,
      });
    });
  }
  return inputs;
}

/** A membership whose identity label matches no person in the slot it claims —
 *  usually a rename that walked away from the link, or a pre-list joined-name
 *  identity ("J. & M. Murphy") still attached to a now per-person row. Never
 *  touched automatically; the review queue surfaces it for a human (#316). */
export interface StaleLink {
  competitorId: string;
  identityId: string;
  identityLabel: string;
  competitorNames: string[];
  sailNumber: string;
}

/** Find stale memberships (see `StaleLink`). A link is checked against the
 *  people in its own slot, so a crew membership is never judged against the
 *  helm's name. Only slots holding more than one person are examined: a
 *  single-person slot keeps its link through renames by design. */
export async function collectStaleLinks(
  db: SailScoringDb,
  workspaceId: string,
): Promise<StaleLink[]> {
  const linkRows = await db
    .select({
      competitorId: competitorIdentityLinks.competitorId,
      identityId: competitorIdentityLinks.identityId,
      role: competitorIdentityLinks.role,
      label: competitorIdentities.label,
      names: competitors.names,
      crewNames: competitors.crewNames,
      sailNumber: competitors.sailNumber,
    })
    .from(competitorIdentityLinks)
    .innerJoin(
      competitorIdentities,
      eq(competitorIdentities.id, competitorIdentityLinks.identityId),
    )
    .innerJoin(
      competitors,
      eq(competitors.id, competitorIdentityLinks.competitorId),
    )
    .where(eq(competitorIdentityLinks.workspaceId, workspaceId));
  const stale: StaleLink[] = [];
  for (const l of linkRows) {
    const persons =
      l.role === 'crew'
        ? crewPersons(l.crewNames)
        : l.names.filter((n) => n.trim());
    if (persons.length <= 1) continue;
    const normLabel = normalizePersonName(l.label);
    const matchesSomeone = persons.some((p) =>
      personNamesMatch(normalizePersonName(p), normLabel),
    );
    if (!matchesSomeone) {
      stale.push({
        competitorId: l.competitorId,
        identityId: l.identityId,
        identityLabel: l.label,
        competitorNames: l.role === 'crew' ? persons : l.names,
        sailNumber: l.sailNumber,
      });
    }
  }
  return stale;
}

/**
 * Build the `(seriesId, sailNumber)` → competitors index the manifest planner
 * resolves member rows against. A sail can repeat within a series (placeholder
 * sails in coached fleets, two siblings on a shared hull at one event — see the
 * iodai-archive identity audit), so each key maps to *all* its candidates and
 * the planner disambiguates by name. Each candidate carries its crew names as
 * well as its primary ones, so a crew member row is disambiguated against the
 * field its person actually appears in (#348). The collision count (keys with
 * >1 row) is returned for the operator's report.
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
      crewNames: competitors.crewNames,
    })
    .from(competitors)
    .where(eq(competitors.workspaceId, workspaceId));
  const index = new Map<string, CompetitorCandidate[]>();
  let collisions = 0;
  for (const r of rows) {
    const key = `${r.seriesId}|${r.sailNumber}`;
    const candidate: CompetitorCandidate = {
      competitorId: r.competitorId,
      name: formatPrimaryNames(r.names),
      ...(r.crewNames?.length ? { crewName: r.crewNames.join(' ') } : {}),
    };
    const arr = index.get(key);
    if (arr) {
      arr.push(candidate);
      collisions++;
    } else {
      index.set(key, [candidate]);
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
 * link on a covered slot, unlike the auto-pass which only fills blanks.
 *
 * "Covered slot", not "covered row": a crewed boat is claimed by two
 * identities (#348), so clearing every link on a row would have the crew's
 * assignment delete the helm's on its way past. Every covered slot is cleared
 * once, up front, before anything is written back.
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

    // Clear every slot the manifest covers, once, before writing any of them
    // back. Doing it per assignment would have one identity's delete undo an
    // earlier one's insert on a boat they share — the helm and crew case.
    // Slots the manifest doesn't mention keep whatever they had.
    for (const role of ['primary', 'crew'] as const) {
      const rowIds = [
        ...new Set(
          writable.flatMap((a) =>
            a.members.filter((m) => m.role === role).map((m) => m.competitorId),
          ),
        ),
      ];
      if (rowIds.length === 0) continue;
      await tx
        .delete(competitorIdentityLinks)
        .where(
          and(
            eq(competitorIdentityLinks.workspaceId, workspaceId),
            eq(competitorIdentityLinks.role, role),
            inArray(competitorIdentityLinks.competitorId, rowIds),
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

      if (a.members.length > 0) {
        const res = await tx
          .insert(competitorIdentityLinks)
          .values(a.members.map((m) => ({
            competitorId: m.competitorId,
            identityId: a.identityId,
            workspaceId,
            role: m.role,
          })))
          .onConflictDoNothing();
        competitorsLinked += res.count ?? a.members.length;
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

      // Person-aware fill rule (#316): link a row when one of its persons in
      // this cluster carried no membership at collect time — a row whose
      // co-owner A is already confirmed elsewhere still gets B's new link.
      const needing = cluster.members.filter((m) => m.needsLink);
      const targets = opts.onlyCompetitorIds
        ? needing.filter((m) => opts.onlyCompetitorIds!.has(m.competitorId))
        : needing;
      if (targets.length === 0) continue;

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

      // Confirmed memberships were attributed at collect time and never
      // re-written here; the PK no-op absorbs a race with a concurrent pass.
      // Each membership records the slot its person came out of (#348), so a
      // crewing appearance stays distinguishable from a helming one.
      await tx
        .insert(competitorIdentityLinks)
        .values(targets.map((m) => ({
          competitorId: m.competitorId,
          identityId,
          workspaceId,
          role: m.role,
        })))
        .onConflictDoNothing();
      competitorsLinked += targets.length;
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
            .select({ id: competitorIdentityLinks.identityId })
            .from(competitorIdentityLinks)
            .where(eq(competitorIdentityLinks.workspaceId, workspaceId)),
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
 * Whether the workspace has adopted crew identities (#348) — the same
 * own-flags rule as the spine itself. Gates only what the *auto-pass*
 * collects: an archive manifest that names crew states its intent outright,
 * so it applies regardless.
 */
export async function workspaceCrewIdentityFeatureOn(
  db: SailScoringDb,
  workspaceId: string,
): Promise<boolean> {
  return workspaceOwnFeatureOn(db, workspaceId, 'competitor-identity-crew');
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
  const includeCrew = await workspaceCrewIdentityFeatureOn(db, workspaceId);
  const liveRows = await db
    .select({
      id: competitors.id,
      names: competitors.names,
      crewNames: competitors.crewNames,
      linkedIdentityId: competitorIdentityLinks.identityId,
    })
    .from(competitors)
    .innerJoin(series, eq(competitors.seriesId, series.id))
    .leftJoin(
      competitorIdentityLinks,
      eq(competitorIdentityLinks.competitorId, competitors.id),
    )
    .where(
      and(
        eq(competitors.workspaceId, workspaceId),
        eq(series.asPublished, false),
      ),
    );
  // Under-linked = fewer memberships than named persons (zero links on a
  // single-person row is the classic case; a co-owned row with one link has
  // an unlinked co-owner, and a crewed row with only its helm linked has an
  // unlinked crew). Persons may legitimately outnumber links while a stale
  // link exists too — the pass only ever adds, so that's safe.
  const linkCounts = new Map<string, number>();
  const personCounts = new Map<string, number>();
  for (const r of liveRows) {
    if (!personCounts.has(r.id)) {
      const primary = Math.max(1, r.names.filter((n) => n.trim()).length);
      const crew = includeCrew ? crewPersons(r.crewNames).length : 0;
      personCounts.set(r.id, primary + crew);
    }
    if (r.linkedIdentityId) {
      linkCounts.set(r.id, (linkCounts.get(r.id) ?? 0) + 1);
    }
  }
  const underLinked = [...personCounts].some(
    ([id, persons]) => (linkCounts.get(id) ?? 0) < persons,
  );
  if (!underLinked) return null;

  const inputs = await collectClusterInputs(db, workspaceId, { includeCrew });
  const result = clusterCompetitors(inputs);
  const underLinkedIds = new Set(
    [...personCounts]
      .filter(([id, persons]) => (linkCounts.get(id) ?? 0) < persons)
      .map(([id]) => id),
  );
  return applyClusters(db, workspaceId, result, {
    onlyCompetitorIds: underLinkedIds,
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
