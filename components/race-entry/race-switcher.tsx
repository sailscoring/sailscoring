'use client';

import { Check, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { adjacentRaces } from '@/lib/race-navigation';
import { cn } from '@/lib/utils';
import type { Race } from '@/lib/types';

function raceLabel(race: Race): string {
  return race.name ? `Race ${race.raceNumber} — ${race.name}` : `Race ${race.raceNumber}`;
}

/**
 * Lateral navigation between the races of a series without going back to the
 * Races tab: prev/next arrows flanking a dropdown of every race. Rendered in
 * the race-entry header; hidden when the series has only one race. Each choice
 * calls `onSelect` with a race id (the page routes to that race's URL). On a
 * multi-day series the dropdown groups races under their date.
 */
export function RaceSwitcher({
  races,
  currentRaceId,
  onSelect,
}: {
  races: Race[];
  currentRaceId: string;
  onSelect: (raceId: string) => void;
}) {
  if (races.length <= 1) return null;

  const current = races.find((r) => r.id === currentRaceId);
  if (!current) return null;

  const { prev, next } = adjacentRaces(races, currentRaceId);
  const dates = Array.from(new Set(races.map((r) => r.date)));
  const groupByDate = dates.length > 1;

  const renderItem = (race: Race) => {
    const isCurrent = race.id === currentRaceId;
    return (
      <DropdownMenuItem
        key={race.id}
        onSelect={() => {
          if (!isCurrent) onSelect(race.id);
        }}
        className={cn('gap-2', isCurrent && 'font-medium')}
      >
        <Check className={cn('h-3.5 w-3.5 shrink-0', isCurrent ? 'opacity-100' : 'opacity-0')} />
        <span className="truncate">{raceLabel(race)}</span>
      </DropdownMenuItem>
    );
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!prev}
        aria-label="Previous race"
        title={prev ? raceLabel(prev) : undefined}
        onClick={() => prev && onSelect(prev.id)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" aria-label="Switch race">
            <span className="truncate max-w-[16rem]">{raceLabel(current)}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
          {groupByDate
            ? dates.map((date) => (
                <DropdownMenuGroup key={date}>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {date || '—'}
                  </DropdownMenuLabel>
                  {races.filter((r) => r.date === date).map(renderItem)}
                </DropdownMenuGroup>
              ))
            : races.map(renderItem)}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        variant="ghost"
        size="icon-sm"
        disabled={!next}
        aria-label="Next race"
        title={next ? raceLabel(next) : undefined}
        onClick={() => next && onSelect(next.id)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
