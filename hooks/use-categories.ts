'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from '@/lib/api-repository';
import type { Category } from '@/lib/types';

import { queryKeys } from './query-keys';

/** Scorer-defined categories for the active workspace, in display order (#154). */
export function useCategories() {
  return useQuery<Category[]>({
    queryKey: queryKeys.categories.list(),
    queryFn: () => listCategories(),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => createCategory(name),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

export function useRenameCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameCategory(id, name),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.categories.all });
      // Members fall back to Uncategorized server-side — refresh the list so
      // the home page re-partitions.
      qc.invalidateQueries({ queryKey: queryKeys.series.list() });
    },
  });
}

export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorderCategories(orderedIds),
    // Reorder the cached list up front so a drag-reorder shows its new order
    // immediately on drop, rather than snapping back until the save and refetch
    // land.
    onMutate: async (orderedIds) => {
      const key = queryKeys.categories.list();
      await qc.cancelQueries({ queryKey: queryKeys.categories.all });
      const prev = qc.getQueryData<Category[]>(key);
      if (prev) {
        const byId = new Map(prev.map((c) => [c.id, c]));
        const reordered = orderedIds
          .map((id, i) => {
            const c = byId.get(id);
            return c ? { ...c, displayOrder: i } : undefined;
          })
          .filter((c): c is Category => c !== undefined);
        qc.setQueryData<Category[]>(key, reordered);
      }
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.categories.list(), ctx.prev);
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: queryKeys.categories.all }),
  });
}
