/**
 * Manifest-driven competitor-identity assignment (#218).
 *
 * The fuzzy clusterer in `competitor-identity-cluster.ts` is a good *draft
 * generator*, but its merges can't be cleanly undone and manual UI splits are
 * invisible and unrepeatable. This module is the deterministic alternative: a
 * version-controlled manifest is the **golden record** — it carries the full
 * auto-pass result *plus* the human cleanups (merges, splits, renames), keyed on
 * the competitor's vanity slug (#217), so re-importing the corpus and applying
 * the manifest reproduces the same identities every time.
 *
 * Member rows are keyed by `(series-slug, sail number)` — stable, human-readable
 * source data — not opaque UUIDs. Series carry no slug in the DB, so the
 * manifest embeds its own `series` slug→id map: that keeps the member rows
 * readable while leaving this module workspace-agnostic (it never needs to know
 * how a producer derived those ids). IODAI is the first consumer, not a special
 * case.
 *
 * Pure and DB-free so it can be unit-tested and re-run deterministically. The
 * script `scripts/reconcile-identities.ts` does the I/O around it.
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

export const MANIFEST_VERSION = 1;

/**
 * Fixed namespace for the deterministic identity id (a UUIDv5 of
 * `<workspaceId>/<slug>/competitor`). Arbitrary but stable — never change it,
 * or every identity id moves. `competitor_identities` is a single shared table
 * across workspaces and slugs are only unique *per workspace*, so the workspace
 * id is part of the key to keep two workspaces' identical slugs from colliding
 * on the primary key.
 */
const IDENTITY_NS = 'b6e7a3d2-9c41-5f08-8a2e-1d4c7b0e9f63';

/** A single member row: the competitor was in this series under this sail. */
const manifestMemberSchema = z
  .tuple([z.string().min(1), z.string()])
  .describe('[series-slug, sail-number]');

const manifestIdentitySchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'a slug is required')
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumerics and hyphens'),
  name: z.string().trim().min(1, 'a name is required').max(120),
  club: z.string().trim().optional(),
  nationality: z.string().trim().optional(),
  members: z.array(manifestMemberSchema).min(1, 'an identity needs at least one member row'),
  note: z.string().optional(),
});

export const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  /** Map of the manifest's series-slugs to the workspace's `series.id`. */
  series: z.record(z.string(), z.uuid()),
  identities: z.array(manifestIdentitySchema),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ManifestIdentity = z.infer<typeof manifestIdentitySchema>;

/**
 * Parse + validate a manifest from JSON text. Throws with a readable message on
 * malformed JSON or a schema violation — the caller surfaces it to the operator.
 */
