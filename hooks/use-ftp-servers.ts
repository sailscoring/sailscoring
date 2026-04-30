'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRepos } from '@/lib/repos';
import type { FtpServer } from '@/lib/types';

import { queryKeys } from './query-keys';

export function useFtpServers() {
  const { ftpServerRepo } = useRepos();
  return useQuery<FtpServer[]>({
    queryKey: queryKeys.ftpServers.list(),
    queryFn: () => ftpServerRepo.list(),
  });
}

export function useSaveFtpServer() {
  const { ftpServerRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (server: FtpServer) => ftpServerRepo.save(server),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ftpServers.list() });
    },
  });
}

export function useDeleteFtpServer() {
  const { ftpServerRepo } = useRepos();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ftpServerRepo.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ftpServers.list() });
    },
  });
}
