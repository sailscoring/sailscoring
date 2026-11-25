import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { createRepos } from '@/lib/postgres-repository';
import { categoryPagePath } from '@/lib/published-category';
import {
  listPublishedCategories,
  purgePublishedCacheIfPublished,
} from '@/lib/published-repository';
import {
  categoryCreateSchema,
  categoryRenameSchema,
  categoryReorderSchema,
} from '@/lib/validation/category';
import type { Category } from '@/lib/types';

/**
 * Scorer-defined series categories (#154). Per-workspace, scorer-editable.
 * "Uncategorized" is synthetic (`series.category_id == null`) and never a row
 * here, so it can't be created, renamed, reordered, or deleted.
 */

/** Case-insensitive duplicate check — the DB has an exact-match unique index,
 *  this catches "Spring" vs "spring" with a friendly 400. */
function assertNameFree(existing: Category[], name: string, exceptId?: string): void {
  const clash = existing.some(
    (c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) throw new BadRequestError('a category with this name already exists');
}

/** Each category with its public page's path, or null while nothing in it
 *  is published (the page 404s until something is). */
export async function listCategories(
  workspace: WorkspaceContext,
): Promise<{ items: Category[] }> {
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [items, published] = await Promise.all([
    repos.categories.list(),
    listPublishedCategories(workspace.workspaceId),
  ]);
  const publishedIds = new Set(published.map((c) => c.id));
  return {
    items: items.map((c) => ({
      ...c,
      publicPath: publishedIds.has(c.id)
        ? categoryPagePath(workspace.workspaceSlug, c.slug)
        : null,
    })),
  };
}

export async function createCategory(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<Category> {
  const { name } = categoryCreateSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  assertNameFree(await repos.categories.list(), name);
  return repos.categories.create(name);
}

export async function renameCategory(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Category> {
  const { name } = categoryRenameSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  assertNameFree(await repos.categories.list(), name, id);
  const updated = await repos.categories.rename(id, name);
  if (!updated) throw new NotFoundError('category');
  // The public workspace listing groups and orders by category.
  await purgePublishedCacheIfPublished(workspace.workspaceId);
  return updated;
}

export async function deleteCategory(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  // Series in this category fall back to Uncategorized via ON DELETE SET NULL.
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.categories.delete(id);
  await purgePublishedCacheIfPublished(workspace.workspaceId);
}

export async function reorderCategories(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ items: Category[] }> {
  const { orderedIds } = categoryReorderSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  await repos.categories.reorder(orderedIds);
  await purgePublishedCacheIfPublished(workspace.workspaceId);
  return { items: await repos.categories.list() };
}
