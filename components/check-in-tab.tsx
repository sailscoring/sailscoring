'use client';

import { useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { displayHelmCrew } from '@/lib/competitor-fields';
import type { Competitor } from '@/lib/types';

export interface CheckInTabProps {
  competitors: Competitor[];
  showCrew: boolean;
  presentCount: number;
  effectivelyPresent: (id: string) => boolean;
  toggleStartPresent: (c: Competitor) => void | Promise<void>;
}

export function CheckInTab({
  competitors,
  showCrew,
  presentCount,
  effectivelyPresent,
  toggleStartPresent,
}: CheckInTabProps) {
  const [checkinInput, setCheckinInput] = useState('');
  const [showAllCheckin, setShowAllCheckin] = useState(false);

  const checkinSuggestions = checkinInput.trim()
    ? competitors.filter((c) =>
        c.sailNumber.toUpperCase().startsWith(checkinInput.trim().toUpperCase()),
      )
    : [];

  const visible = showAllCheckin
    ? competitors
    : competitors.filter((c) => !effectivelyPresent(c.id));

  return (
    <div className="space-y-4 max-w-lg">
      <p className="text-sm text-muted-foreground">
        Mark competitors as present in the starting area before the race.
        This data is used for A5.3 scoring (DNF/OCS score starting-area entries + 1).
      </p>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Present at start: {presentCount} / {competitors.length}
        </p>
        {presentCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAllCheckin((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            {showAllCheckin ? 'Hide checked-in' : 'Show all'}
          </button>
        )}
      </div>
      <div className="relative">
        <Input
          value={checkinInput}
          onChange={(e) => setCheckinInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setCheckinInput('');
              return;
            }
            if (e.key !== 'Enter' && e.key !== 'Tab') return;
            if (!checkinInput.trim() || checkinSuggestions.length === 0) return;
            e.preventDefault();
            toggleStartPresent(checkinSuggestions[0]);
            setCheckinInput('');
          }}
          placeholder="Sail number to search…"
          autoComplete="off"
        />
        {checkinSuggestions.length > 0 && checkinInput.trim() && (
          <ul className="absolute z-10 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
            {checkinSuggestions.map((c) => {
              const present = effectivelyPresent(c.id);
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer text-sm hover:bg-accent"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleStartPresent(c);
                    setCheckinInput('');
                  }}
                >
                  <span className="font-mono font-medium w-16 shrink-0">{c.sailNumber}</span>
                  <span className="flex-1 truncate">{displayHelmCrew(c, showCrew)}</span>
                  {present ? (
                    <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-1.5">
        {visible.length === 0 && presentCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            All competitors checked in.{' '}
            <button
              type="button"
              onClick={() => setShowAllCheckin(true)}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Show all
            </button>
          </p>
        ) : (
          visible.map((c) => {
            const present = effectivelyPresent(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleStartPresent(c)}
                className={cn(
                  'w-full flex items-center gap-3 border rounded-lg px-4 py-2.5 text-left transition-colors',
                  present
                    ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800'
                    : 'hover:bg-accent',
                )}
              >
                {present ? (
                  <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <span className="font-mono font-medium w-16 shrink-0">{c.sailNumber}</span>
                <span className="text-sm flex-1 truncate">{displayHelmCrew(c, showCrew)}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
