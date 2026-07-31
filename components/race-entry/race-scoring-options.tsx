'use client';

import { Pencil } from 'lucide-react';

import {
  RaceScoringOptionsDialog,
  type RaceScoringOptions as RaceScoringOptionsValue,
} from '@/components/race-scoring-options-dialog';
import { hasScoringOptions, scoringOptionsSummary } from '@/lib/race-scoring-options';
import type { Race } from '@/lib/types';

/**
 * The race header's scoring-options line: a summary of how much this race
 * counts, opening the dialog that sets it. Read-only series show the summary
 * as plain text, and nothing at all when the race is ordinary — there is no
 * point telling a reader that a race counts once.
 *
 * Open state is controlled by the page, which also binds the keyboard
 * shortcut.
 */
export function RaceScoringOptions({
  race,
  readOnly,
  open,
  onOpenChange,
  onSave,
}: {
  race: Pick<Race, 'raceNumber' | 'name' | 'discardPolicy' | 'pointsMultiplier'>;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (options: RaceScoringOptionsValue) => Promise<void>;
}) {
  const summary = scoringOptionsSummary(race);

  if (readOnly) {
    return hasScoringOptions(race) ? (
      <p className="text-sm text-muted-foreground">Scoring: {summary}</p>
    ) : null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        aria-label={`Scoring options for Race ${race.raceNumber}`}
        data-testid="race-scoring-options"
      >
        <span>Scoring: {summary || 'standard'}</span>
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <RaceScoringOptionsDialog
        race={race}
        open={open}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    </>
  );
}
