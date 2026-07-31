'use client';

import { useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DISCARD_POLICY_HINT,
  DISCARD_POLICY_LABEL,
  weightingPreview,
} from '@/lib/race-scoring-options';
import type { Race, RaceDiscardPolicy } from '@/lib/types';

const POLICIES: RaceDiscardPolicy[] = ['normal', 'mustCount', 'discardFirst'];

export interface RaceScoringOptions {
  discardPolicy: RaceDiscardPolicy;
  pointsMultiplier: number;
}

/**
 * Per-race scoring options (#342): how much this race counts, as a NoR or SI
 * may specify it.
 *
 * The three discard behaviours are a radio rather than two checkboxes because
 * "must count" and "discard first" contradict each other — one control makes
 * that unrepresentable instead of an error the scorer has to meet. The
 * weighting is independent of it: weighting a race up does not imply it must
 * count, and an SI that wants both says both.
 */
export function RaceScoringOptionsDialog({
  race,
  open,
  onOpenChange,
  onSave,
}: {
  race: Pick<Race, 'raceNumber' | 'name' | 'discardPolicy' | 'pointsMultiplier'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (options: RaceScoringOptions) => Promise<void> | void;
}) {
  if (!open) return null;
  return (
    <RaceScoringOptionsDialogInner
      race={race}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  );
}

function RaceScoringOptionsDialogInner({
  race,
  onOpenChange,
  onSave,
}: {
  race: Pick<Race, 'raceNumber' | 'name' | 'discardPolicy' | 'pointsMultiplier'>;
  onOpenChange: (open: boolean) => void;
  onSave: (options: RaceScoringOptions) => Promise<void> | void;
}) {
  const [policy, setPolicy] = useState<RaceDiscardPolicy>(race.discardPolicy ?? 'normal');
  // Held as the typed string so a half-finished "0." or "1." doesn't snap back
  // under the cursor; parsed on save.
  const [multiplierText, setMultiplierText] = useState(String(race.pointsMultiplier ?? 1));
  const [saving, setSaving] = useState(false);

  const parsed = Number(multiplierText.trim());
  const multiplierValid = multiplierText.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 100;

  async function save() {
    if (!multiplierValid) return;
    setSaving(true);
    try {
      await onSave({ discardPolicy: policy, pointsMultiplier: parsed });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const title = race.name
    ? `Race ${race.raceNumber} — ${race.name}`
    : `Race ${race.raceNumber}`;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="race-scoring-options-dialog">
        <DialogHeader>
          <DialogTitle>{title} — scoring options</DialogTitle>
          <DialogDescription>
            How much this race counts. Set these from the NoR or SIs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <span className="text-sm font-medium">Discarding</span>
            <div className="space-y-1.5">
              {POLICIES.map((value) => (
                <label key={value} className="flex items-baseline gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="race-discard-policy"
                    value={value}
                    checked={policy === value}
                    onChange={() => setPolicy(value)}
                  />
                  <span>
                    {DISCARD_POLICY_LABEL[value]}
                    <span className="ml-1.5 text-muted-foreground">
                      {DISCARD_POLICY_HINT[value]}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="race-points-multiplier">
              Weighting
            </label>
            <div className="flex items-center gap-2 text-sm">
              <span>Counts as</span>
              <Input
                id="race-points-multiplier"
                type="text"
                inputMode="decimal"
                className="h-8 w-20"
                value={multiplierText}
                aria-label="Points multiplier"
                aria-invalid={!multiplierValid}
                onChange={(e) => setMultiplierText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
              <span>× a normal race</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {multiplierValid
                ? weightingPreview(parsed)
                : 'Enter a number above 0 — 2 for a trophy race, 0.5 for a lesser one.'}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!multiplierValid || saving}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
