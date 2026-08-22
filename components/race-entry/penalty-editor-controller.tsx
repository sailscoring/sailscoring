'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import {
  PenaltyEditorDialog,
  type PenaltyDraft,
} from '@/components/penalty-editor-dialog';
import type { deriveFinishState } from '@/lib/finish-entry';
import type { Competitor, Finish, Fleet } from '@/lib/types';

export interface PenaltyEditorHandle {
  /** Open the penalty editor for one finisher. */
  open: (competitorId: string) => void;
}

/**
 * Owns the penalty-editor dialog: which row is being edited and the
 * apply-penalty write. Opened imperatively from the finish tab's row
 * buttons via the ref handle.
 */
export const PenaltyEditorController = forwardRef<PenaltyEditorHandle, {
  finishByCompetitorId: ReturnType<typeof deriveFinishState>['finishByCompetitorId'];
  finisherPenalties: ReturnType<typeof deriveFinishState>['finisherPenalties'];
  competitorMap: Map<string, Competitor>;
  fleets: Fleet[];
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  saveFinish: { mutate: (f: Finish) => unknown };
  /** This race's finishes, for the labels-used-already suggestions.
   *  Deliberately race-scoped rather than series-scoped: the series-wide
   *  finishes query is never invalidated on save (see `useSaveFinish`), so the
   *  standings page depends on mounting it fresh. Mounting it here would hand
   *  that page a cache from before any result was entered. */
  raceFinishes?: Finish[];
}>(function PenaltyEditorController(
  { finishByCompetitorId, finisherPenalties, competitorMap, fleets, patchCache, saveFinish, raceFinishes },
  ref,
) {
  // competitorId of the row being edited, or null.
  const [editingPenaltyEntryId, setEditingPenaltyEntryId] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ open: setEditingPenaltyEntryId }));

  function applyPenalty(draft: PenaltyDraft) {
    if (!editingPenaltyEntryId) return;
    const finish = finishByCompetitorId.get(editingPenaltyEntryId);
    if (!finish) {
      setEditingPenaltyEntryId(null);
      return;
    }
    const next: Finish = {
      ...finish,
      penaltyCode: draft.code,
      penaltyOverride: draft.override,
      penaltyOverrideByFleet: draft.overrideByFleet ?? undefined,
      penaltyLabel: draft.label ?? undefined,
    };
    patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
    saveFinish.mutate(next);
    setEditingPenaltyEntryId(null);
  }

  return (
    <PenaltyEditorDialog
      competitor={
        editingPenaltyEntryId
          ? { id: editingPenaltyEntryId, sailNumber: competitorMap.get(editingPenaltyEntryId)?.sailNumber ?? '' }
          : null
      }
      initialPenalty={editingPenaltyEntryId ? finisherPenalties.get(editingPenaltyEntryId) ?? null : null}
      competitorFleets={(() => {
        const c = editingPenaltyEntryId ? competitorMap.get(editingPenaltyEntryId) : undefined;
        if (!c) return [];
        return fleets
          .filter((f) => c.fleetIds.includes(f.id))
          .map((f) => ({ id: f.id, name: f.name }));
      })()}
      knownLabels={[
        ...new Set(
          (raceFinishes ?? [])
            .map((f) => f.penaltyLabel?.trim())
            .filter((l): l is string => !!l),
        ),
      ].sort()}
      onApply={applyPenalty}
      onCancel={() => setEditingPenaltyEntryId(null)}
    />
  );
});
