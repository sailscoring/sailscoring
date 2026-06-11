'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import {
  PenaltyEditorDialog,
  type PenaltyDraft,
} from '@/components/penalty-editor-dialog';
import type { deriveFinishState } from '@/lib/finish-entry';
import type { Competitor, Finish, PenaltyCode } from '@/lib/types';

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
  finisherPenalties: Map<string, { code: PenaltyCode; override: number | null }>;
  competitorMap: Map<string, Competitor>;
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  saveFinish: { mutate: (f: Finish) => unknown };
}>(function PenaltyEditorController(
  { finishByCompetitorId, finisherPenalties, competitorMap, patchCache, saveFinish },
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
      onApply={applyPenalty}
      onCancel={() => setEditingPenaltyEntryId(null)}
    />
  );
});
