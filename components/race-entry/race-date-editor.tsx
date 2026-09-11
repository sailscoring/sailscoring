'use client';

import { Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { useInlineEdit } from '@/hooks/use-inline-edit';

/** Inline editor for a race's date. Renders the date as a subtle button that
 *  swaps to a native date input on click; commits on change/blur, cancels on
 *  Escape. A save that fails keeps the typed date and says so. Read-only
 *  series show plain text. */
export function RaceDateEditor({
  race,
  readOnly,
  onSave,
}: {
  race: { date: string; raceNumber: number };
  readOnly: boolean;
  onSave: (date: string) => Promise<void>;
}) {
  // The edit buffer is kept out of the `race.date` prop so an update
  // underneath us doesn't clobber it, and is held until the save resolves so
  // a failure doesn't silently discard it.
  const { draft, setDraft, begin, cancel, commit, saving, error } = useInlineEdit({
    value: race.date,
    onSave: async (next) => {
      if (next) await onSave(next);
    },
  });

  if (readOnly) {
    return <p className="text-sm text-muted-foreground">{race.date || '—'}</p>;
  }

  if (draft !== null) {
    return (
      <div>
        <Input
          type="date"
          autoFocus
          value={draft}
          disabled={saving}
          aria-invalid={error !== null}
          aria-label={`Date for Race ${race.raceNumber}`}
          className="h-7 w-auto text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
        {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => begin(race.date)}
      className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      aria-label={`Edit date for Race ${race.raceNumber}`}
    >
      <span>{race.date || 'Set date'}</span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
