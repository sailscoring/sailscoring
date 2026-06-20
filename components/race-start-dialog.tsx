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
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Fleet, RaceStart } from '@/lib/types';

export type RaceStartDialogMode =
  | { kind: 'add' }
  | { kind: 'edit'; start: RaceStart };

export interface RaceStartDraft {
  editingId: string | null;
  startTime?: string;  // omitted for a membership-only start (fleets, no gun time)
  fleetIds: string[];
}

export interface RaceStartDialogProps {
  /** When non-null, the dialog is open. */
  mode: RaceStartDialogMode | null;
  raceStarts: RaceStart[];
  fleets: Fleet[];
  onSave: (draft: RaceStartDraft) => void | Promise<void>;
  onCancel: () => void;
}

export function RaceStartDialog(props: RaceStartDialogProps) {
  // Remount per open so form state is fresh; no seed effect needed.
  if (!props.mode) return null;
  return (
    <RaceStartDialogInner
      key={props.mode.kind === 'edit' ? props.mode.start.id : 'add'}
      {...props}
      mode={props.mode}
    />
  );
}

function RaceStartDialogInner({
  mode,
  raceStarts,
  fleets,
  onSave,
  onCancel,
}: RaceStartDialogProps & { mode: RaceStartDialogMode }) {
  const seed = mode.kind === 'edit' ? mode.start : null;
  const [startTimeInput, setStartTimeInput] = useState(seed?.startTime ?? '');
  const [fleetIds, setFleetIds] = useState<string[]>(seed?.fleetIds ?? []);
  const [error, setError] = useState('');

  function handleSave() {
    // A blank time is allowed: a membership-only start declares which fleets
    // are in the race (scoping #226) without a gun time. A non-blank time must
    // still parse.
    let normalizedStart: string | undefined;
    if (startTimeInput.trim()) {
      const parsed = normalizeTimeInput(startTimeInput);
      if (!parsed) {
        setError('Enter a valid time, e.g. 14:05:00 or 140500 — or leave blank for fleets only.');
        return;
      }
      normalizedStart = parsed;
    }
    if (fleetIds.length === 0) {
      setError('Select at least one fleet.');
      return;
    }
    const editingId = mode.kind === 'edit' ? mode.start.id : null;
    const otherStarts = raceStarts.filter((s) => s.id !== editingId);
    const usedFleetIds = new Set(otherStarts.flatMap((s) => s.fleetIds));
    const conflict = fleetIds.find((id) => usedFleetIds.has(id));
    if (conflict) {
      const name = fleets.find((f) => f.id === conflict)?.name ?? conflict;
      setError(`Fleet "${name}" is already in another start group.`);
      return;
    }
    void onSave({ editingId, startTime: normalizedStart, fleetIds });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{mode.kind === 'edit' ? 'Edit start' : 'Add start'}</DialogTitle>
          <DialogDescription>
            Record the gun time for a group of fleets, or leave it blank to just
            declare which fleets are in this race.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Gun time <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
              value={startTimeInput}
              onChange={(e) => { setStartTimeInput(e.target.value); setError(''); }}
              placeholder="14:05:00"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Fleets in this start</label>
            <div className="space-y-1.5">
              {fleets.map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fleetIds.includes(f.id)}
                    onChange={(e) => {
                      setFleetIds((prev) =>
                        e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                      );
                      setError('');
                    }}
                    className="h-4 w-4 rounded border"
                  />
                  {f.name}
                  {f.scoringSystem !== 'scratch' && (
                    <span className="text-xs text-muted-foreground">({f.scoringSystem.toUpperCase()})</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
