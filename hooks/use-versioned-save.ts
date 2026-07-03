'use client';

import {
  useMutation,
  useQueryClient,
  type MutationKey,
  type QueryClient,
  type QueryKey,
  type UseMutationResult,
} from '@tanstack/react-query';

/**
 * Factory for the cached-version CAS save mutation every versioned entity
 * uses: read the entity's current `version` from the query cache, send it as
 * `expectedVersion` so the server's compare-and-swap can 409 on a concurrent
 * edit, then refresh the cache.
 *
 * The `scopeId` serialization is load-bearing: rapid consecutive saves of
 * the same entity type queue behind each other, so save #2's mutationFn runs
 * only after save #1's onSuccess has landed the bumped version in the cache
 * — without it, both reads see the old version and the second save 409s.
 * The cache refresh in `onSaved` is the other half of that contract: it must
 * leave the saved entity's current version findable before the next queued
 * save reads it.
 */
export function useVersionedSave<T extends { id: string; version?: number }>(cfg: {
  /** Optional mutation key, for `useIsMutating`-style observers. */
  mutationKey?: MutationKey;
  /** Query key of the cached collection holding the entity's current version. */
  listKey: (entity: T) => QueryKey;
  /**
   * Override when the cached version doesn't live in a list — e.g. the
   * series detail cache holds a single object. Default: find-by-id in
   * `listKey(entity)`.
   */
  readCachedVersion?: (qc: QueryClient, entity: T) => number | undefined;
  save: (entity: T, opts: { expectedVersion?: number }) => Promise<T>;
  /** Mutation serialization scope, shared with the entity's other writers. */
  scopeId: string;
  /**
   * Cache strategy after a successful save. Default: invalidate
   * `listKey(saved)`. An async strategy is awaited before `mutateAsync`
   * resolves (react-query awaits async onSuccess).
   */
  onSaved?: (qc: QueryClient, saved: T) => void | Promise<void>;
}): UseMutationResult<T, Error, T> {
  const qc = useQueryClient();
  return useMutation<T, Error, T>({
    ...(cfg.mutationKey ? { mutationKey: cfg.mutationKey } : {}),
    mutationFn: (entity) => {
      const expectedVersion = cfg.readCachedVersion
        ? cfg.readCachedVersion(qc, entity)
        : qc
            .getQueryData<T[]>(cfg.listKey(entity))
            ?.find((x) => x.id === entity.id)?.version;
      return cfg.save(entity, { expectedVersion });
    },
    onSuccess: (saved) => {
      if (cfg.onSaved) return cfg.onSaved(qc, saved);
      qc.invalidateQueries({ queryKey: cfg.listKey(saved) });
    },
    scope: { id: cfg.scopeId },
  });
}
