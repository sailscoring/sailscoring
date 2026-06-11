'use client';

import { cn } from '@/lib/utils';

import { RaceDateEditor } from './race-date-editor';

/** The result-entry page header: race title, the inline date editor, and
 *  the autosave status pill. */
export function RaceEntryHeader({
  race,
  readOnly,
  onSaveDate,
  isSaving,
}: {
  race: { date: string; raceNumber: number };
  readOnly: boolean;
  onSaveDate: (date: string) => Promise<void>;
  isSaving: boolean;
}) {
  // Status pill: any in-flight save / delete / reorder reads "Saving…",
  // otherwise "All changes saved." Phase 7 will swap the otherwise-static
  // "saved" text for richer collaboration affordances; chunk-5's row-conflict
  // dialog will surface 409s alongside this pill.
  const statusLabel = isSaving ? 'Saving…' : 'All changes saved';

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Race {race.raceNumber} — results</h2>
        <RaceDateEditor race={race} readOnly={readOnly} onSave={onSaveDate} />
      </div>
      <div
        role="status"
        aria-live="polite"
        data-testid="autosave-status"
        className={cn(
          'shrink-0 rounded-full border px-2.5 py-0.5 text-xs',
          isSaving
            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
            : 'border-muted bg-muted/40 text-muted-foreground',
        )}
      >
        {statusLabel}
      </div>
    </div>
  );
}
