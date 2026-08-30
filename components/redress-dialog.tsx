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

/** One race as the include/exclude pickers offer it. */
export interface RedressRaceOption {
  id: string;
  /** The label the scorer knows: the stage race and fleet on a split-fleet
   *  series ("Q6 Gold"), the race name or number otherwise. */
  label: string;
  /** False when this boat was not in the race (none of her fleets had a
   *  start in it). Her own races are the pool an A9 average defends; the
   *  rest are offered apart and marked. */
  sailed: boolean;
}

export interface RedressDialogProps {
  /** When non-null, the dialog is open. */
  competitor: { id: string; sailNumber: string } | null;
  /** Optional finish position to display in the title ("Finish position N is kept."). */
  currentFinishPosition: number | null;
  /** Existing redress for this competitor, if any. Seeds the form. */
  seedEntry: RedressEntry | null;
  /** Label of the current race; used in the "races before …" label. */
  currentRaceLabel: string | undefined;
  /** All races in the series, in sailed order, for the include/exclude
   *  pickers. */
  availableRaces: RedressRaceOption[];
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
  excludeRaceIds: [],
  includeRaceIds: [],
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

/** The pickers' button row: the boat's own races, then — only when the pool
 *  already holds one, or the scorer asks — the races she was not in, marked.
 *  A race outside her own goes into the average with whatever score the
 *  engine holds for her there, so the second group is off the path unless
 *  the jury's decision really names one. */
function RacePickerButtons({
  races,
  selectedIds,
  onToggle,
}: {
  races: RedressRaceOption[];
  selectedIds: string[];
  onToggle: (raceId: string) => void;
}) {
  const unsailed = races.filter((r) => !r.sailed);
  const [showUnsailed, setShowUnsailed] = useState(
    unsailed.some((r) => selectedIds.includes(r.id)),
  );
  const button = (r: RedressRaceOption) => {
    const selected = selectedIds.includes(r.id);
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => onToggle(r.id)}
        className={cn(
          'text-xs px-2 py-0.5 rounded border transition-colors',
          selected
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background hover:bg-accent border-input',
          !r.sailed && !selected && 'text-muted-foreground border-dashed',
        )}
        title={r.sailed ? undefined : 'This boat was not in this race'}
      >
        {r.label}
      </button>
    );
  };
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {races.filter((r) => r.sailed).map(button)}
      </div>
      {unsailed.length > 0 && !showUnsailed && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => setShowUnsailed(true)}
        >
          Show {unsailed.length} race{unsailed.length === 1 ? '' : 's'} this boat was not in
        </button>
      )}
      {unsailed.length > 0 && showUnsailed && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Not sailed by this boat — the boat has no score of her own in these:
          </p>
          <div className="flex flex-wrap gap-1">{unsailed.map(button)}</div>
        </div>
      )}
    </>
  );
}

function RedressDialogInner({
  competitor,
  currentFinishPosition,
  seedEntry,
  currentRaceLabel,
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
                { value: 'races_before', label: `A9(b) — average of races before ${currentRaceLabel ?? 'this race'}` },
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
                  <RacePickerButtons
                    races={availableRaces}
                    selectedIds={entry.excludeRaceIds}
                    onToggle={(raceId) => setEntry((d) => ({
                      ...d,
                      excludeRaceIds: d.excludeRaceIds.includes(raceId)
                        ? d.excludeRaceIds.filter((id) => id !== raceId)
                        : [...d.excludeRaceIds, raceId],
                    }))}
                  />
                </div>
              )}

              {entry.poolMode === 'include' && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Races to include:</p>
                  <RacePickerButtons
                    races={availableRaces}
                    selectedIds={entry.includeRaceIds}
                    onToggle={(raceId) => setEntry((d) => ({
                      ...d,
                      includeRaceIds: d.includeRaceIds.includes(raceId)
                        ? d.includeRaceIds.filter((id) => id !== raceId)
                        : [...d.includeRaceIds, raceId],
                    }))}
                  />
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
