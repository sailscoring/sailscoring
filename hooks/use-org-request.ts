'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMyOrgRequest, submitOrgRequest } from '@/lib/api-repository';
import type { OrgRequest } from '@/lib/types';

import { queryKeys } from './query-keys';

/** The signed-in user's latest org-creation request (#153), or null. */
export function useMyOrgRequest() {
  return useQuery<OrgRequest | null>({
    queryKey: queryKeys.orgRequest.mine(),
    queryFn: () => getMyOrgRequest(),
  });
}

export function useSubmitOrgRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestedName: string; note?: string }) =>
      submitOrgRequest(input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.orgRequest.mine() }),
  });
}
