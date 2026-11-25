'use client';

import { useState } from 'react';

import { OrcOptionRows, useOrcChoice } from '@/components/orc-option-picker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OrcOptionChoice } from '@/lib/orc-option-choices';

/**
 * A fleet's default ORC scoring option, chosen in the same rows as a race
 * start's: how the rating is applied, the course, how many numbers, and the
 * band. Offered as one list, the Irish options alone run to some ninety
 * names, each with a time-on-distance twin, and a wrong pick here scores
 * every start that doesn't name its own.
 *
 * Mounted only while open, so the rows start from the fleet's current option
 * each time.
 */
export function FleetOrcOptionDialog({
  fleetName,
  choices,
  option,
  onClose,
  onSave,
}: {
  fleetName: string;
  choices: ReadonlyArray<OrcOptionChoice>;
  /** The fleet's current option. */
  option: string;
  onClose: () => void;
  onSave: (option: string) => void;
}) {
  const [chosen, setChosen] = useState(option);
  const [error, setError] = useState('');
  const { selection, choose, pending } = useOrcChoice(choices, option, (next) => {
    setChosen(next);
    setError('');
  });

  function save() {
    if (pending || !chosen) {
      setError(`Choose ${pending ?? 'the scoring option'} for this fleet’s scoring option.`);
      return;
    }
    onSave(chosen);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Scoring option for {fleetName}</DialogTitle>
          <DialogDescription>
            The option the fleet&apos;s races are scored on, unless a race start
            names its own.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <OrcOptionRows
            choices={choices}
            selection={selection}
            onChoose={choose}
            testIdPrefix="fleet-orc"
          />
          {pending && !error && (
            <p className="text-xs text-amber-600 dark:text-amber-500">Choose {pending} for this fleet.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
