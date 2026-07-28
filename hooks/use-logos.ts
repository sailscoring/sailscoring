'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  logoRepo,
  type LogoMetaPatch,
  type LogoUpload,
} from '@/lib/api-repository';
import type { Logo, LogoDefaults } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useLogos(enabled = true) {
  return useQuery<Logo[]>({
    queryKey: queryKeys.logos.list(),
    queryFn: () => logoRepo.list(),
    enabled,
  });
}

export function useCreateLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (upload: LogoUpload) => logoRepo.create(upload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.logos.list() });
    },
  });
}

export function useUpdateLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LogoMetaPatch }) =>
      logoRepo.updateMeta(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.logos.list() });
    },
  });
}

export function useDeleteLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => logoRepo.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.logos.list() });
    },
  });
}

/** Logos of another workspace the caller belongs to (the copy picker). */
export function useLogosFrom(workspaceId: string | null, enabled = true) {
  return useQuery<Logo[]>({
    queryKey: queryKeys.logos.listFrom(workspaceId ?? ''),
    queryFn: () => logoRepo.listFrom(workspaceId as string),
    enabled: enabled && !!workspaceId,
  });
}

export function useCopyLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceWorkspaceId,
      sourceLogoId,
    }: {
      sourceWorkspaceId: string;
      sourceLogoId: string;
    }) => logoRepo.copyFrom(sourceWorkspaceId, sourceLogoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.logos.list() });
    },
  });
}

export function useLogoDefaults(enabled = true) {
  return useQuery<LogoDefaults>({
    queryKey: queryKeys.logos.defaults(),
    queryFn: () => logoRepo.getDefaults(),
    enabled,
  });
}

/**
 * Both defaults are written as one document, so the caller builds its payload
 * from the currently-cached pair and replaces one slot. Picking the venue and
 * then the event default in quick succession therefore has two hazards: the
 * second pick reading the pre-mutation cache (and re-sending the empty venue
 * slot it just filled), and the two PUTs landing out of order. `onMutate`
 * closes the first by publishing the new pair before the request goes out;
 * the mutation scope closes the second by serialising the PUTs.
 */
export function useSetLogoDefaults() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: 'logo-defaults' },
    mutationFn: (defaults: LogoDefaults) => logoRepo.setDefaults(defaults),
    onMutate: async (defaults) => {
      await qc.cancelQueries({ queryKey: queryKeys.logos.defaults() });
      const previous = qc.getQueryData<LogoDefaults>(queryKeys.logos.defaults());
      qc.setQueryData(queryKeys.logos.defaults(), defaults);
      return { previous };
    },
    onError: (_err, _defaults, context) => {
      if (context) qc.setQueryData(queryKeys.logos.defaults(), context.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.logos.defaults(), data);
    },
  });
}

/** Set the active workspace's own logo. The current value comes from the
 *  server-rendered memberships, so callers `router.refresh()` after success to
 *  reflect it in the header/switcher. */
export function useSetWorkspaceLogo() {
  return useMutation({
    mutationFn: (logo: string) => logoRepo.setWorkspaceLogo(logo),
  });
}
