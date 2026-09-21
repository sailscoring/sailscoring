/**
 * Searching the help index (#613).
 *
 * Help is 62 sections across 10 chapters. Finding the one you want meant
 * reading the index or a chapter's TOC — fine once you know the shape of the
 * manual, useless when all you have is the word you are looking for. A scorer
 * expected a box to type a keyword into and found none.
 *
 * This matches the *index*, not the body text: titles, chapter labels and
 * blurbs, and each section's own keywords. Body-text search is deliberately
 * out of scope — roughly a dozen `has()` calls gate a sub-block inside an
 * otherwise ungated section, so a section-level body index would show gated
 * words to viewers who cannot see the text, which is the thing the gating
 * exists to prevent.
 *
 * At this size a substring match over a normalised haystack is enough; there
 * is no search dependency and no index to keep in step.
 */
import type { HelpGroupDef, HelpSectionDef } from '@/app/help/sections';

/** Lowercased, accents dropped, punctuation flattened to single spaces — so
 *  "Dún Laoghaire" matches "dun laoghaire" and "A5.3" matches "a5 3". */
export function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The words a query asks for. Every one of them must match (token-AND), so
 *  "discard rule" finds the discards section rather than everything that
 *  mentions a rule. */
export function searchTokens(query: string): string[] {
  const normalised = normalizeForSearch(query);
  return normalised ? normalised.split(' ') : [];
}

/** Everything one section can be found by, as one normalised string. */
function haystackOf(group: HelpGroupDef, section: HelpSectionDef): string {
  return normalizeForSearch(
    [section.title, ...(section.keywords ?? []), group.label, group.blurb].join(' '),
  );
}

export interface HelpSearchHit {
  group: HelpGroupDef;
  section: HelpSectionDef;
}

/**
 * The sections matching a query, in manifest order.
 *
 * The groups passed in are already narrowed per viewer by `visibleGroups`, so
 * feature gating falls out for free: a section this workspace cannot see is
 * not in the list being searched, and so cannot be found.
 *
 * A token matches as a prefix of any word in the haystack, so "disc" finds
 * "discards" — a scorer typing has not finished the word yet, and waiting for
 * them to is the sort of thing that makes a search box feel broken.
 */
export function searchHelp(
  groups: readonly HelpGroupDef[],
  query: string,
): HelpSearchHit[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const hits: HelpSearchHit[] = [];
  for (const group of groups) {
    for (const section of group.sections) {
      const haystack = ` ${haystackOf(group, section)} `;
      if (tokens.every((t) => haystack.includes(` ${t}`))) {
        hits.push({ group, section });
      }
    }
  }
  return hits;
}
