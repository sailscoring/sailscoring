'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';

/** Inline editor for a race's date. Renders the date as a subtle button that
 *  swaps to a native date input on click; commits on change/blur, cancels on
 *  Escape. Read-only series show plain text. */
export function RaceDateEditor({
  race,
  readOnly,
  onSave,
}: {
  race: { date: string; raceNumber: number };
  readOnly: boolean;
  onSave: (date: string) => Promise<void>;
}) {
  // `draft === null` means not editing; otherwise it holds the in-progress
  // value. Keeping the edit buffer separate from the `race.date` prop avoids
  // syncing state in an effect when the race updates underneath us.
  const [draft, setDraft] = useState<string | null>(null);

  if (readOnly) {
    return <p className="text-sm text-muted-foreground">{race.date || '—'}</p>;
  }

  async function commit() {
    const next = draft;
    setDraft(null);
    if (next && next !== race.date) {
      await onSave(next);
    }
  }

  if (draft !== null) {
    return (
      <Input
        type="date"
        autoFocus
        value={draft}
        aria-label={`Date for Race ${race.raceNumber}`}
        className="h-7 w-auto text-sm"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setDraft(race.date)}
      className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      aria-label={`Edit date for Race ${race.raceNumber}`}
    >
      <span>{race.date || 'Set date'}</span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