export function parseManifest(text: string): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`manifest is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`manifest failed validation:\n${issues}`);
  }
  return parsed.data;
}

/**
 * The deterministic identity id for a workspace + slug. A standard UUIDv5
 * (SHA-1) so a full reset-and-reapply reproduces byte-identical identity rows.
 */
export function identityIdForSlug(workspaceId: string, slug: string): string {
  return uuidv5(`${workspaceId}/${slug}/competitor`, IDENTITY_NS);
}

/** One identity ready to write: every field resolved, members → competitor ids. */
export interface ManifestAssignment {
  identityId: string;
  slug: string;
  label: string;
  club: string | null;
  nationality: string | null;
  /** Representative sail number — the last member row's sail. */
  sailNumber: string;
  competitorIds: string[];
}

/** A workspace competitor a `(seriesId, sail)` member could resolve to. */
export interface CompetitorCandidate {
  competitorId: string;
  name: string;
}

/** A member row that didn't resolve to a competitor, surfaced for the operator. */
export interface UnresolvedMember {
  slug: string;
  seriesSlug: string;
  sailNumber: string;
  reason: 'unknown-series' | 'no-competitor' | 'already-claimed' | 'ambiguous';
}

/** Normalised name tokens (≥2 chars, diacritics folded) for disambiguation. */
function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

export interface ManifestPlan {
  assignments: ManifestAssignment[];
  unresolvedMembers: UnresolvedMember[];
  /** Slugs that appear on more than one identity entry — a curation error. */
  duplicateSlugs: string[];
}

/**
 * Resolve a parsed manifest against a workspace's competitor rows into a flat
 * list of assignments, without touching a database. `lookup` answers "the
 * competitors in this `seriesId` carrying this sail" — the script builds it from
 * a `(seriesId, sailNumber)` index of the workspace's competitors.
 *
 * A sail isn't always unique within a series (placeholder sails in coached
 * fleets, two siblings on a shared hull at one event). When a member resolves to
 * more than one competitor, the claiming identity's name disambiguates — the
 * candidate with the most shared name tokens wins — so the two sailors each get
 * their own row instead of one shadowing the other.
 *
 * Members that don't resolve (unknown series-slug, no such sail, a sail two
 * entries both claim, or a name that matches no candidate) are collected rather
 * than dropped: a golden record that silently loses rows isn't reproducible.
 */
export function planManifestApply(
  manifest: Manifest,
  workspaceId: string,
  lookup: (seriesId: string, sailNumber: string) => CompetitorCandidate[] | undefined,
): ManifestPlan {
  const assignments: ManifestAssignment[] = [];
  const unresolvedMembers: UnresolvedMember[] = [];
  const claimedBy = new Map<string, string>(); // competitorId → slug
  const slugCounts = new Map<string, number>();

  for (const identity of manifest.identities) {
    slugCounts.set(identity.slug, (slugCounts.get(identity.slug) ?? 0) + 1);

    const want = nameTokens(identity.name);
    const competitorIds: string[] = [];
    let lastSail = '';
    for (const [seriesSlug, sailNumber] of identity.members) {
      const seriesId = manifest.series[seriesSlug];
      if (!seriesId) {
        unresolvedMembers.push({ slug: identity.slug, seriesSlug, sailNumber, reason: 'unknown-series' });
        continue;
      }
      const candidates = lookup(seriesId, sailNumber) ?? [];
      if (candidates.length === 0) {
        unresolvedMembers.push({ slug: identity.slug, seriesSlug, sailNumber, reason: 'no-competitor' });
        continue;
      }

      let chosen: CompetitorCandidate | undefined;
      if (candidates.length === 1) {
        chosen = candidates[0];
      } else {
        // Ambiguous sail — rank by name-token overlap, preferring an unclaimed row.
        const ranked = candidates
          .map((c) => ({ c, score: tokenOverlap(want, nameTokens(c.name)) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        chosen = (ranked.find((x) => !claimedBy.has(x.c.competitorId)) ?? ranked[0])?.c;
        if (!chosen) {
          unresolvedMembers.push({ slug: identity.slug, seriesSlug, sailNumber, reason: 'ambiguous' });
          continue;
        }
      }

      const claimer = claimedBy.get(chosen.competitorId);
      if (claimer && claimer !== identity.slug) {
        unresolvedMembers.push({ slug: identity.slug, seriesSlug, sailNumber, reason: 'already-claimed' });
        continue;
      }
      claimedBy.set(chosen.competitorId, identity.slug);
      competitorIds.push(chosen.competitorId);
      lastSail = sailNumber;
    }

    assignments.push({
      identityId: identityIdForSlug(workspaceId, identity.slug),
      slug: identity.slug,
      label: identity.name,
      club: identity.club ?? null,
      nationality: identity.nationality ?? null,
      sailNumber: lastSail,
      competitorIds,
    });
  }

  const duplicateSlugs = [...slugCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([slug]) => slug);

  return { assignments, unresolvedMembers, duplicateSlugs };
}

// ─── UUIDv5 (SHA-1) ────────────────────────────────────────────────────────────

function uuidv5(name: string, namespace: string): string {
  const ns = parseUuid(namespace);
  const hash = createHash('sha1')
    .update(ns)
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return formatUuid(bytes);
}

function parseUuid(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
