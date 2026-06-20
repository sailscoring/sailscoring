'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import { RedressDialog } from '@/components/redress-dialog';
import {
  makeFinish,
  type FinishEntry,
  type RedressEntry,
} from '@/lib/finish-entry';
import type { Competitor, Finish, Fleet, Race, ResultCode } from '@/lib/types';

export interface RedressControllerHandle {
  /** Open the redress dialog for a finisher or non-finisher. */
  open: (competitorId: string, isFinisher: boolean) => void;
}

/**
 * Owns the redress (RDG) dialog: which competitor it targets, and the
 * apply / remove writes. Opened imperatively from the finish tab via the
 * ref handle.
 */
export const RedressController = forwardRef<RedressControllerHandle, {
  raceId: string;
  raceNumber: number | undefined;
  finishingOrder: FinishEntry[];
  redressEntries: Map<string, RedressEntry>;
  finishByCompetitorId: Map<string, Finish>;
  competitorMap: Map<string, Competitor>;
  availableRaces: Race[];
  fleets: Fleet[];
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  saveFinish: { mutate: (f: Finish) => unknown };
  deleteFinish: { mutate: (input: { id: string; raceId: string }) => unknown };
}>(function RedressController(
  {
    raceId, raceNumber, finishingOrder, redressEntries, finishByCompetitorId,
    competitorMap, availableRaces, fleets, patchCache, saveFinish, deleteFinish,
  },
  ref,
) {
  const [redressDialog, setRedressDialog] = useState<{ competitorId: string; isFinisher: boolean } | null>(null);

  useImperativeHandle(ref, () => ({
    open: (competitorId, isFinisher) => setRedressDialog({ competitorId, isFinisher }),
  }));

  function applyRedress(entry: RedressEntry) {
    if (!redressDialog) return;
    const { competitorId } = redressDialog;
    const redressFields: Partial<Finish> = {
      redressMethod: entry.method,
      redressExcludeRaceIds: entry.poolMode === 'exclude' ? entry.excludeRaceIds : null,
      redressIncludeRaceIds: entry.poolMode === 'include' ? entry.includeRaceIds : null,
      redressIncludeAllLater: entry.poolMode === 'include' ? entry.includeAllLater : false,
      redressPoints: entry.method === 'stated' ? entry.statedPoints : null,
      redressPointsByFleet: entry.method === 'stated' ? (entry.statedPointsByFleet ?? undefined) : undefined,
    };
    const existing = finishByCompetitorId.get(competitorId);
    let next: Finish;
    if (existing) {
      // RDG marks redress in both the engine and the derived view-model,
      // for finishers and non-finishers alike. The finisher row keeps its
      // sortOrder; the scoring engine treats the row as RDG (replaces points
      // with the A9 average) but the display still shows the position.
      next = {
        ...existing,
        ...redressFields,
        resultCode: 'RDG' as ResultCode,
      };
    } else {
      next = makeFinish(raceId, {
        id: crypto.randomUUID(),
        competitorId,
        sortOrder: null,
        resultCode: 'RDG',
        ...redressFields,
      });
    }
    patchCache((rows) => existing
      ? rows.map((r) => (r.id === existing.id ? next : r))
      : [...rows, next]);
    saveFinish.mutate(next);
    setRedressDialog(null);
  }

  function removeRedress() {
    if (!redressDialog) return;
    const { competitorId, isFinisher } = redressDialog;
    const existing = finishByCompetitorId.get(competitorId);
    if (!existing) {
      setRedressDialog(null);
      return;
    }
    if (isFinisher) {
      // Clear redress fields, keep the finisher row.
      const next: Finish = {
        ...existing,
        resultCode: null,
        redressMethod: null,
        redressExcludeRaceIds: null,
        redressIncludeRaceIds: null,
        redressIncludeAllLater: false,
        redressPoints: null,
        redressPointsByFleet: undefined,
      };
      patchCache((rows) => rows.map((r) => (r.id === existing.id ? next : r)));
      saveFinish.mutate(next);
    } else {
      // Non-finisher RDG → revert to implicit DNC: drop the row entirely.
      patchCache((rows) => rows.filter((r) => r.id !== existing.id));
      deleteFinish.mutate({ id: existing.id, raceId });
    }
    setRedressDialog(null);
  }

  return (
    <RedressDialog
      competitor={
        redressDialog
          ? { id: redressDialog.competitorId, sailNumber: competitorMap.get(redressDialog.competitorId)?.sailNumber ?? '' }
          : null
      }
      currentFinishPosition={(() => {
        if (!redressDialog?.isFinisher) return null;
        const idx = finishingOrder.findIndex(
          (e) => e.kind === 'known' && e.competitorId === redressDialog.competitorId,
        );
        return idx >= 0 ? idx + 1 : null;
      })()}
      seedEntry={redressDialog ? redressEntries.get(redressDialog.competitorId) ?? null : null}
      currentRaceNumber={raceNumber}
      availableRaces={availableRaces}
      competitorFleets={(() => {
        const c = redressDialog ? competitorMap.get(redressDialog.competitorId) : undefined;
        if (!c) return [];
        return fleets
          .filter((f) => c.fleetIds.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name }));
      })()}
      canRemove={redressDialog ? redressEntries.has(redressDialog.competitorId) : false}
      onApply={applyRedress}
      onRemove={removeRedress}
      onCancel={() => setRedressDialog(null)}
    />
  );
});
