'use client';

import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

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
 * Races tab: prev/next arrows flanking a dropdown of every race. Doubles as the
 * race-entry heading — the trigger shows the current race, so there is no
 * separate "Race N — results" title above it. Hidden when the series has only
 * one race (the header renders a plain heading instead). Each choice calls
 * `onSelect` with a race id (the page routes to that race's URL). On a multi-day
 * series the dropdown groups races under their date.
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
          <Button
            variant="ghost"
            data-testid="race-switcher"
            aria-label="Switch race"
            className="h-auto gap-1.5 px-2 py-0.5 text-lg font-semibold"
          >
            <span className="truncate max-w-[16rem]">Race {current.raceNumber}</span>
            <ChevronDown className="h-4 w-4 opacity-60" />
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
