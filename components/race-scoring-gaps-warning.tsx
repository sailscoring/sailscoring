import { AlertTriangle } from 'lucide-react';

import type { Fleet, RaceScoringGap } from '@/lib/types';
import { ratingSystemLabel } from '@/lib/competitor-ratings';

export interface RaceScoringGapsWarningProps {
  gaps: RaceScoringGap[];
  /** The race columns on screen, for naming the race the gap is in. */
  races: { id: string; raceNumber: number; name?: string | null }[];
  /** The fleet these gaps belong to — its rating system names what the race
   *  should have been scored on. Absent on the fleetless bucket. */
  fleet?: Fleet;
}

/** Races a fleet doesn't score the way its rating system says it should. Two
 *  kinds, and the difference is what the scorer can see without being told:
 *  an ORC race with no course to correct over scores nobody, so the race
 *  column is blank and publishing refuses the page; a fleet left out of a
 *  race's start still fills the column, on finishing order, which reads
 *  exactly like a scored race. */
export function RaceScoringGapsWarning({ gaps, races, fleet }: RaceScoringGapsWarningProps) {
  if (gaps.length === 0) return null;
  const byId = new Map(races.map((r) => [r.id, r]));

  function name(gap: RaceScoringGap): string {
    const race = byId.get(gap.raceId);
    return race ? `Race ${race.raceNumber}${race.name ? ` (${race.name})` : ''}` : 'A race';
  }

  function describe(gap: RaceScoringGap): string {
    return gap.option === 'CC'
      ? `${name(gap)} is scored on a constructed course, but its start has no course`
      : `${name(gap)} is scored on ${gap.option ?? 'an option'}, which corrects over the course distance, but its start records none`;
  }

  const missing = gaps.filter((g) => g.reason === 'orc_course_missing');
  const unstarted = gaps.filter((g) => g.reason === 'fleet_not_in_start');
  const system = fleet ? ratingSystemLabel(fleet) : '';

  return (
    <>
      {missing.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {missing.map(describe).join('. ')}. Nothing in {missing.length === 1 ? 'it' : 'them'} is
            scored — enter the course on the race&apos;s start, or change the race&apos;s scoring
            option.
          </span>
        </div>
      )}
      {unstarted.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span data-testid="fleet-not-in-start-warning">
            This fleet is in no start for {unstarted.map(name).join(', ')}, so there is no elapsed
            time to correct and {unstarted.length === 1 ? 'it is' : 'they are'} scored on finishing
            order{system ? `, not ${system}` : ''}. Add the fleet to the race&apos;s start.
          </span>
        </div>
      )}
    </>
  );
}
