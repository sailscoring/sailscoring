'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  competitorRepo,
  getCompetitorAudit,
  updateHandicaps,
  type HandicapUpdateRow,
} from '@/lib/api-repository';
import type { CompetitorFieldPatch } from '@/lib/repository';
import type { AuditStamp, Competitor } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

export function useCompetitorsBySeries(seriesId: string) {
  return useQuery<Competitor[]>({
    queryKey: queryKeys.competitors.bySeries(seriesId),
    queryFn: () => competitorRepo.listBySeries(seriesId),
  });
}

/**
 * "Who last edited this competitor" stamp for the edit dialog (#153). Pass the
 * id only while the dialog is open; `null` disables the query.
 */
export function useCompetitorAudit(id: string | null) {
  return useQuery<AuditStamp>({
    queryKey: queryKeys.competitors.audit(id ?? 'none'),
    queryFn: () => getCompetitorAudit(id!),
    enabled: id !== null,
  });
}

/**
 * Mutation key shared by the competitor-row writers. Watched via
 * `useIsMutating` by UI that reports whether the scorer's work is saved —
 * finish entry writes competitors as well as finishes (resolving an unknown
 * sail number records the number on the boat), and a badge that only counted
 * finish saves would say "All changes saved" over a write still in flight.
 */
export const competitorRowMutationKey = ['competitor-row'] as const;

export function useSaveCompetitor() {
  return useVersionedSave<Competitor>({
    mutationKey: competitorRowMutationKey,
    listKey: (competitor) => queryKeys.competitors.bySeries(competitor.seriesId),
    save: (competitor, opts) => competitorRepo.save(competitor, opts),
    scopeId: 'competitors',
    onSaved: async (qc, saved) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(saved.seriesId),
      });
      // Every child write bumps the series row's lastModifiedAt + version
      // server-side. Await the series refetch so a caller that proceeds to a
      // series settings save reads a fresh expectedVersion, not a stale 409.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useSaveCompetitors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitors: Competitor[]) =>
      competitorRepo.saveMany(competitors),
    onSuccess: async (_void, competitors) => {
      const seriesIds = new Set(competitors.map((c) => c.seriesId));
      for (const seriesId of seriesIds) {
        qc.invalidateQueries({
          queryKey: queryKeys.competitors.bySeries(seriesId),
        });
      }
      // See useSaveCompetitor — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
    scope: { id: 'competitors' },
  });
}

/**
 * Bulk-write the four handicap fields across many competitors in one
 * round-trip. Used by the Update Handicaps dialog (#144); see
 * `lib/source-handicaps.ts` for the planner that produces these rows.
 *
 * Transactional on the server, so a 409 on any row rolls back the whole
 * batch. Caller refreshes and retries.
 */
export function useUpdateHandicaps(seriesId: string) {
  const qc = useQueryClient();
  return useMutation<
    { updated: Competitor[] },
    Error,
    { updates: HandicapUpdateRow[]; freezeScoredRaces?: boolean }
  >({
    mutationFn: ({ updates, freezeScoredRaces }) =>
      updateHandicaps(seriesId, updates, { freezeScoredRaces }),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(seriesId) });
      // See useSaveCompetitor — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
    scope: { id: 'competitors' },
  });
}

/**
 * Bulk one-field write for the multi-select "Set field…" action: one
 * round-trip and one activity entry for the whole selection.
 */
export function useUpdateCompetitorsField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, seriesId, patch }: { ids: string[]; seriesId: string; patch: CompetitorFieldPatch }) =>
      competitorRepo.updateMany(seriesId, ids, patch),
    // The excluded flag is flipped from a checkbox on the row, so the box
    // must move on the click, not a round-trip later: patch the cached list
    // and put it back if the write fails. Text-valued fields are set from a
    // dialog that closes on success, so they wait for the refetch as before.
    onMutate: async ({ ids, seriesId, patch }) => {
      if (patch.field !== 'excluded') return undefined;
      const key = queryKeys.competitors.bySeries(seriesId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Competitor[]>(key);
      if (prev) {
        const wanted = new Set(ids);
        qc.setQueryData<Competitor[]>(
          key,
          prev.map((c) => {
            if (!wanted.has(c.id)) return c;
            const { excluded: _dropped, ...rest } = c;
            return patch.value ? { ...rest, excluded: true } : rest;
          }),
        );
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: async (_void, { seriesId }) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(seriesId),
      });
      // See useSaveCompetitor — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
    scope: { id: 'competitors' },
  });
}

export function useDeleteCompetitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) =>
      competitorRepo.delete(id),
    onSuccess: async (_void, { seriesId }) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(seriesId),
      });
      // Finishes reference competitorId; cached lists may need a refresh.
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
      // See useSaveCompetitor — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

/**
 * Batch delete for the multi-select bulk action: one round-trip and one
 * activity entry for the whole selection, rather than N of each.
 */
export function useDeleteCompetitors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, seriesId }: { ids: string[]; seriesId: string }) =>
      competitorRepo.deleteMany(seriesId, ids),
    onSuccess: async (_void, { seriesId }) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(seriesId),
      });
      // Finishes reference competitorId; cached lists may need a refresh.
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
      // See useSaveCompetitor — keep the cached series row's version fresh.
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}
