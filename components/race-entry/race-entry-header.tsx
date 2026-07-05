'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { RaceDateEditor } from './race-date-editor';
import { RaceNameEditor } from './race-name-editor';

/** The result-entry page header: the race switcher, race title, the inline
 *  name + date editors, and the autosave status pill. */
export function RaceEntryHeader({
  race,
  readOnly,
  onSaveName,
  onSaveDate,
  isSaving,
  switcher,
}: {
  race: { name: string | null; date: string; raceNumber: number };
  readOnly: boolean;
  onSaveName: (name: string | null) => Promise<void>;
  onSaveDate: (date: string) => Promise<void>;
  isSaving: boolean;
  /** The race-to-race switcher (prev/next + dropdown); omitted for a
   *  single-race series. Rendered above the title. */
  switcher?: ReactNode;
}) {
  // Status pill: any in-flight save / delete / reorder reads "Saving…",
  // otherwise "All changes saved." Phase 7 will swap the otherwise-static
  // "saved" text for richer collaboration affordances; chunk-5's row-conflict
  // dialog will surface 409s alongside this pill.
  const statusLabel = isSaving ? 'Saving…' : 'All changes saved';

  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        {/* Multi-race series get the switcher as their heading; a single-race
            series falls back to a plain title. */}
        {switcher ?? (
          <h2 className="text-lg font-semibold">Race {race.raceNumber} — results</h2>
        )}
        <RaceNameEditor race={race} readOnly={readOnly} onSave={onSaveName} />
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
