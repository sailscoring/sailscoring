'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { raceRatingOverrideRepo } from '@/lib/api-repository';
import type { RaceRatingOverride } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useRaceRatingOverridesByRace(raceId: string) {
  return useQuery<RaceRatingOverride[]>({
    queryKey: queryKeys.raceRatingOverrides.byRace(raceId),
    queryFn: () => raceRatingOverrideRepo.listByRaces([raceId]),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, raceId: string) {
  qc.invalidateQueries({ queryKey: queryKeys.raceRatingOverrides.byRace(raceId) });
  qc.invalidateQueries({ queryKey: queryKeys.raceRatingOverrides.all });
  // Overrides change scoring, so the series' TCF history (and standings) shift.
  qc.invalidateQueries({ queryKey: queryKeys.tcfHistory.all });
  // The write bumped the series row server-side; refresh the cached series so
  // a follow-on settings save reads a fresh expectedVersion. Returned so the
  // mutation's onSuccess awaits the refetch before mutateAsync resolves.
  return qc.invalidateQueries({ queryKey: queryKeys.series.all });
}

export function useSaveRaceRatingOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (override: RaceRatingOverride) => raceRatingOverrideRepo.saveMany([override]),
    onSuccess: (_void, override) => invalidate(qc, override.raceId),
    scope: { id: 'race-rating-overrides' },
  });
}

export function useDeleteRaceRatingOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; raceId: string }) => raceRatingOverrideRepo.delete(id),
    onSuccess: (_void, { raceId }) => invalidate(qc, raceId),
    scope: { id: 'race-rating-overrides' },
  });
}
