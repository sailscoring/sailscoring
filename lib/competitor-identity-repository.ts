import 'server-only';

import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

import { workspaceIdentityFeatureOn } from '@/lib/competitor-identity-reconcile';
import { mintSlug } from '@/lib/competitor-slug';
import { getDb } from '@/lib/db/client';
import {
  competitorIdentities,
  competitorIdentityDistinctions,
  competitors,
  series,
} from '@/lib/db/schema/series';

/**
 * Server-side reads/writes for the cross-series competitor-identity spine
 * (#212), shared by the reconcile surface (`/workspace/competitors`) and the
 * public competitor timeline (`/p/{ws}/competitor/{slug}`). Both need the same shape:
 * an identity plus its linked competitor rows, each joined to the series it was
 * entered in, in chronological order. Workspace-scoped throughout.
 */

/** One series a recurring competitor was entered in — a point on the arc. */
export interface ArcEntry {
  competitorId: string;
  seriesId: string;
  seriesName: string;
  venue: string;
  startDate: string;
  year: number | null;
  sailNumber: string;
  club: string;
  /** Age at the event, where recorded (null in most pre-2020 IODAI data). */
  age: number | null;
}

/** A recurring competitor and its arc across series. */
export interface IdentityWithArc {
  id: string;
  /** Vanity slug — the public URL handle (#217). Null only for rows awaiting
   *  backfill; the reconcile pass mints one on create and fills any gaps. */
  slug: string | null;
  label: string;
  sailNumber: string;
  club: string | null;
  nationality: string | null;
  /** "Looks right" stamp from the review queue (#221) — a flagged identity a
   *  human has confirmed. ISO string, or null when never reviewed (or the arc
   *  changed since: merge/split clear it). */
  reviewedAt: string | null;
  entries: ArcEntry[];
  firstYear: number | null;
  lastYear: number | null;
}

function yearOf(startDate: string): number | null {
  const y = Number.parseInt((startDate ?? '').slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/** Build IdentityWithArc rows from a flat identity⋈competitor⋈series join. */
function assemble(
  rows: Array<{
    id: string;
    slug: string | null;
    label: string;
    sailNumber: string;
    club: string | null;
    nationality: string | null;
    reviewedAt: Date | null;
    competitorId: string | null;
    seriesId: string | null;
    seriesName: string | null;
    venue: string | null;
    startDate: string | null;
    compSailNumber: string | null;
    compClub: string | null;
    age: number | null;
  }>,
): IdentityWithArc[] {
  const byId = new Map<string, IdentityWithArc>();
  for (const r of rows) {
    let identity = byId.get(r.id);
    if (!identity) {
      identity = {
        id: r.id,
        slug: r.slug,
        label: r.label,
        sailNumber: r.sailNumber,
        club: r.club,
        nationality: r.nationality,
        reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
        entries: [],
        firstYear: null,
        lastYear: null,
      };
      byId.set(r.id, identity);
    }
    if (r.competitorId && r.seriesId) {
      identity.entries.push({
        competitorId: r.competitorId,
        seriesId: r.seriesId,
        seriesName: r.seriesName ?? '',
        venue: r.venue ?? '',
        startDate: r.startDate ?? '',
        year: yearOf(r.startDate ?? ''),
        sailNumber: r.compSailNumber ?? '',
        club: r.compClub ?? '',
        age: r.age,
      });
    }
  }
  for (const identity of byId.values()) {
    identity.entries.sort((a, b) => a.startDate.localeCompare(b.startDate));
    const years = identity.entries
      .map((e) => e.year)
      .filter((y): y is number => y != null);
    identity.firstYear = years.length ? Math.min(...years) : null;
    identity.lastYear = years.length ? Math.max(...years) : null;
  }
  return [...byId.values()];
}

const selection = {
  id: competitorIdentities.id,
  slug: competitorIdentities.slug,
  label: competitorIdentities.label,
  sailNumber: competitorIdentities.sailNumber,
  club: competitorIdentities.club,
  nationality: competitorIdentities.nationality,
  reviewedAt: competitorIdentities.reviewedAt,
  competitorId: competitors.id,
  seriesId: series.id,
  seriesName: series.name,
  venue: series.venue,
  startDate: series.startDate,
  compSailNumber: competitors.sailNumber,
  compClub: competitors.club,
  age: competitors.age,
} as const;

/** Every identity in the workspace with its linked arc, label-sorted. */
export async function listIdentitiesWithArcs(
  workspaceId: string,
): Promise<IdentityWithArc[]> {
  const rows = await getDb()
    .select(selection)
    .from(competitorIdentities)
    .leftJoin(competitors, eq(competitors.identityId, competitorIdentities.id))
    .leftJoin(series, eq(competitors.seriesId, series.id))
    .where(eq(competitorIdentities.workspaceId, workspaceId));
  return assemble(rows).sort((a, b) => a.label.localeCompare(b.label));
}

/** One identity's arc, or null if it isn't in the workspace. */
export async function getIdentityArc(
  workspaceId: string,
  identityId: string,
): Promise<IdentityWithArc | null> {
  const rows = await getDb()
    .select(selection)
    .from(competitorIdentities)
    .leftJoin(competitors, eq(competitors.identityId, competitorIdentities.id))
    .leftJoin(series, eq(competitors.seriesId, series.id))
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        eq(competitorIdentities.id, identityId),
      ),
    );
  const [identity] = assemble(rows);
  return identity ?? null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a `/p/.../competitor/{ref}` segment to an identity id within the
 * workspace. Tries the vanity slug first (the canonical public handle), then
 * falls back to a raw UUID so links minted before slugs — and the reconcile
 * UI's own internal references — keep resolving. Null if neither matches.
 */
export async function findIdentityIdByRef(
  workspaceId: string,
  ref: string,
): Promise<string | null> {
  const [bySlug] = await getDb()
    .select({ id: competitorIdentities.id })
    .from(competitorIdentities)
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        eq(competitorIdentities.slug, ref),
      ),
    )
    .limit(1);
  if (bySlug) return bySlug.id;

  if (!UUID_RE.test(ref)) return null;
  const [byId] = await getDb()
    .select({ id: competitorIdentities.id })
    .from(competitorIdentities)
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        eq(competitorIdentities.id, ref),
      ),
    )
    .limit(1);
  return byId?.id ?? null;
}

