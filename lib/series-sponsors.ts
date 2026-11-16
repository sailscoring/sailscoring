/**
 * A series' sponsors and trophy donors — the names a club puts under the title
 * of its published results ("Sponsored by O'Leary Life").
 *
 * Not to be confused with `lib/sponsors.ts`, which names the sponsors of Sail
 * Scoring itself.
 *
 * Pure, so the settings card, the stored-shape validator, the archive ingest
 * and both renderers agree on what an entry is and how a list reads.
 */

import type { SeriesSponsor, SeriesSponsorKind } from './types';

export const SPONSOR_NAME_MAX_LENGTH = 120;
export const SPONSOR_URL_MAX_LENGTH = 400;
export const SPONSORS_MAX = 20;

export const SPONSOR_KINDS: readonly SeriesSponsorKind[] = ['sponsor', 'donor'];

/** What the settings card calls each kind. */
export const SPONSOR_KIND_LABEL: Record<SeriesSponsorKind, string> = {
  sponsor: 'Sponsor',
  donor: 'Trophy donor',
};

/** The words a published page puts before the names of each kind. */
export const SPONSOR_KIND_LEAD: Record<SeriesSponsorKind, string> = {
  sponsor: 'Sponsored by',
  donor: 'Trophy presented by',
};

/**
 * The list as it is stored: names and links trimmed, blank optional fields
 * dropped, and entries with no name left out — a half-filled row in the
 * editor is not a sponsor. Order is kept.
 */
export function tidySponsors(sponsors: readonly SeriesSponsor[] | undefined): SeriesSponsor[] {
  const out: SeriesSponsor[] = [];
  for (const s of sponsors ?? []) {
    const name = s.name.trim();
    if (!name) continue;
    const logoUrl = s.logoUrl?.trim();
    const url = s.url?.trim();
    out.push({
      name,
      kind: s.kind === 'donor' ? 'donor' : 'sponsor',
      ...(logoUrl ? { logoUrl } : {}),
      ...(url ? { url } : {}),
    });
  }
  return out;
}

/** One published line: the lead words and the entries of one kind. */
export interface SponsorLine {
  kind: SeriesSponsorKind;
  lead: string;
  entries: SeriesSponsor[];
}

/** The lines a page shows, sponsors first, each kind in its stored order.
 *  Empty when there is nothing to show. */
export function sponsorLines(sponsors: readonly SeriesSponsor[] | undefined): SponsorLine[] {
  const tidy = tidySponsors(sponsors);
  return SPONSOR_KINDS.flatMap((kind) => {
    const entries = tidy.filter((s) => s.kind === kind);
    return entries.length > 0 ? [{ kind, lead: SPONSOR_KIND_LEAD[kind], entries }] : [];
  });
}

/** "A", "A and B", "A, B and C" — how a line reads when said aloud. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** A line as plain text: "Sponsored by A, B and C". */
export function sponsorLineText(line: SponsorLine): string {
  return `${line.lead} ${joinNames(line.entries.map((s) => s.name))}`;
}

/** A one-line summary for the settings card when it is closed. */
export function sponsorsSummary(sponsors: readonly SeriesSponsor[] | undefined): string {
  const lines = sponsorLines(sponsors);
  return lines.length > 0 ? lines.map(sponsorLineText).join(' · ') : 'No sponsors';
}
