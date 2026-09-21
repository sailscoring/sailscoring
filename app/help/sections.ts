import type { FeatureKey } from '@/lib/features';
import type { VocabularyKey } from '@/lib/split-fleets';

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
  /**
   * The words a scorer would actually type to find this section, beyond the
   * ones already in its title (#613). Titles alone find nothing for `DNC`,
   * `OCS`, `TCF`, `RDG`, `burgee`, `scratch`, `stopwatch` or `nett`.
   *
   * Written for the search box, so: the abbreviations, the RRS codes, and the
   * Sailwave and HalSail names for the same thing — a scorer arriving from
   * those tools reaches for their vocabulary, not ours.
   */
  keywords?: string[];
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
      { id: 'creating-a-series', title: 'Creating a series', keywords: ['new series', 'setup wizard', 'start a regatta', 'event', 'league'] },
      { id: 'organising-series', title: 'Organising the series list: categories and archive', keywords: ['category', 'archive', 'folder', 'series list', 'tidy', 'hide old series'] },
      { id: 'adding-competitors', title: 'Adding competitors', keywords: ['entry list', 'boat', 'helm', 'crew', 'sail number', 'bow number', 'entrant', 'sailor', 'nationality', 'club'] },
      { id: 'excluded-competitors', title: 'Competitors that are not entered', keywords: ['exclude', 'did not enter', 'non-entrant', 'withdraw', 'scratch entry', 'remove a boat', 'sailwave exclude'] },
      { id: 'sorting-the-competitor-list', title: 'Sorting the competitor list', keywords: ['sort', 'order', 'alphabetical', 'filter'] },
      { id: 'fleets', title: 'Fleets', keywords: ['class', 'division', 'group', 'split the entry', 'multi-fleet', 'one design'] },
      { id: 'start-sequences', title: 'Start sequences', keywords: ['gun', 'start time', 'sequence', 'warning signal', 'starting order'] },
      { id: 'race-fleets', title: 'Which fleets are in a race', keywords: ['start', 'which classes raced', 'membership', 'sat out', 'did not sail'] },
      { id: 'adding-races', title: 'Adding races', keywords: ['race day', 'add race', 'calendar', 'schedule', 'bulk', 'generate races'] },
      { id: 'race-management-metadata', title: 'Race conditions and the management team', feature: 'race-management-metadata', keywords: ['race officer', 'pro', 'officer of the day', 'ood', 'conditions', 'wind', 'jury', 'officials'] },
      { id: 'sub-series', title: 'Sub-series', feature: 'sub-series', keywords: ['block', 'spring series', 'autumn series', 'split a season', 'sailwave series'] },
      { id: 'creating-a-follow-on-series', title: 'Creating a follow-on series', feature: 'follow-on-series', keywords: ['next series', 'carry over', 'copy entries', 'new season'] },
      { id: 'split-fleets', title: 'Split-fleet championships', feature: 'split-fleets', keywords: ['gold', 'silver', 'bronze', 'qualifying', 'final series', 'medal race', 'championship', 'flight', 'seeding'] },
      { id: 'world-sailing-id', title: 'World Sailing Sailor IDs and seeding', feature: 'world-sailing-id', keywords: ['sailor id', 'world sailing', 'wsid', 'ranking seed'] },
    ],
  },
  {
    slug: 'entering-results',
    label: 'Entering results',
    blurb: 'The race-day loop: recording finishes, result codes, redress, and check-in.',
    sections: [
      { id: 'entering-results', title: 'Entering results', keywords: ['finish sheet', 'finishing order', 'dnc', 'dnf', 'dns', 'ocs', 'ufd', 'bfd', 'dsq', 'ret', 'nsc', 'result code', 'retired', 'did not finish', 'tie', 'dead heat', 'transcribe'] },
      { id: 'elapsed-times', title: 'Recording a race off a stopwatch', keywords: ['stopwatch', 'elapsed', 'timing', 'seconds', 'no gun', 'hand timing'] },
      { id: 'penalty-codes', title: 'Additive penalty codes', keywords: ['zfp', 'scp', 'dpi', 'penalty', 'points penalty', 'protest', 'discretionary', 'turn'] },
      { id: 'importing-finish-sheet', title: 'Importing a finish sheet from a spreadsheet', feature: 'csv-finish-import', keywords: ['csv', 'excel', 'spreadsheet', 'paste results', 'import finishes'] },
      { id: 'racesense-import', title: 'Importing from RaceSense', feature: 'racesense-import', keywords: ['vakaros', 'tracker', 'gps', 'track data', 'xlsx'] },
      { id: 'redress', title: 'Redress (RDG)', keywords: ['rdg', 'average points', 'protest committee', 'a9', 'compensation'] },
      { id: 'start-check-in', title: 'Start check-in', keywords: ['roll call', 'came to the start', 'starters', 'signed on', 'a5 3'] },
    ],
  },
  {
    slug: 'scoring-correctness',
    label: 'Scoring correctness',
    blurb: 'Discards, per-race options, and the scoring rules behind the standings.',
    sections: [
      { id: 'discard-rules', title: 'Discard rules', keywords: ['drop', 'throw out', 'worst score', 'nett', 'net points', 'discard threshold', 'proportional'] },
      { id: 'race-scoring-options', title: 'Per-race scoring options', feature: 'race-scoring-options', keywords: ['must count', 'non-discardable', 'weighted', 'double points', 'multiplier', 'medal race points'] },
      { id: 'a53-scoring', title: 'A5.3 starting-area scoring', keywords: ['a5 3', 'starting area', 'dnf points', 'dnc points', 'starters plus one', 'entries plus one', 'appendix a'] },
    ],
  },
  {
    slug: 'rating-systems',
    label: 'Rating and handicap systems',
    blurb: 'Scratch, IRC, ECHO, PY, NHC, VPRS and club handicaps — and keeping ratings up to date.',
    sections: [
      { id: 'rating-systems', title: 'Rating systems', keywords: ['handicap', 'tcf', 'tcc', 'irc', 'echo', 'py', 'portsmouth yardstick', 'nhc', 'vprs', 'orc', 'scratch', 'corrected time', 'time on time', 'time on distance', 'hph'] },
      { id: 'tuning-progressive-handicaps', title: 'Tuning a progressive handicap', keywords: ['nhc', 'echo', 'progressive', 'adjust', 'rolling handicap', 'recalculate'] },
      { id: 'fixed-tcf', title: 'A club handicap fixed for the series', keywords: ['club handicap', 'hph', 'fixed rating', 'house handicap'] },
      { id: 'scoring-orc', title: 'ORC scoring and performance curves', feature: 'orc', keywords: ['orc', 'performance curve', 'pcs', 'implied wind', 'triple number', 'wind band', 'aphd', 'apht', 'constructed course', 'scoring option'] },
      { id: 'course-builder', title: 'Building a constructed course', feature: 'orc', keywords: ['course', 'marks', 'legs', 'bearing', 'distance', 'course card', 'windward', 'leeward'] },
      { id: 'updating-handicaps', title: 'Updating handicaps from another series', keywords: ['carry ratings', 'previous series', 'last season', 'copy handicaps'] },
      { id: 'update-handicaps-irc-rating', title: 'Updating IRC TCCs from the rating list', feature: 'irc-rating', keywords: ['irc', 'tcc', 'certificate', 'rorc', 'club listing', 'rating list', 'endorsed'] },
      { id: 'update-handicaps-orc', title: 'Importing ORC certificates', feature: 'orc', keywords: ['orc', 'certificate', 'import certificates', 'downrms', 'vpp'] },
      { id: 'update-handicaps-vprs', title: 'Updating VPRS TCCs from a club list', feature: 'vprs', keywords: ['vprs', 'tcc', 'club list'] },
      { id: 'update-handicaps-irish-sailing', title: 'Updating ECHO from Irish Sailing', feature: 'echo', keywords: ['echo', 'irish sailing', 'national list', 'ratings'] },
      { id: 'update-handicaps-rya-py', title: 'Updating PY numbers from the RYA list', feature: 'rya-py', keywords: ['py', 'portsmouth yardstick', 'rya', 'py number', 'dinghy handicap'] },
    ],
  },
  {
    slug: 'reading-and-checking',
    label: 'Reading and checking',
    blurb: 'Reading the standings, and the history behind them.',
    sections: [
      { id: 'reading-the-standings', title: 'Reading the standings', keywords: ['results table', 'nett', 'total', 'rank', 'tie break', 'a8', 'countback', 'leaderboard', 'points'] },
      { id: 'history', title: 'Version history', keywords: ['undo', 'revision', 'restore', 'checkpoint', 'what changed', 'version'] },
    ],
  },
  {
    slug: 'publishing',
    label: 'Publishing',
    blurb: 'From standings to public pages your club can link to.',
    sections: [
      { id: 'publishing-results', title: 'Publishing results', keywords: ['publish', 'public page', 'url', 'link', 'share results', 'website', 'ftp', 'upload'] },
      { id: 'combined-pages', title: 'Extra pages', feature: 'combined-pages', keywords: ['overall page', 'one page', 'all fleets', 'extra page', 'race grid'] },
      { id: 'page-notes', title: 'A note on a published page', feature: 'page-notes', keywords: ['note', 'explain', 'correction', 'annotation', 'message on the page'] },
      { id: 'results-status', title: 'Provisional and final results', feature: 'results-status', keywords: ['provisional', 'final', 'finalise', 'protest time limit', 'lock'] },
      { id: 'competitor-list', title: 'Publishing the competitor list', feature: 'entry-list', keywords: ['entry list', 'entries page', 'who is coming', 'publish entries'] },
      { id: 'starters-checklist', title: 'The starters checklist', feature: 'entry-list', keywords: ['tally', 'check in sheet', 'starters', 'print', 'race team'] },
      { id: 'prizes', title: 'Prizes', feature: 'prizes', keywords: ['trophy', 'prize giving', 'winners', 'award'] },
      { id: 'logo-library', title: 'The logo library', feature: 'logo-library', keywords: ['burgee', 'crest', 'badge', 'club logo', 'branding', 'flag'] },
    ],
  },
  {
    slug: 'data-in-and-out',
    label: 'Data in and out',
    blurb: 'Spreadsheets in, files and data out.',
    sections: [
      { id: 'importing-competitors', title: 'Importing competitors from a spreadsheet', keywords: ['csv', 'excel', 'spreadsheet', 'entry list import', 'columns', 'mapping'] },
      { id: 'rrs-org-push', title: 'Pushing the competitor list to rrs.org', feature: 'rrs-import', keywords: ['rrs org', 'racing rules', 'push entries'] },
      { id: 'saving-and-sharing', title: 'Saving and sharing a series', keywords: ['file', 'sailscoring file', 'backup', 'save', 'send to another scorer', 'open a file'] },
      { id: 'sailwave-import', title: 'Importing from Sailwave', feature: 'sailwave-import', keywords: ['sailwave', 'blw', 'migrate', 'move from sailwave'] },
      { id: 'sailwave-export', title: 'Exporting to Sailwave', feature: 'sailwave-export', keywords: ['sailwave', 'blw', 'export'] },
      { id: 'json-export', title: 'Open in Sail Scoring, and the data behind published results', keywords: ['json', 'data', 'open in sail scoring', 'api', 'raw results', 'spectator'] },
    ],
  },
  {
    slug: 'across-series',
    label: 'Across series and seasons',
    blurb: 'Competitors, timelines and rankings across a workspace\'s seasons.',
    sections: [
      { id: 'competitor-identity', title: 'Competitors and timelines', feature: 'competitor-identity', keywords: ['same sailor', 'career', 'timeline', 'merge', 'duplicate', 'reconcile', 'across seasons'] },
      { id: 'rankings', title: 'Cross-series rankings', feature: 'rankings', keywords: ['ladder', 'season ranking', 'points table', 'club championship', 'order of merit'] },
    ],
  },
  {
    slug: 'collaboration',
    label: 'Collaboration and accounts',
    blurb: 'Working as a panel, and getting help.',
    sections: [
      { id: 'collaboration', title: 'Working with co-scorers', keywords: ['co-scorer', 'invite', 'workspace', 'share', 'panel', 'permissions', 'roles', 'team'] },
      { id: 'workspace-activity', title: 'The workspace activity log', keywords: ['audit', 'who changed', 'log', 'history of edits'] },
      { id: 'searching-help', title: 'Finding the right section', keywords: ['search', 'find', 'lookup', 'keyword', 'index', 'where is'] },
      { id: 'reading-help', title: 'Reading help beside your work', keywords: ['help panel', 'side by side', 'manual', 'documentation', 'search help'] },
      { id: 'sending-feedback', title: 'Sending feedback', keywords: ['bug', 'report', 'contact', 'suggestion', 'support'] },
      { id: 'keyboard-shortcuts', title: 'Keyboard shortcuts', keywords: ['keys', 'hotkey', 'shortcut', 'keyboard'] },
    ],
  },
  {
    slug: 'for-the-technical',
    label: 'For the technical',
    blurb: 'The API and command-line tool behind the app.',
    sections: [
      { id: 'rest-api', title: 'The REST API', keywords: ['api', 'rest', 'token', 'integration', 'http'] },
      { id: 'cli', title: 'The sailscoring CLI', keywords: ['command line', 'terminal', 'script', 'automation', 'npm'] },
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
    { id: 'what-is-sail-scoring', title: 'What is Sail Scoring?', keywords: ['about', 'introduction', 'overview', 'what is it'] },
    { id: 'signing-in', title: 'Signing in and workspaces', keywords: ['login', 'sign in', 'magic link', 'account', 'workspace', 'password'] },
  ],
};

/** The chapter path a section lives on, for panel links and Open-as-a-page:
 *  the introduction's sections are anchors on /help itself. A vocabulary
 *  rides along as a query parameter, ahead of the anchor, so the section
 *  ids stay the shareable part. */
export function helpHrefForSection(
  slug: string,
  id?: string | null,
  opts?: { vocab?: VocabularyKey | null },
): string {
  const base = slug === HELP_INTRODUCTION.slug ? '/help' : `/help/${slug}`;
  const query = opts?.vocab ? `?vocab=${opts.vocab}` : '';
  return id ? `${base}${query}#${id}` : `${base}${query}`;
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
  '/workspace/activity': 'workspace-activity',
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
