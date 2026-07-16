import 'server-only';

import { and, eq, isNotNull } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import { isValidSlugSegment } from '@/lib/api-handlers/publish';
import {
  requireFeature,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { mintSlug } from '@/lib/competitor-slug';
import { getDb } from '@/lib/db/client';
import { rankings } from '@/lib/db/schema/series';
import { newRankingBucket, type RankingConfig } from '@/lib/ranking';
import {
  computeRankingStandings,
  listAsPublishedRankings,
  type RankingStandingsData,
} from '@/lib/ranking-standings';
import {
  rankingCreateSchema,
  rankingUpdateSchema,
} from '@/lib/validation/ranking';

/**
 * Workspace cross-series rankings (#209). Every endpoint is gated
 * server-side on the `rankings` feature; the config is stored, the ladder is
 * computed on demand. Workspace-scoped throughout.
 */

export interface RankingDto {
  id: string;
  name: string;
  slug: string | null;
  config: RankingConfig;
  published: boolean;
  createdAt: string;
}

function toDto(row: typeof rankings.$inferSelect): RankingDto {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    config: row.config,
    published: row.publishedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AsPublishedRankingListItem {
  id: string;
  name: string;
  slug: string;
  season: number;
  fleetLabel: string | null;
}

export async function listRankings(
  workspace: WorkspaceContext,
): Promise<{ items: RankingDto[]; asPublished: AsPublishedRankingListItem[] }> {
  requireFeature(workspace, 'rankings');
  const rows = await getDb()
    .select()
    .from(rankings)
    .where(eq(rankings.workspaceId, workspace.workspaceId))
    .orderBy(rankings.displayOrder, rankings.createdAt);
  // Historical as-published rankings (#309) ride along read-only: the
  // Rankings tab lists them beside the computed ladders.
  const asPublished = await listAsPublishedRankings(workspace.workspaceId);
  return { items: rows.map(toDto), asPublished };
}

export async function createRanking(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<RankingDto> {
  requireFeature(workspace, 'rankings');
  const { name } = rankingCreateSchema.parse(body);
  const db = getDb();
  const reserved = new Set(
    (
      await db
        .select({ slug: rankings.slug })
        .from(rankings)
        .where(
          and(
            eq(rankings.workspaceId, workspace.workspaceId),
            isNotNull(rankings.slug),
          ),
        )
    ).map((r) => r.slug as string),
  );
  const id = crypto.randomUUID();
  const config: RankingConfig = {
    buckets: [newRankingBucket(crypto.randomUUID())],
  };
  const [row] = await db
    .insert(rankings)
    .values({
      id,
      workspaceId: workspace.workspaceId,
      name,
      slug: mintSlug(name, reserved),
      config,
      updatedBy: workspace.userId,
    })
    .returning();
  return toDto(row);
}

async function getRow(
  workspaceId: string,
  id: string,
): Promise<typeof rankings.$inferSelect> {
  const [row] = await getDb()
    .select()
    .from(rankings)
    .where(and(eq(rankings.workspaceId, workspaceId), eq(rankings.id, id)))
    .limit(1);
  if (!row) throw new NotFoundError('ranking');
  return row;
}

export async function getRanking(
  workspace: WorkspaceContext,
  id: string,
): Promise<RankingDto> {
  requireFeature(workspace, 'rankings');
  return toDto(await getRow(workspace.workspaceId, id));
}

export async function putRanking(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<RankingDto> {
  requireFeature(workspace, 'rankings');
  const input = rankingUpdateSchema.parse(body);
  const existing = await getRow(workspace.workspaceId, id);

  // The slug is the public URL: choosable while the ranking is private,
  // frozen once it has been published (like a series slug).
  let slug = existing.slug;
  if (input.slug !== undefined && input.slug !== existing.slug) {
    if (existing.publishedAt !== null) {
      throw new BadRequestError(
        'the slug is fixed while the ranking is published',
        { code: 'slug-frozen' },
      );
    }
    if (!isValidSlugSegment(input.slug)) {
      throw new BadRequestError('invalid slug', { code: 'invalid-slug' });
    }
    const [taken] = await getDb()
      .select({ id: rankings.id })
      .from(rankings)
      .where(
        and(
          eq(rankings.workspaceId, workspace.workspaceId),
          eq(rankings.slug, input.slug),
        ),
      )
      .limit(1);
    if (taken && taken.id !== id) {
      throw new BadRequestError('another ranking already uses that slug', {
        code: 'slug-taken',
      });
    }
    slug = input.slug;
  }

  const [row] = await getDb()
    .update(rankings)
    .set({
      name: input.name,
      slug,
      config: input.config,
      // The toggle keeps its original timestamp while it stays on.
      publishedAt: input.published
        ? (existing.publishedAt ?? new Date())
        : null,
      updatedAt: new Date(),
      updatedBy: workspace.userId,
    })
    .where(
      and(
        eq(rankings.workspaceId, workspace.workspaceId),
        eq(rankings.id, id),
      ),
    )
    .returning();
  return toDto(row);
}

export async function deleteRanking(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  requireFeature(workspace, 'rankings');
  await getDb()
    .delete(rankings)
    .where(
      and(
        eq(rankings.workspaceId, workspace.workspaceId),
        eq(rankings.id, id),
      ),
    );
}

/** The computed ladder for the in-app view — every config series counts,
 *  published or not (the public page recomputes over published only). */
export async function rankingStandings(
  workspace: WorkspaceContext,
  id: string,
): Promise<RankingStandingsData> {
  requireFeature(workspace, 'rankings');
  const row = await getRow(workspace.workspaceId, id);
  return computeRankingStandings(workspace.workspaceId, row.config);
}
