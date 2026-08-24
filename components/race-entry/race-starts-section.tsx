'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  RaceStartDialog,
  type RaceStartDialogMode,
  type RaceStartDraft,
} from '@/components/race-start-dialog';
import { useDeleteRaceStart, useSaveRaceStart } from '@/hooks/use-race-starts';
import type { Competitor, Fleet, RaceStart } from '@/lib/types';

export interface RaceStartsSectionHandle {
  /** Expand the section and open the add-start dialog (the `s` shortcut). */
  openAddStart: () => void;
}

/**
 * The expandable race-starts card on the result-entry page (handicap series
 * only): collapsed summary, expanded edit list, and the add/edit dialog.
 * Owns its expansion + dialog state and the start mutations.
 *
 * Mount this unconditionally and gate the card with `visible`: the dialog
 * must outlive the card so the `s` shortcut still works from other tabs
 * (the card is finish-tab-only, the dialog never was).
 */
export const RaceStartsSection = forwardRef<RaceStartsSectionHandle, {
  raceId: string;
  raceStarts: RaceStart[];
  fleets: Fleet[];
  fleetById: Map<string, Fleet>;
  /** The series' competitors — the ORC wind-band picker derives its options
   *  from the stored certificates. */
  competitors?: Competitor[];
  /** Whether to render the card itself (finish tab of a handicap series). */
  visible: boolean;
}>(function RaceStartsSection({ raceId, raceStarts, fleets, fleetById, competitors, visible }, ref) {
  const saveRaceStart = useSaveRaceStart();
  const deleteRaceStartMutation = useDeleteRaceStart();
  const [startsExpanded, setStartsExpanded] = useState(false);
  const [startDialogMode, setStartDialogMode] = useState<RaceStartDialogMode | null>(null);

  function openAddStart() {
    setStartsExpanded(true);
    setStartDialogMode({ kind: 'add' });
  }

  useImperativeHandle(ref, () => ({ openAddStart }));

  // Timed starts first (by gun time), then membership-only starts with no time.
  const sortedStarts = [...raceStarts].sort((a, b) =>
    (a.startTime ?? '~').localeCompare(b.startTime ?? '~'),
  );

  function openEditStart(s: RaceStart) {
    setStartDialogMode({ kind: 'edit', start: s });
  }

  async function handleSaveStart(draft: RaceStartDraft) {
    const raceStart: RaceStart = {
      id: draft.editingId ?? crypto.randomUUID(),
      raceId,
      fleetIds: draft.fleetIds,
      startTime: draft.startTime,
      ...(draft.distanceNm != null ? { distanceNm: draft.distanceNm } : {}),
      ...(draft.orcScoringWind != null ? { orcScoringWind: draft.orcScoringWind } : {}),
      ...(draft.courseLegs?.length ? { courseLegs: draft.courseLegs } : {}),
      ...(draft.orcOption ? { orcOption: draft.orcOption } : {}),
    };
    await saveRaceStart.mutateAsync(raceStart);
    setStartDialogMode(null);
  }

  async function handleDeleteStart(id: string) {
    await deleteRaceStartMutation.mutateAsync({ id, raceId });
  }

  return (
    <>
      {visible && (
      <div className="bg-card border rounded-lg px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Race starts</h3>
          {!startsExpanded ? (
            <Button variant="ghost" size="sm" onClick={() => setStartsExpanded(true)}>
              Edit ▸
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={openAddStart}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add start
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStartsExpanded(false)}>
                Done
              </Button>
            </div>
          )}
        </div>
        {!startsExpanded ? (
          raceStarts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No starts recorded — all fleets are in this race.</p>
          ) : (
            <div className="space-y-1">
              {sortedStarts.map((s) => (
                <p key={s.id} className="text-sm text-muted-foreground">
                  <span className={s.startTime ? 'font-mono' : 'italic'}>
                    {s.startTime ?? 'No gun time'}
                  </span>
                  {s.distanceNm != null && (
                    <span className="font-mono"> · {s.distanceNm.toFixed(2)} NM</span>
                  )}
                  {' — '}
                  {s.fleetIds.map((id) => fleetById.get(id)?.name ?? id).join(', ')}
                </p>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-1">
            {raceStarts.length === 0 && (
              <p className="text-sm text-muted-foreground">No starts recorded — all fleets are in this race. Press <kbd className="px-1 py-0.5 text-xs border rounded">s</kbd> or click Add start to scope it to specific fleets.</p>
            )}
            {sortedStarts.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-sm px-3 py-2 border rounded-md">
                <span className={s.startTime ? 'font-mono font-medium' : 'italic text-muted-foreground'}>
                  {s.startTime ?? 'No gun time'}
                </span>
                {(s.distanceNm != null || s.courseLegs?.length) && (
                  <span className="font-mono text-muted-foreground">
                    {(s.courseLegs?.length
                      ? s.courseLegs.reduce((sum, leg) => sum + leg.distanceNm, 0)
                      : s.distanceNm!
                    ).toFixed(2)} NM
                    {s.courseLegs?.length ? ` · ${s.courseLegs.length} legs` : ''}
                  </span>
                )}
                <span className="text-muted-foreground">—</span>
                <span className="flex-1">{s.fleetIds.map((id) => fleetById.get(id)?.name ?? id).join(', ')}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Edit start" onClick={() => openEditStart(s)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Delete start" onClick={() => handleDeleteStart(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      <RaceStartDialog
        mode={startDialogMode}
        raceStarts={raceStarts}
        fleets={fleets}
        competitors={competitors}
        onSave={handleSaveStart}
        onCancel={() => setStartDialogMode(null)}
      />
    </>
  );
});
