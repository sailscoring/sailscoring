import type { Competitor, Fleet } from '@/lib/types';
import { orcTotRating } from '@/lib/orc-certificate';
import { hasFleetRating } from '@/lib/scoring';

export type MissingRating = { fleetName: string; ratingLabel: string };

export function fleetRatingLabel(fleet: Fleet): string | null {
  if (fleet.scoringSystem === 'irc') return 'IRC TCC';
  if (fleet.scoringSystem === 'vprs') return 'VPRS TCC';
  if (fleet.scoringSystem === 'py') return 'PY number';
  if (fleet.scoringSystem === 'nhc') return 'NHC starting TCF';
  if (fleet.scoringSystem === 'echo') return 'ECHO starting handicap';
  if (fleet.scoringSystem === 'orc') return 'ORC certificate';
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

export type RatingSystemCode = 'irc' | 'py' | 'nhc' | 'echo' | 'vprs' | 'orc';

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
  orc: 'ORC',
};

/** Render a rating for display. The multiplier-style ratings — IRC TCC, VPRS
 *  TCC, NHC starting TCF, ECHO starting handicap — always carry three decimal
 *  places, the way certificates print them, so 1.13 reads as 1.130 and a
 *  column of them lines up on the decimal point. ORC time-on-time ratings are
 *  published to four places (APHT 0.9216) and print as the certificate does.
 *  PY numbers are whole and print as stored; `Number(toFixed(3))` only strips
 *  the float noise a subtraction leaves behind (4.899999999999977 → 4.9). */
export function formatRatingValue(
  value: number | null | undefined,
  system: RatingSystemCode,
): string {
  if (value == null) return '—';
  if (system === 'py') return String(Number(value.toFixed(3)));
  return system === 'orc' ? value.toFixed(4) : value.toFixed(3);
}

function ratingValueFor(competitor: Competitor, system: RatingSystemCode, fleet?: Fleet): string {
  switch (system) {
    case 'irc':
      return formatRatingValue(competitor.ircTcc, 'irc');
    case 'vprs':
      return formatRatingValue(competitor.vprsTcc, 'vprs');
    case 'py':
      return formatRatingValue(competitor.pyNumber, 'py');
    case 'nhc':
      return formatRatingValue(competitor.nhcStartingTcf, 'nhc');
    case 'echo':
      return formatRatingValue(competitor.echoStartingTcf, 'echo');
    case 'orc':
      // The fleet's configured time-on-time rating off the certificate
      // (default APHT). A time-on-distance option has no TCF-shaped value;
      // fall back to APHT so the column still identifies the certificate.
      return formatRatingValue(
        (fleet ? orcTotRating(competitor, fleet) : null)
          ?? orcTotRating(competitor, {}),
        'orc',
      );
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
      value: ratingValueFor(competitor, f.scoringSystem, f),
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
