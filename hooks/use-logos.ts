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

export function useSetLogoDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (defaults: LogoDefaults) => logoRepo.setDefaults(defaults),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.logos.defaults(), data);
    },
  });
}
