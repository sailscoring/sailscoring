'use client';

import { Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { useInlineEdit } from '@/hooks/use-inline-edit';

/** Inline editor for a race's optional name (a human label distinct from the
 *  number). Renders the name as a subtle button that swaps to a text input on
 *  click; commits on blur/Enter, cancels on Escape. An empty value clears the
 *  name. A save that fails keeps the typed name and says so. Read-only series
 *  show plain text (or nothing when unnamed). */
export function RaceNameEditor({
  race,
  readOnly,
  onSave,
}: {
  race: { name: string | null; raceNumber: number };
  readOnly: boolean;
  onSave: (name: string | null) => Promise<void>;
}) {
  // The buffer holds the raw typed string; the trim to null-or-value happens
  // on the way to the save, so an edit down to blank still clears the name.
  const { draft, setDraft, begin, cancel, commit, saving, error } = useInlineEdit({
    value: race.name ?? '',
    onSave: async (next) => {
      const trimmed = next.trim();
      await onSave(trimmed === '' ? null : trimmed);
    },
  });

  if (readOnly) {
    return race.name ? <p className="text-base font-medium">{race.name}</p> : null;
  }

  if (draft !== null) {
    return (
      <div>
        <Input
          type="text"
          autoFocus
          value={draft}
          disabled={saving}
          aria-invalid={error !== null}
          placeholder="Race name"
          aria-label={`Name for Race ${race.raceNumber}`}
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
      onClick={() => begin(race.name ?? '')}
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
