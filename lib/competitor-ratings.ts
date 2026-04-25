import type { Competitor, Fleet } from '@/lib/types';
import { hasFleetRating } from '@/lib/scoring';

export type MissingRating = { fleetName: string; ratingLabel: string };

export function fleetRatingLabel(fleet: Fleet): string | null {
  if (fleet.scoringSystem === 'irc') return 'IRC TCC';
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
