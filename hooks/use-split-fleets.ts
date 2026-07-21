'use client';

// Split-fleet series hooks (PROTOTYPE — see lib/split-fleets.ts).

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  addSplitStageRaces,
  commitSplitRound,
  deleteSplitRound,
  getSplitFleetState,
  putSplitFleetConfig,
  type SplitFleetStateDto,
  type SplitRoundCommit,
} from '@/lib/api-repository';
import type { SplitFleetConfig } from '@/lib/split-fleets';

import { queryKeys } from './query-keys';

export function useSplitFleetState(seriesId: string) {
  return useQuery<SplitFleetStateDto>({
    queryKey: queryKeys.splitFleets.bySeries(seriesId),
    queryFn: () => getSplitFleetState(seriesId),
  });
}

/** A round commit touches fleets, memberships, races, and starts — refresh
 *  the whole series scope. */
async function invalidateSplitFleetScope(qc: QueryClient, seriesId: string): Promise<void> {
  qc.invalidateQueries({ queryKey: queryKeys.splitFleets.bySeries(seriesId) });
  qc.invalidateQueries({ queryKey: queryKeys.fleets.bySeries(seriesId) });
  qc.invalidateQueries({ queryKey: queryKeys.competitors.bySeries(seriesId) });
  qc.invalidateQueries({ queryKey: queryKeys.races.bySeries(seriesId) });
  qc.invalidateQueries({ queryKey: queryKeys.raceStarts.bySeries(seriesId) });
  qc.invalidateQueries({ queryKey: queryKeys.finishes.bySeries(seriesId) });
  await qc.invalidateQueries({ queryKey: queryKeys.series.all });
}

export function useSaveSplitFleetConfig(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: SplitFleetConfig) => putSplitFleetConfig(seriesId, config),
    onSuccess: async (state) => {
      qc.setQueryData(queryKeys.splitFleets.bySeries(seriesId), state);
      await qc.invalidateQueries({ queryKey: queryKeys.series.all });
    },
  });
}

export function useCommitSplitRound(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SplitRoundCommit) => commitSplitRound(seriesId, payload),
    onSuccess: () => invalidateSplitFleetScope(qc, seriesId),
  });
}

export function useAddSplitStageRaces(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { roundId: string; stageRaceNumbers: number[]; fleetIds?: string[] }) =>
      addSplitStageRaces(seriesId, input.roundId, {
        stageRaceNumbers: input.stageRaceNumbers,
        fleetIds: input.fleetIds,
      }),
    onSuccess: () => invalidateSplitFleetScope(qc, seriesId),
  });
}

export function useDeleteSplitRound(seriesId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roundId: string) => deleteSplitRound(seriesId, roundId),
    onSuccess: () => invalidateSplitFleetScope(qc, seriesId),
  });
}