/** Rename an identity's canonical label. Returns false if it isn't found. */
export async function renameIdentity(
  workspaceId: string,
  identityId: string,
  label: string,
): Promise<boolean> {
  const res = await getDb()
    .update(competitorIdentities)
    .set({ label, updatedAt: new Date() })
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        eq(competitorIdentities.id, identityId),
      ),
    );
  return (res.count ?? 0) > 0;
}

/** The display fields of an identity row — what merge returns so an undo can
 *  recreate the row exactly (same id, same slug, so public URLs survive the
 *  round trip). */
export interface IdentitySnapshot {
  id: string;
  slug: string | null;
  label: string;
  sailNumber: string;
  club: string | null;
  nationality: string | null;
}

/** What a merge did, and everything needed to undo it. */
export interface MergeResult {
  source: IdentitySnapshot;
  movedCompetitorIds: string[];
}

/**
 * Merge one identity into another (#221): every competitor linked to `sourceId`
 * moves to `targetId`, then the source row is deleted (its distinctions cascade
 * away with it). The target keeps its own label and slug — the survivor is the
 * caller's choice of canonical record. Clears the target's `reviewed_at`: its
 * arc just changed, so any prior "looks right" no longer applies. Returns what
 * moved for the undo path, or null when either id is missing (or they're the
 * same identity).
 */
