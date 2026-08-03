/**
 * World Sailing Sailor ID — the free, unique identifier tied to a sailor's
 * World Sailing profile, required for entry to most international events.
 *
 * We record it for one job: joining an organising authority's seed ranking to
 * the entry list. At a championship the entry is a *sailor* — boats are often
 * chartered, so the sail number is a late allocation that can change — and the
 * ranking list is a list of sailors too. Without a shared identifier the only
 * join available is name plus nation, which breaks on transliteration,
 * diacritics, family-name-first conventions, and shortened names.
 *
 * The identifier is a nation code, the sailor's initials, and a
 * disambiguating number: `IRLMM1`, `USATS15`, `ESPFE`. Wikidata's property
 * (P11616) states the format as `[A-Z]{5}[0-9]{0,3}`, which matches every
 * example World Sailing publishes.
 *
 * Nothing here rejects an ID that doesn't match. Entry lists are transcribed
 * by humans, and refusing an import because one cell looks odd is worse than
 * carrying a suspect value the scorer can see and check — so the format is a
 * *warning* everywhere it is used, and the datafeed is what actually decides
 * whether an ID exists.
 */

/** Canonical Sailor ID shape: nation code + initials + optional number. */
export const WORLD_SAILING_ID_PATTERN = /^[A-Z]{5}[0-9]{0,3}$/;

/** Upper-case and strip incidental whitespace — entry lists arrive with both
 *  ("gbrmi2", "GBR MI2"). Returns undefined for a blank value so callers can
 *  store the field sparsely. */
export function normalizeWorldSailingId(raw: string | undefined | null): string | undefined {
  const cleaned = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Whether an ID matches the published format. Callers warn on false; none
 *  refuse the value. */
export function isValidWorldSailingId(id: string | undefined | null): boolean {
  return id != null && WORLD_SAILING_ID_PATTERN.test(id);
}

/** The sailor's public World Sailing biography page — the link target in
 *  published results. */
export function worldSailingProfileUrl(id: string): string {
  return `https://www.sailing.org/sailor/?ref=${encodeURIComponent(id)}`;
}
