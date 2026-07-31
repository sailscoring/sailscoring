import 'server-only';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { BadRequestError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { getPublishedSeasonTree } from '@/lib/published-repository';

/**
 * Workspace seasons (ADR-011). Seasons mostly derive from what's published —
 * this surface manages the rest: defining a season ahead of its first publish
 * (so the publish dialog can offer it) and flagging the **current** one (the
 * public index expands it; the dialog defaults to it).
 */

const seasonLabelSchema = z.object({
  label: z.string().trim().min(1).max(40),
});

export interface SeasonListItem {
  label: string;
  current: boolean;
  /** Published top-level folders filed in the season. */
  folderCount: number;
}

export async function listSeasons(workspace: WorkspaceContext): Promise<{
  items: SeasonListItem[];
}> {
  const tree = await getPublishedSeasonTree(workspace.workspaceId);
  return {
    items: tree.seasons.map((s) => ({
      label: s.label,
      current: s.current,
      folderCount: s.folders.length,
    })),
  };
}

export async function createSeason(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ items: SeasonListItem[] }> {
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
): Promise<{ items: SeasonListItem[] }> {
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
