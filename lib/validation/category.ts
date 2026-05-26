import { z } from 'zod';

import type { Category } from '@/lib/types';

import { uuidSchema } from './common';

export const CATEGORY_NAME_MAX_LENGTH = 60;

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, 'Category name is required')
  .max(CATEGORY_NAME_MAX_LENGTH);

export const categoryCreateSchema = z.object({ name: categoryNameSchema });
export const categoryRenameSchema = z.object({ name: categoryNameSchema });
export const categoryReorderSchema = z.object({
  orderedIds: z.array(uuidSchema),
});

// ─── Type-fidelity guard ─────────────────────────────────────────────────────
// `Category` is the read shape returned by the API; the create/rename bodies
// are a subset. This keeps the returned-shape contract honest if the type drifts.
const _categoryShape: Category = undefined as unknown as {
  id: string;
  name: string;
  displayOrder: number;
};
void _categoryShape;
