import 'server-only';

import { and, eq } from 'drizzle-orm';

import { getDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { competitorIdentities, competitors, series } from '@/lib/db/schema/series';
import { parseOrgMetadata } from '@/lib/features';

/**
 * Server-side reads/writes for the cross-series competitor-identity spine
 * (#212), shared by the reconcile surface (`/workspace/identities`) and the
 * public career-arc page (`/p/{ws}/competitor/{id}`). Both need the same shape:
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
  label: string;
  sailNumber: string;
  club: string | null;
  nationality: string | null;
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
    label: string;
    sailNumber: string;
    club: string | null;
    nationality: string | null;
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
        label: r.label,
        sailNumber: r.sailNumber,
        club: r.club,
        nationality: r.nationality,
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
  label: competitorIdentities.label,
  sailNumber: competitorIdentities.sailNumber,
  club: competitorIdentities.club,
  nationality: competitorIdentities.nationality,
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

/**
 * Split a competitor row off its identity (sets `identity_id` null). The row is
 * left unlinked — a subsequent reconcile pass re-clusters it (into its own
 * identity or a better-matching one). Scoped to the identity + workspace so a
 * stale id can't unlink someone else's row. Returns false if nothing matched.
 */
export async function unlinkCompetitor(
  workspaceId: string,
  identityId: string,
  competitorId: string,
): Promise<boolean> {
  const res = await getDb()
    .update(competitors)
    .set({ identityId: null })
    .where(
      and(
        eq(competitors.workspaceId, workspaceId),
        eq(competitors.id, competitorId),
        eq(competitors.identityId, identityId),
      ),
    );
  return (res.count ?? 0) > 0;
}

/**
 * Whether the workspace has the `competitor-identity` feature enabled. Gates
 * the public career-arc page: a workspace that hasn't opted in shows nothing,
 * matching the containment model. (The feature is default-off, so a plain
 * membership in `enabledFeatures` is the whole test.)
 */
export async function workspaceHasIdentityFeature(
  workspaceId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ metadata: organization.metadata, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, workspaceId))
    .limit(1);
  if (!row) return false;
  return parseOrgMetadata(row.metadata, row.slug).enabledFeatures.includes(
    'competitor-identity',
  );
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
