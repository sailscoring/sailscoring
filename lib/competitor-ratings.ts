import type { Competitor, Fleet } from '@/lib/types';
import { hasFleetRating } from '@/lib/scoring';

export type MissingRating = { fleetName: string; ratingLabel: string };

export function fleetRatingLabel(fleet: Fleet): string | null {
  if (fleet.scoringSystem === 'irc') return 'IRC TCC';
  if (fleet.scoringSystem === 'vprs') return 'VPRS TCC';
  if (fleet.scoringSystem === 'py') return 'PY number';
  if (fleet.scoringSystem === 'nhc') return 'NHC starting TCF';
  if (fleet.scoringSystem === 'echo') return 'ECHO starting handicap';
  return null;
}

export function missingRatings(
  competitor: Competitor,
  fleetById: Map<string, Fleet>,
): MissingRating[] {
  const out: MissingRating[] = [];
  for (const id of competitor.fleetIds) {
    const f = fleetById.get(id);
    if (f == null || hasFleetRating(competitor, f)) continue;
    const ratingLabel = fleetRatingLabel(f);
    if (ratingLabel) out.push({ fleetName: f.name, ratingLabel });
  }
  return out;
}

export function formatMissingRatings(missing: MissingRating[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) {
    const m = missing[0];
    return `Missing ${m.ratingLabel} for ${m.fleetName} fleet`;
  }
  return `Missing: ${missing.map((m) => `${m.ratingLabel} (${m.fleetName})`).join(', ')}`;
}

export function requiredForFleetsHint(fleetNames: string[]): string {
  if (fleetNames.length === 0) return '';
  const suffix = fleetNames.length === 1 ? 'fleet' : 'fleets';
  return `Required for ${fleetNames.join(', ')} ${suffix}.`;
}

export type RatingSystemCode = 'irc' | 'py' | 'nhc' | 'echo' | 'vprs';

export type RatingDisplay = {
  system: RatingSystemCode;
  label: string;
  value: string;
};

const RATING_LABEL: Record<RatingSystemCode, string> = {
  irc: 'IRC',
  vprs: 'VPRS',
  py: 'PY',
  nhc: 'NHC',
  echo: 'ECHO',
};

function ratingValueFor(competitor: Competitor, system: RatingSystemCode): string {
  switch (system) {
    case 'irc':
      return competitor.ircTcc != null ? String(competitor.ircTcc) : '—';
    case 'vprs':
      return competitor.vprsTcc != null ? String(competitor.vprsTcc) : '—';
    case 'py':
      return competitor.pyNumber != null ? String(competitor.pyNumber) : '—';
    case 'nhc':
      return competitor.nhcStartingTcf != null ? String(competitor.nhcStartingTcf) : '—';
    case 'echo':
      return competitor.echoStartingTcf != null ? String(competitor.echoStartingTcf) : '—';
  }
}

/** Rating values to display for a competitor in the Competitors table.
 *  Returns one entry per non-scratch scoring system that any of the
 *  competitor's fleets uses, deduplicated, in fleet order. */
export function competitorRatings(
  competitor: Competitor,
  fleetById: Map<string, Fleet>,
): RatingDisplay[] {
  const seen = new Set<RatingSystemCode>();
  const out: RatingDisplay[] = [];
  for (const id of competitor.fleetIds) {
    const f = fleetById.get(id);
    if (!f || f.scoringSystem === 'scratch' || seen.has(f.scoringSystem)) continue;
    seen.add(f.scoringSystem);
    out.push({
      system: f.scoringSystem,
      label: RATING_LABEL[f.scoringSystem],
      value: ratingValueFor(competitor, f.scoringSystem),
    });
  }
  return out;
}

/** The set of distinct non-scratch scoring systems present across the given
 *  fleets, in insertion order. Used to decide whether the Rating column
 *  should append system labels (only useful when more than one applies). */
export function configuredRatingSystems(fleets: Fleet[]): RatingSystemCode[] {
  const seen = new Set<RatingSystemCode>();
  const out: RatingSystemCode[] = [];
  for (const f of fleets) {
    if (f.scoringSystem === 'scratch' || seen.has(f.scoringSystem)) continue;
    seen.add(f.scoringSystem);
    out.push(f.scoringSystem);
  }
  return out;
}
