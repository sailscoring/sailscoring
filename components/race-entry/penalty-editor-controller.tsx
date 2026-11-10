'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';

import {
  PenaltyEditorDialog,
  type PenaltyDraft,
} from '@/components/penalty-editor-dialog';
import type { deriveFinishState } from '@/lib/finish-entry';
import { highPointOf } from '@/lib/high-point';
import { raceFleetSizes } from '@/lib/high-point-race';
import { seriesCodeTable } from '@/lib/scoring-codes';
import type { Competitor, Finish, Fleet, Series, SeriesScoringCode } from '@/lib/types';

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
  /** The series' own scoring codes, offered beside the RRS penalties. */
  seriesCodes?: readonly SeriesScoringCode[];
  /** The series, for how it scores: in high point a penalty takes points
   *  away, a percentage as a share of the boats in the race. */
  series?: Series;
  /** The boats in this race, in the fleets they sail it in. */
  raceCompetitors?: readonly Competitor[];
  /** The race's weighting. */
  raceWeight?: number;
}>(function PenaltyEditorController(
  { finishByCompetitorId, finisherPenalties, competitorMap, fleets, patchCache, saveFinish, raceFinishes, seriesCodes, series, raceCompetitors, raceWeight },
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
      penaltyInPoints: draft.inPoints || undefined,
      penaltyLabel: draft.label ?? undefined,
    };
    patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
    saveFinish.mutate(next);
    setEditingPenaltyEntryId(null);
  }

  const highPoint = series ? highPointOf(series) : undefined;
  // High point: the boats in the race in each fleet the boat sails it in.
  const fleetSizes = (() => {
    if (!highPoint || !series || !editingPenaltyEntryId) return [];
    const boat = (raceCompetitors ?? []).find((c) => c.id === editingPenaltyEntryId) ?? competitorMap.get(editingPenaltyEntryId);
    if (!boat) return [];
    return raceFleetSizes(fleets, raceCompetitors ?? [], raceFinishes ?? [], seriesCodeTable(series))
      .filter((e) => (e.fleet ? boat.fleetIds.includes(e.fleet.id) : !boat.fleetIds.some((id) => fleets.some((f) => f.id === id))))
      .map((e) => ({ name: e.fleet?.name ?? '', fleetSize: e.fleetSize }));
  })();

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
      seriesCodes={seriesCodes}
      highPoint={highPoint}
      raceFleetSizes={fleetSizes}
      raceWeight={raceWeight}
    />
  );
});
