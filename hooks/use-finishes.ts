'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { Finish } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useFinishesByRace(raceId: string) {
  const { finishRepo } = useRepos();
  return useQuery<Finish[]>({
    queryKey: queryKeys.finishes.byRace(raceId),
    queryFn: () => finishRepo.listByRace(raceId),
  });
}

export function useFinishesBySeries(seriesId: string, competitorIds: string[]) {
  const { finishRepo } = useRepos();
  return useQuery<Finish[]>({
    queryKey: [...queryKeys.finishes.bySeries(seriesId), [...competitorIds].sort()],
    queryFn: () => finishRepo.listBySeries(seriesId, competitorIds),
    enabled: competitorIds.length > 0,
  });
}

export function useSaveFinish() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (finish: Finish) => finishRepo.save(finish),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(saved.raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}

export function useSaveFinishes() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (finishes: Finish[]) => finishRepo.saveMany(finishes),
    onSuccess: (_void, finishes) => {
      const raceIds = new Set(finishes.map((f) => f.raceId));
      for (const raceId of raceIds) {
        qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}

export function useDeleteFinish() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; raceId: string }) => finishRepo.delete(id),
    onSuccess: (_void, { raceId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}

export function useDeleteFinishesByRace() {
  const { finishRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (raceId: string) => finishRepo.deleteByRace(raceId),
    onSuccess: (_void, raceId) => {
      qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      qc.invalidateQueries({ queryKey: queryKeys.finishes.all });
    },
  });
}
