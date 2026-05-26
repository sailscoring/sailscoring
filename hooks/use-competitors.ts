'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  competitorRepo,
  getCompetitorAudit,
  updateHandicaps,
  type HandicapUpdateRow,
} from '@/lib/api-repository';
import type { AuditStamp, Competitor } from '@/lib/types';

import { queryKeys } from './query-keys';

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

export function useSaveCompetitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitor: Competitor) => {
      const list = qc.getQueryData<Competitor[]>(
        queryKeys.competitors.bySeries(competitor.seriesId),
      );
      const cached = list?.find((c) => c.id === competitor.id);
      return competitorRepo.save(competitor, { expectedVersion: cached?.version });
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(saved.seriesId),
      });
    },
    // Serialize so a rapid second save sees the cache update from the first
    // and sends the fresh `expectedVersion`. See useSaveSeries for context.
    scope: { id: 'competitors' },
  });
}

export function useSaveCompetitors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitors: Competitor[]) =>
      competitorRepo.saveMany(competitors),
    onSuccess: (_void, competitors) => {
      const seriesIds = new Set(competitors.map((c) => c.seriesId));
      for (const seriesId of seriesIds) {
        qc.invalidateQueries({
          queryKey: queryKeys.competitors.bySeries(seriesId),
        });
      }
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
  return useMutation<{ updated: Competitor[] }, Error, HandicapUpdateRow[]>({
    mutationFn: (updates) => updateHandicaps(seriesId, updates),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(seriesId) });
    },
    scope: { id: 'competitors' },
  });
}

export function useDeleteCompetitor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; seriesId: string }) =>
      competitorRepo.delete(id),
    onSuccess: (_void, { seriesId }) => {
      qc.invalidateQueries({
        queryKey: queryKeys.competitors.bySeries(seriesId),
      });
      // Finishes reference competitorId; cached lists may need a refresh.
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}
