// Bring a series stored before custom scoring codes up to the current shape,
// under ADR-013: they removed `dnfScoring: 'startingAreaInclDnc'`, the
// setting behind DBSC Sailing Instruction A13.2, which changes RRS A5.3 so
// that a boat that did not come to the starting area is scored from the
// boats that came, as a DNF is.
//
// A stored series can still carry it — in a `.sailscoring` file, a revision
// snapshot, a Trash tombstone or a published data file — so every entry
// point that reads one passes it through here, and migration 0129 does the
// same for the rows the database holds. The removed value is one of:
//
//   lossless        none
//   presentational  none
//   scoring         the setting itself: upgraded to A5.3
//                   (`startingArea`) with DNC changed to score the same as
//                   DNF, which is the same rule written as a scoring code.
//                   Every race scores identically, so nothing is refused or
//                   rescored.

import type { SeriesScoringCode } from './types';

type Raw = Record<string, unknown>;

/** DNC scored the same as DNF: DBSC SI A13.2 as a changed built-in code. */
export const DNC_SCORED_AS_DNF: SeriesScoringCode = {
  code: 'DNC',
  kind: 'replace',
  rule: { type: 'sameAs', code: 'DNF' },
  discardable: true,
};

/**
 * One series object brought forward, in place: a series on
 * `startingAreaInclDnc` becomes A5.3 with DNC scored the same as DNF. A
 * series that already changes DNC keeps its own change. Anything else is
 * left as it is, so the upgrade can run on every read.
 */
export function upgradeDncRule(series: Raw | undefined): void {
  if (!series || series.dnfScoring !== 'startingAreaInclDnc') return;
  series.dnfScoring = 'startingArea';
  const codes = Array.isArray(series.scoringCodes) ? (series.scoringCodes as Raw[]) : [];
  if (!codes.some((c) => c && c.code === 'DNC')) {
    series.scoringCodes = [...codes, { ...DNC_SCORED_AS_DNF, rule: { ...DNC_SCORED_AS_DNF.rule } }];
  }
}
