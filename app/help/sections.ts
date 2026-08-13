import type { FeatureKey } from '@/lib/features';

/**
 * The help manifest: every section, its page, its TOC title, and the
 * feature gate (if any) that hides it. This is the single source the
 * landing index, each chapter's TOC, and the /help#anchor redirect all
 * render from — add or move a section here and everywhere follows.
 * Section ids are shareable URLs; never rename one.
 */
export interface HelpSectionDef {
  id: string;
  title: string;
  feature?: FeatureKey;
}

export interface HelpGroupDef {
  slug: string;
  label: string;
  blurb: string;
  sections: HelpSectionDef[];
}

export const HELP_GROUPS: HelpGroupDef[] = [
  {
    slug: 'running-a-series',
    label: 'Running a series',
    blurb: 'Setting up a series: entries, fleets, starts, and the race calendar.',
    sections: [
      { id: 'creating-a-series', title: 'Creating a series' },
      { id: 'organising-series', title: 'Organising the series list: categories and archive' },
      { id: 'adding-competitors', title: 'Adding competitors' },
      { id: 'sorting-the-competitor-list', title: 'Sorting the competitor list' },
      { id: 'fleets', title: 'Fleets' },
      { id: 'start-sequences', title: 'Start sequences' },
      { id: 'race-fleets', title: 'Which fleets are in a race' },
      { id: 'adding-races', title: 'Adding races' },
      { id: 'race-management-metadata', title: 'Race conditions and the management team', feature: 'race-management-metadata' },
      { id: 'sub-series', title: 'Sub-series', feature: 'sub-series' },
      { id: 'creating-a-follow-on-series', title: 'Creating a follow-on series', feature: 'follow-on-series' },
      { id: 'split-fleets', title: 'Split-fleet championships', feature: 'split-fleets' },
      { id: 'world-sailing-id', title: 'World Sailing Sailor IDs and seeding', feature: 'world-sailing-id' },
    ],
  },
  {
    slug: 'entering-results',
    label: 'Entering results',
    blurb: 'The race-day loop: recording finishes, result codes, redress, and check-in.',
    sections: [
      { id: 'entering-results', title: 'Entering results' },
      { id: 'penalty-codes', title: 'Additive penalty codes' },
      { id: 'importing-finish-sheet', title: 'Importing a finish sheet from a spreadsheet', feature: 'csv-finish-import' },
      { id: 'redress', title: 'Redress (RDG)' },
      { id: 'start-check-in', title: 'Start check-in' },
    ],
  },
  {
    slug: 'scoring-correctness',
    label: 'Scoring correctness',
    blurb: 'Discards, per-race options, and the scoring rules behind the standings.',
    sections: [
      { id: 'discard-rules', title: 'Discard rules' },
      { id: 'race-scoring-options', title: 'Per-race scoring options', feature: 'race-scoring-options' },
      { id: 'a53-scoring', title: 'A5.3 starting-area scoring' },
    ],
  },
  {
    slug: 'rating-systems',
    label: 'Rating and handicap systems',
    blurb: 'Scratch, IRC, ECHO, PY, NHC and VPRS — and keeping ratings up to date.',
    sections: [
      { id: 'rating-systems', title: 'Rating systems' },
      { id: 'updating-handicaps', title: 'Updating handicaps from another series' },
      { id: 'update-handicaps-irc-rating', title: 'Updating IRC TCCs from the rating list', feature: 'irc-rating' },
      { id: 'update-handicaps-vprs', title: 'Updating VPRS TCCs from a club list', feature: 'vprs' },
      { id: 'update-handicaps-irish-sailing', title: 'Updating ECHO from Irish Sailing', feature: 'echo' },
      { id: 'update-handicaps-rya-py', title: 'Updating PY numbers from the RYA list', feature: 'rya-py' },
    ],
  },
  {
    slug: 'reading-and-checking',
    label: 'Reading and checking',
    blurb: 'Reading the standings, and the history behind them.',
    sections: [
      { id: 'reading-the-standings', title: 'Reading the standings' },
      { id: 'history', title: 'Version history' },
    ],
  },
  {
    slug: 'publishing',
    label: 'Publishing',
    blurb: 'From standings to public pages your club can link to.',
    sections: [
      { id: 'publishing-results', title: 'Publishing results' },
      { id: 'combined-pages', title: 'Extra pages', feature: 'combined-pages' },
      { id: 'results-status', title: 'Provisional and final results', feature: 'results-status' },
      { id: 'prizes', title: 'Prizes', feature: 'prizes' },
      { id: 'logo-library', title: 'The logo library', feature: 'logo-library' },
    ],
  },
  {
    slug: 'data-in-and-out',
    label: 'Data in and out',
    blurb: 'Spreadsheets in, files and data out.',
    sections: [
      { id: 'importing-competitors', title: 'Importing competitors from a spreadsheet' },
      { id: 'rrs-org-push', title: 'Pushing the competitor list to rrs.org', feature: 'rrs-import' },
      { id: 'saving-and-sharing', title: 'Saving and sharing a series' },
      { id: 'sailwave-import', title: 'Importing from Sailwave', feature: 'sailwave-import' },
      { id: 'json-export', title: 'JSON data export and Open in Sail Scoring' },
    ],
  },
  {
    slug: 'across-series',
    label: 'Across series and seasons',
    blurb: 'Competitors, timelines and rankings across a workspace\'s seasons.',
    sections: [
      { id: 'competitor-identity', title: 'Competitors and timelines', feature: 'competitor-identity' },
      { id: 'rankings', title: 'Cross-series rankings', feature: 'rankings' },
    ],
  },
  {
    slug: 'collaboration',
    label: 'Collaboration and accounts',
    blurb: 'Working as a panel, and getting help.',
    sections: [
      { id: 'collaboration', title: 'Working with co-scorers' },
      { id: 'reading-help', title: 'Reading help beside your work' },
      { id: 'sending-feedback', title: 'Sending feedback' },
      { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts' },
    ],
  },
  {
    slug: 'for-the-technical',
    label: 'For the technical',
    blurb: 'The API and command-line tool behind the app.',
    sections: [
      { id: 'rest-api', title: 'The REST API' },
      { id: 'cli', title: 'The sailscoring CLI' },
    ],
  },
];

/**
 * The two opening sections of the /help landing page. They belong to no
 * chapter — their ids live on /help itself, which is why
 * `helpPathForSection` returns null for them — but the help panel needs
 * them listed like any other chapter, so their titles live here rather
 * than only in the JSX.
 */
export const HELP_INTRODUCTION: HelpGroupDef = {
  slug: 'introduction',
  label: 'Getting started',
  blurb: 'What Sail Scoring is, signing in, and workspaces.',
  sections: [
    { id: 'what-is-sail-scoring', title: 'What is Sail Scoring?' },
    { id: 'signing-in', title: 'Signing in and workspaces' },
  ],
};

/** The chapter path a section lives on, for panel links and Open-as-a-page:
 *  the introduction's sections are anchors on /help itself. */
export function helpHrefForSection(slug: string, id?: string | null): string {
  const base = slug === HELP_INTRODUCTION.slug ? '/help' : `/help/${slug}`;
  return id ? `${base}#${id}` : base;
}

/** The sections of a chapter this viewer can see. A section gated on a
 *  feature their workspace doesn't have isn't listed and isn't rendered. */
export function visibleSections(
  group: HelpGroupDef,
  features: readonly FeatureKey[],
): HelpSectionDef[] {
  return group.sections.filter((s) => !s.feature || features.includes(s.feature));
}

/** The chapters this viewer can see, each narrowed to its visible sections.
 *  A chapter whose every section is gated off for them doesn't exist: the
 *  index omits it and its page 404s (see HelpShell). */
export function visibleGroups(features: readonly FeatureKey[]): HelpGroupDef[] {
  return HELP_GROUPS.map((group) => ({ ...group, sections: visibleSections(group, features) }))
    .filter((group) => group.sections.length > 0);
}

/**
 * The section that covers a given app screen, so help can open on what the
 * scorer is actually looking at rather than on the index. Patterns are
 * matched longest-first, and `:id` matches one path segment.
 */
const SECTION_FOR_ROUTE: Record<string, string> = {
  '/': 'organising-series',
  '/account': 'signing-in',
  '/import': 'json-export',
  '/series/new': 'creating-a-series',
  '/series/import-sailwave': 'sailwave-import',
  '/series/:id': 'adding-competitors',
  '/series/:id/activity': 'collaboration',
  '/series/:id/competitors': 'adding-competitors',
  '/series/:id/history': 'history',
  '/series/:id/prizes': 'prizes',
  '/series/:id/races': 'adding-races',
  '/series/:id/races/:raceId': 'entering-results',
  '/series/:id/settings': 'discard-rules',
  '/series/:id/setup': 'creating-a-series',
  '/series/:id/split-fleets': 'split-fleets',
  '/series/:id/standings': 'reading-the-standings',
  '/workspace': 'signing-in',
  '/workspace/competitors': 'competitor-identity',
  '/workspace/published': 'publishing-results',
  '/workspace/rankings': 'rankings',
  '/workspace/rankings/:id': 'rankings',
};

function routeMatches(pattern: string, path: string): boolean {
  const p = pattern.split('/');
  const a = path.split('/');
  return p.length === a.length && p.every((seg, i) => seg.startsWith(':') || seg === a[i]);
}

/**
 * The manifest entry covering `pathname`, or null where nothing does or
 * where the section is gated off for this viewer. Returns the chapter too,
 * since that's what the panel needs to open.
 */
export function helpSectionForPath(
  pathname: string,
  features: readonly FeatureKey[],
): { slug: string; section: HelpSectionDef } | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const pattern = Object.keys(SECTION_FOR_ROUTE)
    .sort((a, b) => b.split('/').length - a.split('/').length)
    .find((candidate) => routeMatches(candidate, path));
  if (!pattern) return null;
  const id = SECTION_FOR_ROUTE[pattern];
  for (const group of [HELP_INTRODUCTION, ...HELP_GROUPS]) {
    const section = group.sections.find((s) => s.id === id);
    if (!section) continue;
    if (section.feature && !features.includes(section.feature)) return null;
    return { slug: group.slug, section };
  }
  return null;
}

/** The chapter path a section lives on, for redirecting old /help#id
 *  links — null for ids that stay on the landing page. */
export function helpPathForSection(id: string): string | null {
  for (const group of HELP_GROUPS) {
    if (group.sections.some((s) => s.id === id)) return `/help/${group.slug}`;
  }
  return null;
}
