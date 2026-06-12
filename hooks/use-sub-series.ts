'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  createSubSeries,
  deleteSubSeries,
  listSubSeries,
  subSeriesRepo,
} from '@/lib/api-repository';
import type { SubSeries } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

export function useSubSeriesBySeries(seriesId: string) {
  return useQuery<SubSeries[]>({
    queryKey: queryKeys.subSeries.bySeries(seriesId),
    queryFn: () => listSubSeries(seriesId),
  });
}

/** Every sub-series mutation rewrites race membership and displayOrder
 *  server-side, so refresh blocks, races, and the series row together. */
async function invalidateSubSeriesScope(qc: QueryClient, seriesId: string) {
  qc.invalidateQueries({ queryKey: queryKeys.subSeries.bySeries(seriesId) });
  qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
  await qc.invalidateQueries({ queryKey: queryKeys.series.all });
}

/** The "start a new sub-series here" gesture (and the empty/append form). */
export function useCreateSubSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, input }: {
      seriesId: string;
      input: { name: string; firstRaceId?: string; initialName?: string };
    }) => createSubSeries(seriesId, input),
    onSuccess: (_created, { seriesId }) => invalidateSubSeriesScope(qc, seriesId),
  });
}

/** Rename (plain upsert). */
export function useSaveSubSeries() {
  return useVersionedSave<SubSeries>({
    listKey: (ss) => queryKeys.subSeries.bySeries(ss.seriesId),
    readCachedVersion: (qc, ss) =>
      qc
        .getQueryData<SubSeries[]>(queryKeys.subSeries.bySeries(ss.seriesId))
        ?.find((b) => b.id === ss.id)?.version,
    save: (ss, opts) => subSeriesRepo.save(ss, opts),
    scopeId: 'subSeries',
    onSaved: async (qc, saved) => {
      await invalidateSubSeriesScope(qc, saved.seriesId);
    },
  });
}

/** Remove a block; its races merge into the neighbouring block. */
export function useDeleteSubSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ seriesId, subSeriesId }: { seriesId: string; subSeriesId: string }) =>
      deleteSubSeries(seriesId, subSeriesId),
    onSuccess: (_void, { seriesId }) => invalidateSubSeriesScope(qc, seriesId),
  });
}
