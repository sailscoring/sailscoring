'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';

/** Inline editor for a race's optional name (a human label distinct from the
 *  number). Renders the name as a subtle button that swaps to a text input on
 *  click; commits on blur/Enter, cancels on Escape. An empty value clears the
 *  name. Read-only series show plain text (or nothing when unnamed). */
export function RaceNameEditor({
  race,
  readOnly,
  onSave,
}: {
  race: { name: string | null; raceNumber: number };
  readOnly: boolean;
  onSave: (name: string | null) => Promise<void>;
}) {
  // `draft === null` means not editing; otherwise it holds the in-progress
  // value (a string, possibly empty). Kept separate from the `race.name` prop
  // so an update underneath us doesn't clobber the edit buffer.
  const [draft, setDraft] = useState<string | null>(null);

  if (readOnly) {
    return race.name ? <p className="text-base font-medium">{race.name}</p> : null;
  }

  async function commit() {
    const next = draft;
    setDraft(null);
    if (next === null) return;
    const trimmed = next.trim();
    const normalized = trimmed === '' ? null : trimmed;
    if (normalized !== race.name) {
      await onSave(normalized);
    }
  }

  if (draft !== null) {
    return (
      <Input
        type="text"
        autoFocus
        value={draft}
        placeholder="Race name"
        aria-label={`Name for Race ${race.raceNumber}`}
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
      onClick={() => setDraft(race.name ?? '')}
      className="group flex items-center gap-1 text-base font-medium hover:text-foreground"
      aria-label={`Edit name for Race ${race.raceNumber}`}
    >
      <span className={race.name ? '' : 'text-sm font-normal text-muted-foreground'}>
        {race.name || 'Set name'}
      </span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
