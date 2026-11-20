/**
 * The URL slug of a series category: the last segment of its public page,
 * `/p/{ws}/-/{slug}`. Minted from the name, kept on the row, and re-derived
 * when the category is renamed — the old slug is kept so links made before
 * the rename still resolve.
 */

import { and, eq, ne } from 'drizzle-orm';

import type { SailScoringDb } from './db/client';
import * as schema from './db/schema';

/** The slug a category name reads as: lowercase, runs of anything outside
 *  `a-z0-9` collapsed to one hyphen, none at either end. Mirrors the SQL that
 *  backfilled the column, so a name always maps to the slug the migration
 *  gave it. */
export function categorySlugBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'category'
  );
}

/** `base`, or `base-2`, `base-3`, … — the first not already taken. Two names
 *  can read as one slug ("Cork Week" and "Cork-Week"); the later one gets a
 *  suffix rather than shadowing the first. */
export function uniqueCategorySlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** The slug for a category called `name` in a workspace, avoiding every other
 *  category's current slug. `exceptId` is the category being renamed, whose
 *  own slug is free to keep. */
export async function mintCategorySlug(
  db: Pick<SailScoringDb, 'select'>,
  workspaceId: string,
  name: string,
  exceptId?: string,
): Promise<string> {
  const rows = await db
    .select({ slug: schema.categories.slug })
    .from(schema.categories)
    .where(
      exceptId
        ? and(
            eq(schema.categories.workspaceId, workspaceId),
            ne(schema.categories.id, exceptId),
          )
        : eq(schema.categories.workspaceId, workspaceId),
    );
  return uniqueCategorySlug(
    categorySlugBase(name),
    new Set(rows.map((r) => r.slug)),
  );
}

/** A renamed category's former slugs: the old one is added (most recent
 *  last) unless the rename left the slug unchanged, and the new slug is never
 *  listed as former — renaming back must not leave a redirect to itself. */
export function formerSlugsAfterRename(
  former: readonly string[],
  oldSlug: string,
  newSlug: string,
): string[] {
  if (oldSlug === newSlug) return [...former];
  return [...former.filter((s) => s !== oldSlug && s !== newSlug), oldSlug];
}
