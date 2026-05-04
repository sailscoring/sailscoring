'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ConflictApiError, type ConflictDetail } from '@/lib/api-client';
import type { Competitor, Finish } from '@/lib/types';
import { entryKey, type FinishEntry } from '@/lib/finish-entry';
import { queryKeys } from '@/hooks/query-keys';

interface ConflictState {
  finishId: string;
  rowLabel: string;
  /**
   * The user's intended change. For saves, the Finish payload they tried
   * to write. For deletes, a sentinel — "Keep mine" retries the delete;
   * "Use current" dismisses.
   */
  pendingPayload: Finish | { kind: 'delete' };
  detail?: ConflictDetail;
}

export interface UseFinishConflictDialogArgs {
  raceId: string;
  competitors: Competitor[] | undefined;
  finishingOrder: FinishEntry[];
  saveFinish: { mutateAsync: (f: Finish) => Promise<unknown> };
  deleteFinish: { mutateAsync: (input: { id: string; raceId: string }) => Promise<unknown> };
}

/**
 * Subscribes to mutation 409s scoped to `finishes` and surfaces them in a
 * row-scoped conflict dialog. The global ConflictMutationSubscriber skips
 * these explicitly (see app/providers.tsx). Only one conflict is shown at
 * a time — sequentially-fired mutations queue behind the dialog's
 * resolution.
 */
export function useFinishConflictDialog({
  raceId,
  competitors,
  finishingOrder,
  saveFinish,
  deleteFinish,
}: UseFinishConflictDialogArgs) {
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [retrying, setRetrying] = useState(false);

  /**
   * Build a human-readable label for the conflict dialog: "Row 4 (sail
   * 1234, Alice)" for a finisher; "Sail 1234 (Alice)" for a non-finisher
   * row with a code; "Unknown sail 9999" for unresolved entries.
   */
  function rowLabelForFinish(finish: Finish | undefined, fallbackId: string): string {
    if (!finish) return `Finish ${fallbackId.slice(0, 8)}`;
    if (finish.competitorId === null) {
      return `Unknown sail ${finish.unknownSailNumber ?? '?'}`;
    }
    const competitor = competitors?.find((c) => c.id === finish.competitorId);
    const sail = competitor?.sailNumber ?? '?';
    const name = competitor?.name ?? '';
    if (finish.sortOrder !== null) {
      const idx = finishingOrder.findIndex((e) => entryKey(e) === finish.competitorId);
      const pos = idx >= 0 ? idx + 1 : finish.sortOrder;
      return `Row ${pos} (sail ${sail}${name ? `, ${name}` : ''})`;
    }
    return `Sail ${sail}${name ? ` (${name})` : ''}`;
  }

  useEffect(() => {
    const unsub = qc.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (event.mutation.options.scope?.id !== 'finishes') return;
      const error = event.mutation.state.error;
      if (!(error instanceof ConflictApiError)) return;
      // If we're already showing a dialog for the same row, leave it alone.
      if (conflict !== null) return;
      const variables = event.mutation.state.variables as
        | Finish
        | { id: string; raceId: string };
      if (!variables || typeof variables !== 'object') return;
      let finishId: string;
      let pending: Finish | { kind: 'delete' };
      if ('competitorId' in variables) {
        finishId = (variables as Finish).id;
        pending = variables as Finish;
      } else {
        finishId = (variables as { id: string }).id;
        pending = { kind: 'delete' };
      }
      // Refresh the cache so the dialog shows server truth behind it.
      void qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      const cached = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(raceId));
      const liveRow = cached?.find((r) => r.id === finishId);
      setConflict({
        finishId,
        rowLabel: rowLabelForFinish(liveRow, finishId),
        pendingPayload: pending,
        detail: error.detail,
      });
    });
    return () => unsub();
    // The subscriber closes over `conflict` and `competitors` for label
    // building; recreate on changes so labels stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, raceId, conflict, competitors, finishingOrder]);

  async function resolveKeepMine() {
    if (!conflict) return;
    setRetrying(true);
    try {
      // Refetch to get the fresh version, then retry the user's payload
      // against that baseline.
      await qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      const fresh = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(raceId));
      const current = fresh?.find((r) => r.id === conflict.finishId);
      if ('kind' in conflict.pendingPayload) {
        // Delete retry — fire it again; the row is gone now if it never existed.
        if (current) {
          await deleteFinish.mutateAsync({ id: conflict.finishId, raceId });
        }
      } else {
        const retry: Finish = {
          ...conflict.pendingPayload,
          version: current?.version,
        };
        const key = queryKeys.finishes.byRace(raceId);
        const prev = qc.getQueryData<Finish[]>(key) ?? [];
        qc.setQueryData<Finish[]>(
          key,
          prev.some((r) => r.id === retry.id)
            ? prev.map((r) => (r.id === retry.id ? retry : r))
            : [...prev, retry],
        );
        await saveFinish.mutateAsync(retry);
      }
      setConflict(null);
    } catch {
      // If the retry itself 409s, the subscriber re-opens with fresh detail.
    } finally {
      setRetrying(false);
    }
  }

  function resolveUseCurrent() {
    void qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
    setConflict(null);
  }

  return {
    /** Pass directly to <RowConflictDialog />. */
    dialogProps: {
      info: conflict
        ? {
            finishId: conflict.finishId,
            rowLabel: conflict.rowLabel,
            updatedAt: conflict.detail?.updatedAt,
            actor: conflict.detail?.actor,
          }
        : null,
      retrying,
      onKeepMine: resolveKeepMine,
      onUseCurrent: resolveUseCurrent,
      onDismiss: resolveUseCurrent,
    },
  };
}
