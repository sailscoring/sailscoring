'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listPendingSeriesSubmissions,
  listRaceSubmissions,
  listRacesBetween,
  reviewFinishSubmission,
  submitFinishSheet,
  withdrawFinishSubmission,
} from '@/lib/api-repository';
import type { SubmitFinishesInput } from '@/lib/validation/finish-submission';

import { queryKeys } from './query-keys';

/**
 * Finish sheet submissions (#671). Submissions arrive from outside this
 * browser — a recorder's phone, a race-day app — so the scorer's views poll
 * rather than waiting for a write here to invalidate them.
 */
const POLL_MS = 30_000;

export function useRaceSubmissions(raceId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.finishSubmissions.byRace(raceId),
    queryFn: () => listRaceSubmissions(raceId),
    enabled: opts.enabled,
    refetchInterval: POLL_MS,
  });
}

export function usePendingSeriesSubmissions(seriesId: string, opts: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.finishSubmissions.pendingBySeries(seriesId),
    queryFn: () => listPendingSeriesSubmissions(seriesId),
    enabled: opts.enabled,
    refetchInterval: POLL_MS,
  });
}

/** The races dated `from` to `to` across the workspace's live series. */
export function useRacesBetween(from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.datedRaces.between(from, to),
    queryFn: () => listRacesBetween(from, to),
  });
}

export function useSubmitFinishSheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { raceId: string; submissionId: string; input: SubmitFinishesInput }) =>
      submitFinishSheet(args.raceId, args.submissionId, args.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.finishSubmissions.all }),
  });
}

export function useWithdrawFinishSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { raceId: string; submissionId: string }) =>
      withdrawFinishSubmission(args.raceId, args.submissionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.finishSubmissions.all }),
  });
}

export function useReviewFinishSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { raceId: string; submissionId: string; status: 'applied' | 'dismissed'; revision: number }) =>
      reviewFinishSubmission(args.raceId, args.submissionId, { status: args.status, revision: args.revision }),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.finishSubmissions.all }),
  });
}
