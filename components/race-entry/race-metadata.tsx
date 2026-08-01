'use client';

import { Pencil } from 'lucide-react';

import {
  RaceMetadataDialog,
  type RaceMetadataValue,
} from '@/components/race-metadata-dialog';
import { formatConditions, hasConditions } from '@/lib/race-conditions';
import { formatOfficials, hasOfficials } from '@/lib/race-officials';
import type { Race } from '@/lib/types';

/**
 * The race header's record line: what the race was sailed in and who ran it,
 * opening the dialog that sets them.
 *
 * This sits in the header rather than only on the Races tab because the
 * recording team has the numbers at result entry — which is where HalSail
 * prompts for them too.
 *
 * Read-only series show the summary as plain text, and nothing at all when
 * nothing was recorded; there is no point telling a reader that a race has no
 * wind on file.
 */
export function RaceMetadata({
  race,
  readOnly,
  open,
  onOpenChange,
  onSave,
}: {
  race: Pick<Race, 'raceNumber' | 'name' | 'conditions' | 'officials'>;
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: RaceMetadataValue) => Promise<void>;
}) {
  const summary = raceRecordSummary(race);

  if (readOnly) {
    return summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="group flex items-center gap-1 text-left text-sm text-muted-foreground hover:text-foreground"
        aria-label={`Race record for Race ${race.raceNumber}`}
        data-testid="race-metadata"
      >
        <span>{summary || 'Race record: not recorded'}</span>
        <Pencil className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      <RaceMetadataDialog
        race={race}
        open={open}
        onOpenChange={onOpenChange}
        onSave={onSave}
      />
    </>
  );
}

/** Conditions and team on one line, each clause omitted when empty. */
function raceRecordSummary(race: Pick<Race, 'conditions' | 'officials'>): string {
  const parts: string[] = [];
  if (hasConditions(race.conditions)) parts.push(formatConditions(race.conditions));
  if (hasOfficials(race.officials)) parts.push(formatOfficials(race.officials));
  return parts.join(' · ');
}
