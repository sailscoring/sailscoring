'use client';

import { formatBearing, type Variation } from '@/lib/bearings';
import { LINE_FROM_CARD_WARN_M, PIN_NEAR_MARK_M, lineFacts, markLabel } from '@/lib/course-geometry';
import type { SeriesMark } from '@/lib/types';

/**
 * A line recorded as its two ends, described: how long it is and which way
 * it lies, as facts about the course, and the two things worth a second look
 * — a pin within 60 m of another mark, and (on a card course) a line whose
 * middle is far from where the card puts it. Line bias and squareness to the
 * wind are race management, and not shown.
 */
export function LineFacts({
  starboard,
  port,
  library,
  variation,
  fromCardM,
  testId,
}: {
  starboard: SeriesMark;
  port: SeriesMark;
  library: readonly SeriesMark[];
  variation?: Variation;
  /** How far the line's middle is from where the card puts the line. */
  fromCardM?: number;
  testId?: string;
}) {
  const facts = lineFacts(starboard, port, library);
  return (
    <div className="space-y-0.5 text-xs" data-testid={testId}>
      <p className="text-muted-foreground">
        Line {Math.round(facts.lengthM)} m, {formatBearing(facts.bearingDeg, variation, { whole: true })} from{' '}
        {markLabel(starboard)} to {markLabel(port)}. Legs are measured from its middle.
      </p>
      {facts.nearPin.length > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          The pin is within {PIN_NEAR_MARK_M} m of {facts.nearPin.map((m) => m.name).join(', ')}: check it is the
          mark that was laid.
        </p>
      )}
      {fromCardM != null && fromCardM > LINE_FROM_CARD_WARN_M && (
        <p className="text-amber-800 dark:text-amber-300">
          The middle of this line is {formatDistance(fromCardM)} from where the card puts the start: check the
          ends were recorded for this race.
        </p>
      )}
    </div>
  );
}

function formatDistance(m: number): string {
  return m >= 1852 ? `${(m / 1852).toFixed(1)} NM` : `${Math.round(m)} m`;
}
