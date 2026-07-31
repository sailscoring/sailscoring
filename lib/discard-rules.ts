import type { DiscardThreshold } from './types';

/**
 * Presentation helpers for the discard-rule editor.
 *
 * A `DiscardThreshold` says "once N races have been sailed, the total number of
 * discards is D". A sailing instruction says the same thing as a range — "when
 * 5 or more but fewer than 9 races have been completed, excluding her worst
 * score" — and the range is the part a scorer checks the setup against. The
 * upper end of it is implicit in the *next* rule, so it has to be derived.
 *
 * Nothing here scores anything: `getDiscardCount` in lib/scoring.ts remains the
 * only interpretation of a threshold list that matters.
 */

export type DescribedDiscardRule = {
  minRaces: number;
  discardCount: number;
  /** Lowest sailed-race count the rule governs; null when it never applies. */
  appliesFrom: number | null;
  /** Highest sailed-race count it governs; null when unbounded or never applied. */
  appliesTo: number | null;
  /** The range as a sentence; empty when the rule never applies. */
  appliesLabel: string;
  /** Problems worth flagging. None of them prevent saving. */
  warnings: string[];
};

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Resolve each rule's range and warnings, returned in the order given so the
 * editor can keep rows where the scorer put them.
 */
export function describeDiscardRules(thresholds: DiscardThreshold[]): DescribedDiscardRule[] {
  // Order the rules the way the engine resolves them. `getDiscardCount` scans
  // descending by minRaces and takes the first match, and Array#sort is stable,
  // so among rules sharing a minRaces the earliest in the array is the one that
  // ever fires; the rest are dead.
  const indexed = thresholds.map((threshold, index) => ({ threshold, index }));
  const ascending = [...indexed].sort(
    (a, b) => a.threshold.minRaces - b.threshold.minRaces || a.index - b.index,
  );

  const live: typeof ascending = [];
  const shadowedBy = new Map<number, number>();
  for (const entry of ascending) {
    const previous = live[live.length - 1];
    if (previous && previous.threshold.minRaces === entry.threshold.minRaces) {
      shadowedBy.set(entry.index, previous.index);
      continue;
    }
    live.push(entry);
  }

  const described = new Array<DescribedDiscardRule>(thresholds.length);

  for (const [index, shadower] of shadowedBy) {
    const threshold = thresholds[index];
    described[index] = {
      minRaces: threshold.minRaces,
      discardCount: threshold.discardCount,
      appliesFrom: null,
      appliesTo: null,
      appliesLabel: '',
      warnings: [
        `Never applies — rule ${shadower + 1} already sets the discards at ${threshold.minRaces} ` +
        `${plural(threshold.minRaces, 'race', 'races')}.`,
      ],
    };
  }

  live.forEach((entry, position) => {
    const { threshold, index } = entry;
    const { minRaces, discardCount } = threshold;
    const next = live[position + 1];
    const appliesTo = next ? next.threshold.minRaces - 1 : null;
    const previousCount = position === 0 ? 0 : live[position - 1].threshold.discardCount;

    const warnings: string[] = [];
    if (minRaces < 1) {
      warnings.push('Applies before any race is sailed — enter at least 1.');
    }
    if (discardCount < previousCount) {
      warnings.push(`Fewer discards than the rule before it (${previousCount}).`);
    } else if (discardCount === previousCount) {
      warnings.push(
        previousCount === 0
          ? 'This rule adds no discards.'
          : `Same number of discards as the rule before it (${previousCount}).`,
      );
    }
    if (minRaces >= 1 && discardCount >= minRaces) {
      warnings.push(`At ${minRaces} ${plural(minRaces, 'race', 'races')} sailed this discards every race.`);
    }

    let appliesLabel: string;
    if (appliesTo === null) {
      appliesLabel = `applies from ${minRaces} ${plural(minRaces, 'race', 'races')} sailed onwards`;
    } else if (appliesTo === minRaces) {
      appliesLabel = `applies at ${minRaces} ${plural(minRaces, 'race', 'races')} sailed only`;
    } else {
      appliesLabel = `applies from ${minRaces} to ${appliesTo} races sailed`;
    }

    described[index] = {
      minRaces,
      discardCount,
      appliesFrom: minRaces,
      appliesTo,
      appliesLabel,
      warnings,
    };
  });

  return described;
}

/**
 * The race count below which nothing is discarded, or null when the lowest rule
 * already covers the first race (so there is no such gap to state).
 */
export function discardFreeBelow(thresholds: DiscardThreshold[]): number | null {
  const lowest = thresholds.reduce<number | null>(
    (min, t) => (min === null || t.minRaces < min ? t.minRaces : min),
    null,
  );
  return lowest !== null && lowest >= 2 ? lowest : null;
}

/**
 * One-line restatement of the whole profile for the collapsed Scoring card —
 * e.g. `1 discard from 5 races, 2 from 9`. Long profiles keep the two ends and
 * elide the middle, since the ends are what identify the profile at a glance.
 */
export function summarizeDiscardRules(thresholds: DiscardThreshold[]): string {
  const live = describeDiscardRules(thresholds)
    .filter((rule) => rule.appliesFrom !== null)
    .sort((a, b) => a.appliesFrom! - b.appliesFrom!);

  if (live.length === 0) return 'No discards';

  const parts = live.map((rule, i) => {
    const races = `${rule.minRaces} ${plural(rule.minRaces, 'race', 'races')}`;
    return i === 0
      ? `${rule.discardCount} ${plural(rule.discardCount, 'discard', 'discards')} from ${races}`
      : `${rule.discardCount} from ${rule.minRaces}`;
  });

  if (parts.length > 4) {
    return `${parts[0]}, ${parts[1]}, … ${parts[parts.length - 1]}`;
  }
  return parts.join(', ');
}
