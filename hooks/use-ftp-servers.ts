'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ftpServerRepo } from '@/lib/api-repository';
import type { FtpServer } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useVersionedSave } from './use-versioned-save';

/** The workspace's FTP servers. The rows carry credentials, so reading them
 *  needs manage-workspace: pass `enabled: false` for anyone else rather than
 *  have the read refused. */
export function useFtpServers(opts?: { enabled?: boolean }) {
  return useQuery<FtpServer[]>({
    queryKey: queryKeys.ftpServers.list(),
    queryFn: () => ftpServerRepo.list(),
    enabled: opts?.enabled ?? true,
  });
}

export function useSaveFtpServer() {
  return useVersionedSave<FtpServer>({
    listKey: () => queryKeys.ftpServers.list(),
    save: (server, opts) => ftpServerRepo.save(server, opts),
    scopeId: 'ftp-servers',
  });
}

export function useDeleteFtpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ftpServerRepo.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.ftpServers.list() });
    },
  });
}
