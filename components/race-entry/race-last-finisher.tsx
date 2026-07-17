'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { effectiveLastFinisherTime } from '@/lib/race-status';
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Finish, Race } from '@/lib/types';

/**
 * The race's last-finisher time — the anchor for protest / redress time
 * limits, surfaced so a protest-committee member never has to dig through
 * the finish sheet for it. When any finish carries a time the sheet is
 * authoritative and this renders read-only; for untimed racing it's an
 * inline editor (same shape as the name/date editors) writing the race's
 * manual `lastFinisherTime`.
 */
export function RaceLastFinisher({
  race,
  finishes,
  readOnly,
  onSave,
}: {
  race: Race;
  finishes: Finish[];
  readOnly: boolean;
  onSave: (lastFinisherTime: string | undefined) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const lastFinisher = effectiveLastFinisherTime(race, finishes);

  if (lastFinisher?.source === 'finishes') {
    return (
      <p className="text-sm text-muted-foreground" data-testid="last-finisher">
        Last finisher {lastFinisher.time}{' '}
        <span className="text-xs">(from the finish sheet)</span>
      </p>
    );
  }

  if (readOnly) {
    if (!lastFinisher) return null;
    return (
      <p className="text-sm text-muted-foreground" data-testid="last-finisher">
        Last finisher {lastFinisher.time}
      </p>
    );
  }

  async function commit() {
    const next = draft;
    if (next === null) return;
    if (next.trim() === '') {
      // Cleared: drop the manual time.
      setDraft(null);
      setInvalid(false);
      if (race.lastFinisherTime) await onSave(undefined);
      return;
    }
    const normalized = normalizeTimeInput(next);
    if (!normalized) {
      setInvalid(true);
      return;
    }
    setDraft(null);
    setInvalid(false);
    if (normalized !== race.lastFinisherTime) await onSave(normalized);
  }

  if (draft !== null) {
    return (
      <Input
        autoFocus
        value={draft}
        placeholder="HH:MM:SS"
        aria-label={`Last finisher time for Race ${race.raceNumber}`}
        aria-invalid={invalid || undefined}
        className="h-7 w-28 text-sm"
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
            setInvalid(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setDraft(race.lastFinisherTime ?? '')}
      className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      aria-label={`Edit last finisher time for Race ${race.raceNumber}`}
      data-testid="last-finisher"
    >
      <span>
        {lastFinisher
          ? `Last finisher ${lastFinisher.time}`
          : 'Record last finisher'}
      </span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
