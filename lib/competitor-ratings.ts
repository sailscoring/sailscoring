import type { Competitor, Fleet } from '@/lib/types';
import { orcTotRating } from '@/lib/orc-certificate';
import { hasFleetRating } from '@/lib/scoring';

export type MissingRating = { fleetName: string; ratingLabel: string };

/** What a fleet of each system needs of a boat before it can be scored,
 *  named as the scorer would ask for it. */
const RATING_REQUIREMENT_LABEL: Record<RatingSystemCode, string> = {
  irc: 'IRC TCC',
  vprs: 'VPRS TCC',
  py: 'PY number',
  nhc: 'NHC starting TCF',
  echo: 'ECHO starting handicap',
  orc: 'ORC certificate',
};

export function fleetRatingLabel(fleet: Fleet): string | null {
  return fleet.scoringSystem === 'scratch'
    ? null
    : RATING_REQUIREMENT_LABEL[fleet.scoringSystem];
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

/** Systems a published list or certificate database can fill in, so an offer
 *  to fetch one means something. NHC is absent: a starting TCF comes from the
 *  boat's previous series or the scorer's own reckoning, never from a list. */
export const SOURCED_RATING_SYSTEMS: readonly RatingSystemCode[] = [
  'irc',
  'orc',
  'echo',
  'vprs',
  'py',
];

/** One rating system the series scores on and can't yet score everybody on. */
export type RatingGap = {
  system: RatingSystemCode;
  /** What the boats are missing, e.g. "IRC TCC". */
  ratingLabel: string;
  /** The fleets of that system that hold unrated boats, in fleet order. */
  fleets: { id: string; name: string }[];
  /** Distinct unrated boats across those fleets. */
  missing: number;
  /** Distinct boats in every fleet of the system, rated or not. */
  total: number;
};

/**
 * Where the series scores a system it has no rating for yet, per system in
 * {@link SOURCED_RATING_SYSTEMS} order.
 *
 * This is the state a competitor import leaves behind whenever a group is
 * scored on a handicap system the entry list says nothing about: the fleet is
 * created holding the whole group, because a file with no IRC column cannot
 * say who holds a certificate, and the rating list is the first thing that
 * knows better. Excluded boats are left out — a non-entrant needs no rating.
 */
export function ratingGaps(
  competitors: readonly Competitor[],
  fleets: readonly Fleet[],
): RatingGap[] {
  const out: RatingGap[] = [];
  for (const system of SOURCED_RATING_SYSTEMS) {
    const systemFleets = fleets.filter((f) => f.scoringSystem === system);
    if (systemFleets.length === 0) continue;

    // Counted per boat, not per membership: a boat in two IRC fleets is one
    // boat to chase a certificate for.
    const members = new Set<string>();
    const unrated = new Set<string>();
    const gapFleetIds = new Set<string>();
    for (const c of competitors) {
      if (c.excluded) continue;
      for (const f of systemFleets) {
        if (!c.fleetIds.includes(f.id)) continue;
        members.add(c.id);
        if (hasFleetRating(c, f)) continue;
        unrated.add(c.id);
        gapFleetIds.add(f.id);
      }
    }
    if (unrated.size === 0) continue;

    out.push({
      system,
      ratingLabel: RATING_REQUIREMENT_LABEL[system],
      fleets: systemFleets
        .filter((f) => gapFleetIds.has(f.id))
        .map((f) => ({ id: f.id, name: f.name })),
      missing: unrated.size,
      total: members.size,
    });
  }
  return out;
}
