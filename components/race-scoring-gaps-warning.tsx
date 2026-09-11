import { AlertTriangle } from 'lucide-react';

import type { RaceScoringGap } from '@/lib/types';

export interface RaceScoringGapsWarningProps {
  gaps: RaceScoringGap[];
  /** The race columns on screen, for naming the race the gap is in. */
  races: { id: string; raceNumber: number; name?: string | null }[];
}

/** Races a fleet can't score under the option they resolved to. Nothing in
 *  such a race is scored — scoring it by some other method would put a race
 *  in front of competitors under rules nobody agreed to — so this is where
 *  the scorer learns why a race column is blank. Publishing refuses the page
 *  until it is cleared. */
export function RaceScoringGapsWarning({ gaps, races }: RaceScoringGapsWarningProps) {
  if (gaps.length === 0) return null;
  const byId = new Map(races.map((r) => [r.id, r]));

  function describe(gap: RaceScoringGap): string {
    const race = byId.get(gap.raceId);
    const name = race ? `Race ${race.raceNumber}${race.name ? ` (${race.name})` : ''}` : 'A race';
    return gap.option === 'CC'
      ? `${name} is scored on a constructed course, but its start has no course`
      : `${name} is scored on ${gap.option ?? 'an option'}, which corrects over the course distance, but its start records none`;
  }

  const missing = gaps.filter((g) => g.reason === 'orc_course_missing');
  if (missing.length === 0) return null;

  return (
    <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>
        {missing.map(describe).join('. ')}. Nothing in {missing.length === 1 ? 'it' : 'them'} is
        scored — enter the course on the race&apos;s start, or change the race&apos;s scoring option.
      </span>
    </div>
  );
}