export async function mergeIdentities(
  workspaceId: string,
  targetId: string,
  sourceId: string,
): Promise<MergeResult | null> {
  if (targetId === sourceId) return null;
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .select({
        id: competitorIdentities.id,
        slug: competitorIdentities.slug,
        label: competitorIdentities.label,
        sailNumber: competitorIdentities.sailNumber,
        club: competitorIdentities.club,
        nationality: competitorIdentities.nationality,
      })
      .from(competitorIdentities)
      .where(
        and(
          eq(competitorIdentities.workspaceId, workspaceId),
          inArray(competitorIdentities.id, [targetId, sourceId]),
        ),
      );
    const source = rows.find((r) => r.id === sourceId);
    const target = rows.find((r) => r.id === targetId);
    if (!source || !target) return null;

    const moved = await tx
      .update(competitors)
      .set({ identityId: targetId })
      .where(
        and(
          eq(competitors.workspaceId, workspaceId),
          eq(competitors.identityId, sourceId),
        ),
      )
      .returning({ id: competitors.id });
    await tx
      .delete(competitorIdentities)
      .where(eq(competitorIdentities.id, sourceId));
    await tx
      .update(competitorIdentities)
      .set({ reviewedAt: null, updatedAt: new Date() })
      .where(eq(competitorIdentities.id, targetId));

    return { source, movedCompetitorIds: moved.map((m) => m.id) };
  });
}

/**
 * Undo a merge (#221): recreate the merged-away identity from its snapshot —
 * same id and slug, so its public URL comes straight back — and re-point the
 * listed competitor rows at it. Tolerant of replays: an existing identity row
 * is left as-is, and only rows still in the workspace move. If another
 * identity claimed the slug in the meantime (vanishingly unlikely in an undo
 * window), a fresh slug is minted rather than failing.
 */
export async function restoreIdentity(
  workspaceId: string,
  snapshot: IdentitySnapshot,
  competitorIds: string[],
): Promise<void> {
  await getDb().transaction(async (tx) => {
    let slug = snapshot.slug;
    if (slug) {
      const [taken] = await tx
        .select({ id: competitorIdentities.id })
        .from(competitorIdentities)
        .where(
          and(
            eq(competitorIdentities.workspaceId, workspaceId),
            eq(competitorIdentities.slug, slug),
          ),
        )
        .limit(1);
      if (taken && taken.id !== snapshot.id) {
        slug = mintSlug(snapshot.label, new Set([slug]));
      }
    }
    await tx
      .insert(competitorIdentities)
      .values({
        id: snapshot.id,
        workspaceId,
        label: snapshot.label,
        slug,
        sailNumber: snapshot.sailNumber,
        club: snapshot.club,
        nationality: snapshot.nationality,
      })
      .onConflictDoNothing({ target: competitorIdentities.id });
    if (competitorIds.length > 0) {
      await tx
        .update(competitors)
        .set({ identityId: snapshot.id })
        .where(
          and(
            eq(competitors.workspaceId, workspaceId),
            inArray(competitors.id, competitorIds),
          ),
        );
    }
  });
}

/**
 * Split competitor rows off an identity onto a fresh identity of their own
 * (#221) — the one-row scissor and the cluster-level peel are the same
 * operation. The peeled rows land on a *new confirmed identity* rather than
 * `identity_id` NULL, which is what makes a human split stick: the automatic
 * pass never re-merges a cluster spanning two confirmed identities. The new
 * identity's display fields come from the most recent peeled row (the
 * clusterer's representative rule). At least one row must remain behind —
 * peeling everything is a rename, not a split. Returns the new identity's id,
 * or null when the identity/rows don't line up.
 */
export async function splitIdentity(
  workspaceId: string,
  identityId: string,
  competitorIds: string[],
): Promise<string | null> {
  if (competitorIds.length === 0) return null;
  return getDb().transaction(async (tx) => {
    const linked = await tx
      .select({
        id: competitors.id,
        name: competitors.name,
        sailNumber: competitors.sailNumber,
        club: competitors.club,
        nationality: competitors.nationality,
        startDate: series.startDate,
      })
      .from(competitors)
      .innerJoin(series, eq(competitors.seriesId, series.id))
      .where(
        and(
          eq(competitors.workspaceId, workspaceId),
          eq(competitors.identityId, identityId),
        ),
      );
    const wanted = new Set(competitorIds);
    const peeled = linked.filter((r) => wanted.has(r.id));
    if (peeled.length !== competitorIds.length) return null; // stale selection
    if (peeled.length === linked.length) return null; // nothing would remain

    // Representative = most recent by series start date.
    const rep = [...peeled].sort((a, b) =>
      (a.startDate ?? '').localeCompare(b.startDate ?? ''),
    )[peeled.length - 1];

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
    const newId = crypto.randomUUID();
    await tx.insert(competitorIdentities).values({
      id: newId,
      workspaceId,
      label: rep.name.trim(),
      slug: mintSlug(rep.name.trim(), reserved),
      sailNumber: rep.sailNumber,
      club: rep.club || null,
      nationality: rep.nationality ?? null,
    });
    await tx
      .update(competitors)
      .set({ identityId: newId })
      .where(
        and(
          eq(competitors.workspaceId, workspaceId),
          inArray(competitors.id, competitorIds),
        ),
      );
    // The remainder's arc changed too — any "looks right" is stale.
    await tx
      .update(competitorIdentities)
      .set({ reviewedAt: null, updatedAt: new Date() })
      .where(eq(competitorIdentities.id, identityId));
    return newId;
  });
}

