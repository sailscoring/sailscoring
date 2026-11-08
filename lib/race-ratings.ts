import type { Competitor, RaceRatingOverride } from './types';

/**
 * The rating a race's override scores a boat on, in the field's own units.
 *
 * An override is either a number the scorer typed — the rating for that race,
 * full stop — or a declaration of which certificate the boat raced on. A
 * boat declared on its secondary IRC certificate scores on the secondary it
 * holds when the race is scored, so a re-issued secondary reaches every race
 * declared on it; `value` is only the number it last resolved to, and stands
 * in when the boat no longer has a secondary.
 */
export function overrideRatingValue(
  override: Pick<RaceRatingOverride, 'value' | 'certificate'>,
  competitor: Pick<Competitor, 'ircSecondaryTcc'> | undefined,
): number {
  if (override.certificate === 'secondary' && competitor?.ircSecondaryTcc != null) {
    return competitor.ircSecondaryTcc;
  }
  return override.value;
}
