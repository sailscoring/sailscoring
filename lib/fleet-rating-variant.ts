import type { OrcFamily } from './orc-certificate';
import type { IrcTccVariant } from './rating-match';
import type { Fleet, FleetRatingVariant } from './types';

/**
 * A fleet's stored certificate choice (`Fleet.ratingVariant`), translated to
 * and from the vocabulary each rating-list source speaks: the IRC and VPRS
 * spin / non-spin TCC pair, and ORC's certificate families. A stored value
 * the fleet's scoring system has no such certificate for — `double-handed` on
 * an IRC fleet, say, left behind by a change of system — reads as standard.
 */

export const RATING_VARIANT_LABEL: Record<FleetRatingVariant, string> = {
  'non-spin': 'Non-spinnaker',
  'double-handed': 'Double-handed',
};

export function isFleetRatingVariant(v: unknown): v is FleetRatingVariant {
  return v === 'non-spin' || v === 'double-handed';
}

/** The TCC an IRC or VPRS fleet is set to. */
export function fleetTccVariant(fleet: Pick<Fleet, 'ratingVariant'>): IrcTccVariant {
  return fleet.ratingVariant === 'non-spin' ? 'non-spin' : 'spin';
}

/** The certificate family an ORC fleet is set to. */
export function fleetOrcFamily(fleet: Pick<Fleet, 'ratingVariant'>): OrcFamily {
  if (fleet.ratingVariant === 'non-spin') return 'NS';
  if (fleet.ratingVariant === 'double-handed') return 'DH';
  return 'ORC';
}

export function ratingVariantFromTcc(variant: IrcTccVariant): FleetRatingVariant | undefined {
  return variant === 'non-spin' ? 'non-spin' : undefined;
}

export function ratingVariantFromOrcFamily(family: OrcFamily): FleetRatingVariant | undefined {
  if (family === 'NS') return 'non-spin';
  if (family === 'DH') return 'double-handed';
  return undefined;
}

/** The certificate choices a scoring system offers beyond standard — empty
 *  for a system rated off no certificate list. */
export function ratingVariantsFor(system: Fleet['scoringSystem']): readonly FleetRatingVariant[] {
  if (system === 'irc' || system === 'vprs') return ['non-spin'];
  if (system === 'orc') return ['non-spin', 'double-handed'];
  return [];
}
