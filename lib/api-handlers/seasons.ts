import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { BadRequestError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import {
  getPublishedSeasonTree,
  upsertPublishedFolder,
} from '@/lib/published-repository';

/**
 * Workspace seasons (ADR-011). Seasons mostly derive from what's published —
 * this surface manages the rest: defining a season ahead of its first publish
 * (so the publish dialog can offer it), flagging the **current** one (the
 * public index expands it; the dialog defaults to it), and adopting the
 * year-named categories some workspaces used as season filing before seasons
 * existed.
 */

const seasonLabelSchema = z.object({
  label: z.string().trim().min(1).max(40),
});

/** A season label that reads as a year or a year-spanning pair. */
function yearLikeLabel(label: string): boolean {
  return /^\d{4}([-–/]\d{2,4})?$/.test(label.trim());
}

export interface SeasonListItem {
  label: string;
  current: boolean;
  /** Published top-level folders filed in the season. */
  folderCount: number;
}

export async function listSeasons(workspace: WorkspaceContext): Promise<{
  items: SeasonListItem[];
  /** Year-named categories the adopt helper would convert. */
  yearCategories: string[];
}> {
  const tree = await getPublishedSeasonTree(workspace.workspaceId);
  const cats = await getDb()
    .select({ name: schema.categories.name })
    .from(schema.categories)
    .where(eq(schema.categories.workspaceId, workspace.workspaceId));
  return {
    items: tree.seasons.map((s) => ({
      label: s.label,
      current: s.current,
      folderCount: s.folders.length,
    })),
    yearCategories: cats.map((c) => c.name).filter(yearLikeLabel),
  };
}

export async function createSeason(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ items: SeasonListItem[]; yearCategories: string[] }> {
  const { label } = seasonLabelSchema.parse(body);
  const tree = await getPublishedSeasonTree(workspace.workspaceId);
  if (tree.seasons.some((s) => s.label === label)) {
    throw new BadRequestError('a season with this label already exists');
  }
  await getDb()
    .insert(schema.workspaceSeasons)
    .values({ workspaceId: workspace.workspaceId, label })
    .onConflictDoNothing();
  return listSeasons(workspace);
}

/** Flag one season as current (the public index expands it; the publish
 *  dialog defaults to it). Defined for derived seasons too — the row is
 *  created on demand. */
export async function setCurrentSeason(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ items: SeasonListItem[]; yearCategories: string[] }> {
  const { label } = seasonLabelSchema.parse(body);
  const tree = await getPublishedSeasonTree(workspace.workspaceId);
  if (!tree.seasons.some((s) => s.label === label)) {
    throw new BadRequestError('no such season');
  }
  const db = getDb();
  await db
    .update(schema.workspaceSeasons)
    .set({ isCurrent: false })
    .where(eq(schema.workspaceSeasons.workspaceId, workspace.workspaceId));
  await db
    .insert(schema.workspaceSeasons)
    .values({ workspaceId: workspace.workspaceId, label, isCurrent: true })
    .onConflictDoUpdate({
      target: [schema.workspaceSeasons.workspaceId, schema.workspaceSeasons.label],
      set: { isCurrent: true },
    });
  return listSeasons(workspace);
}

/**
 * Adopt year-named categories as seasons: every published slug whose series
 * is filed in a category like "2025" gets that label pinned as its folder's
 * season. The categories themselves are left alone — the public listing
 * already suppresses a category heading that repeats its season, and
 * deleting them stays the scorer's call.
 */
export async function adoptYearCategories(
  workspace: WorkspaceContext,
): Promise<{ adopted: number; pinned: number }> {
  const db = getDb();
  const cats = (
    await db
      .select({ id: schema.categories.id, name: schema.categories.name })
      .from(schema.categories)
      .where(eq(schema.categories.workspaceId, workspace.workspaceId))
  ).filter((c) => yearLikeLabel(c.name));
  let pinned = 0;
  for (const cat of cats) {
    const rows = await db
      .selectDistinct({ slug: schema.publishedSeries.slug })
      .from(schema.publishedSeries)
      .innerJoin(
        schema.series,
        eq(schema.publishedSeries.seriesId, schema.series.id),
      )
      .where(
        and(
          eq(schema.publishedSeries.workspaceId, workspace.workspaceId),
          inArray(schema.series.categoryId, [cat.id]),
        ),
      );
    for (const { slug } of rows) {
      await upsertPublishedFolder(workspace.workspaceId, slug, {
        season: cat.name.trim(),
      });
      pinned++;
    }
  }
  return { adopted: cats.length, pinned };
}
