'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PerFleetPoints } from '@/components/per-fleet-points';
import { seedFromFinish, toStorage, type PerFleetPointsValue } from '@/lib/per-fleet-points';
import type { RedressEntry } from '@/lib/finish-entry';

type RedressMethod = RedressEntry['method'];
type RedressPoolMode = RedressEntry['poolMode'];

export interface RedressDialogProps {
  /** When non-null, the dialog is open. */
  competitor: { id: string; sailNumber: string } | null;
  /** Optional finish position to display in the title ("Finish position N is kept."). */
  currentFinishPosition: number | null;
  /** Existing redress for this competitor, if any. Seeds the form. */
  seedEntry: RedressEntry | null;
  /** Race number of the current race; used in the "races before race N" label. */
  currentRaceNumber: number | undefined;
  /** All races in the series, used for the include/exclude pickers. */
  availableRaces: { id: string; raceNumber: number }[];
  /** The fleets this competitor is entered in. More than one enables
   *  per-fleet stated points (RRS A9(c)). */
  competitorFleets: { id: string; name: string }[];
  /** Whether to show the "Remove redress" button. */
  canRemove: boolean;
  onApply: (entry: RedressEntry) => void;
  onRemove: () => void;
  onCancel: () => void;
}

const EMPTY_ENTRY: RedressEntry = {
  method: 'all_races',
  poolMode: 'none',
  excludeRaces: [],
  includeRaces: [],
  includeAllLater: false,
  statedPoints: null,
  statedPointsByFleet: null,
};

export function RedressDialog(props: RedressDialogProps) {
  if (!props.competitor) return null;
  return (
    <RedressDialogInner
      key={props.competitor.id}
      {...props}
      competitor={props.competitor}
    />
  );
}

function RedressDialogInner({
  competitor,
  currentFinishPosition,
  seedEntry,
  currentRaceNumber,
  availableRaces,
  competitorFleets,
  canRemove,
  onApply,
  onRemove,
  onCancel,
}: RedressDialogProps & { competitor: { id: string; sailNumber: string } }) {
  const [entry, setEntry] = useState<RedressEntry>(seedEntry ?? EMPTY_ENTRY);
  const fleetIds = competitorFleets.map((f) => f.id);
  const [stated, setStated] = useState<PerFleetPointsValue>(
    seedFromFinish((seedEntry ?? EMPTY_ENTRY).statedPoints, (seedEntry ?? EMPTY_ENTRY).statedPointsByFleet, fleetIds),
  );

  function apply() {
    if (entry.method === 'stated') {
      const { scalar, byFleet } = toStorage(stated, fleetIds);
      onApply({ ...entry, statedPoints: scalar, statedPointsByFleet: byFleet ?? null });
      return;
    }
    onApply(entry);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Redress (RDG) — {competitor.sailNumber}</DialogTitle>
          <DialogDescription>
            RRS A9: replace score with average from a pool of races.
            {currentFinishPosition !== null && <> Finish position {currentFinishPosition} is kept.</>}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Method (RRS A9)</label>
            <div className="space-y-1.5">
              {([
                { value: 'all_races', label: 'A9(a) — average of all races in the series' },
                { value: 'races_before', label: `A9(b) — average of races before race ${currentRaceNumber ?? ''}` },
                { value: 'stated', label: 'A9(c) — scorer-stated points' },
              ] as { value: RedressMethod; label: string }[]).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="rdg-method"
                    value={value}
                    checked={entry.method === value}
                    onChange={() => setEntry((d) => ({ ...d, method: value }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {entry.method === 'stated' && (
            <PerFleetPoints
              label="Points"
              fleets={competitorFleets}
              value={stated}
              onChange={setStated}
              placeholder="e.g. 3.5"
              autoFocus
              onSubmit={apply}
            />
          )}

          {entry.method !== 'stated' && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Pool restriction</label>
              <div className="space-y-1.5">
                {([
                  { value: 'none', label: 'No restriction' },
                  { value: 'exclude', label: 'Exclude specific races from pool' },
                  { value: 'include', label: 'Include only specific races' },
                ] as { value: RedressPoolMode; label: string }[]).map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="rdg-pool"
                      value={value}
                      checked={entry.poolMode === value}
                      onChange={() => setEntry((d) => ({ ...d, poolMode: value }))}
                    />
                    {label}
                  </label>
                ))}
              </div>

              {entry.poolMode === 'exclude' && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Races to exclude:</p>
                  <div className="flex flex-wrap gap-1">
                    {availableRaces.slice().sort((a, b) => a.raceNumber - b.raceNumber).map((r) => {
                      const selected = entry.excludeRaces.includes(r.raceNumber);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setEntry((d) => ({
                            ...d,
                            excludeRaces: selected
                              ? d.excludeRaces.filter((n) => n !== r.raceNumber)
                              : [...d.excludeRaces, r.raceNumber],
                          }))}
                          className={cn(
                            'text-xs px-2 py-0.5 rounded border transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-accent border-input',
                          )}
                        >
                          R{r.raceNumber}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {entry.poolMode === 'include' && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Races to include:</p>
                  <div className="flex flex-wrap gap-1">
                    {availableRaces.slice().sort((a, b) => a.raceNumber - b.raceNumber).map((r) => {
                      const selected = entry.includeRaces.includes(r.raceNumber);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setEntry((d) => ({
                            ...d,
                            includeRaces: selected
                              ? d.includeRaces.filter((n) => n !== r.raceNumber)
                              : [...d.includeRaces, r.raceNumber],
                          }))}
                          className={cn(
                            'text-xs px-2 py-0.5 rounded border transition-colors',
                            selected
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'bg-background hover:bg-accent border-input',
                          )}
                        >
                          R{r.raceNumber}
                        </button>
                      );
                    })}
                  </div>
                  {entry.method !== 'races_before' && (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={entry.includeAllLater}
                        onChange={(e) => setEntry((d) => ({ ...d, includeAllLater: e.target.checked }))}
                      />
                      Include all later races
                    </label>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={apply}>Apply</Button>
          {canRemove && (
            <Button variant="outline" onClick={onRemove}>Remove redress</Button>
          )}
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