/** Stamp (or clear) the review queue's "looks right" mark (#221). Returns
 *  false if the identity isn't in the workspace. */
export async function setIdentityReviewed(
  workspaceId: string,
  identityId: string,
  reviewed: boolean,
): Promise<boolean> {
  const res = await getDb()
    .update(competitorIdentities)
    .set({ reviewedAt: reviewed ? new Date() : null, updatedAt: new Date() })
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        eq(competitorIdentities.id, identityId),
      ),
    );
  return (res.count ?? 0) > 0;
}

/**
 * Record that two identities are confirmed different sailors (#221) — the
 * review queue's dismissal for a weak name-match suggestion. Stored as an
 * ordered pair so each pair has one canonical row; replays are no-ops.
 * Returns false when either identity isn't in the workspace.
 */
export async function addIdentityDistinction(
  workspaceId: string,
  a: string,
  b: string,
): Promise<boolean> {
  if (a === b) return false;
  const [identityAId, identityBId] = a < b ? [a, b] : [b, a];
  const rows = await getDb()
    .select({ id: competitorIdentities.id })
    .from(competitorIdentities)
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        inArray(competitorIdentities.id, [identityAId, identityBId]),
      ),
    );
  if (rows.length !== 2) return false;
  await getDb()
    .insert(competitorIdentityDistinctions)
    .values({ id: crypto.randomUUID(), workspaceId, identityAId, identityBId })
    .onConflictDoNothing({
      target: [
        competitorIdentityDistinctions.identityAId,
        competitorIdentityDistinctions.identityBId,
      ],
    });
  return true;
}

/** The workspace's confirmed-different pairs, as ordered `${a}:${b}` keys —
 *  the review queue filters its merge suggestions against this set. */
export async function listIdentityDistinctions(
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await getDb()
    .select({
      a: competitorIdentityDistinctions.identityAId,
      b: competitorIdentityDistinctions.identityBId,
    })
    .from(competitorIdentityDistinctions)
    .where(eq(competitorIdentityDistinctions.workspaceId, workspaceId));
  return new Set(rows.map((r) => `${r.a}:${r.b}`));
}

/**
 * Whether the workspace has the `competitor-identity` feature enabled. Gates
 * the public career-arc page: a workspace that hasn't opted in shows nothing,
 * matching the containment model. (The feature is default-off, so a plain
 * membership in `enabledFeatures` is the whole test.)
 */
/** Whether the workspace has at least one sluggable competitor — i.e. the
 *  public competitor index would render rather than 404. Cheap existence probe
 *  for deciding whether to surface the index link on the workspace listing. */
export async function workspaceHasCompetitors(
  workspaceId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: competitorIdentities.id })
    .from(competitorIdentities)
    .where(
      and(
        eq(competitorIdentities.workspaceId, workspaceId),
        isNotNull(competitorIdentities.slug),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function workspaceHasIdentityFeature(
  workspaceId: string,
): Promise<boolean> {
  return workspaceIdentityFeatureOn(getDb(), workspaceId);
}

/** Whether an identity has no linked competitors left (for optional GC). */
export async function isIdentityOrphaned(
  workspaceId: string,
  identityId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: competitors.id })
    .from(competitors)
    .where(
      and(
        eq(competitors.workspaceId, workspaceId),
        eq(competitors.identityId, identityId),
      ),
    )
    .limit(1);
  return !row;
}
