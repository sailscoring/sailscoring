/**
 * The pages a series publishes — worked out once, for everyone.
 *
 * A series' published output is a list of named pages: a fleet's results, a
 * publishing group's combined page, a championship's three, the prize sheet,
 * the entry list. Which of those exist is a property of the *series*, not of
 * where the pages are going — so the build (`buildFleetHtmlFiles`), the
 * publish dialog's Sail Scoring pane, and its FTP pane all resolve the set
 * here rather than each working it out again. A destination decides where a
 * page is served, never which pages there are.
 *
 * Page names are the identity: `PublishPage.name` is the `fleetName` the
 * build stamps on the file it renders, which is the key a publication stores
 * its pages under and the name the publish API ticks. Names are unique within
 * a series — the group editor rejects a group named after a fleet.
 *
 * This is config-level: it reads the series, its fleets and the workspace's
 * feature flags, and never scores a race. Two consequences, both of which the
 * callers handle rather than pretend away:
 *
 *   - A page listed here can still render nothing, and the build then drops
 *     it: an axis-sectioned group whose competitors carry no value for the
 *     axis, a championship whose stage races have no sheet rows yet, or every
 *     results page of a series whose first race is still to be sailed.
 *   - A page can appear that isn't listed here: competitors belonging to no
 *     fleet are scored as a synthetic "Unknown" fleet, which needs the
 *     competitor rows to know about. `unknownFleetPage` names that page for a
 *     caller holding a built file that matches no listed page.
 *
 * A sub-series (block) series publishes one page per block *per* entry here —
 * the block grid shares the fleet's row, its selection and its stored path,
 * with the block segment added per file. One row per fleet is what both panes
 * have always offered, and what the publish API ticks.
 */

import {
  fleetPagesSuppressed,
  groupApplies,
  producesPage,
  resolvePublishingGroups,
} from './publishing-groups';
import type { Fleet, Series } from './types';

/** What a page is. The kinds a scorer configures (`fleet`, `combined`,
 *  `prizes`, `entries`) and the three a split-fleet series publishes. */
export type PublishPageKind =
  | 'fleet'
  | 'combined'
  | 'championship'
  | 'race-results'
  | 'assignments'
  | 'prizes'
  | 'entries';

/** The pages that are not a fleet's results — they ride the publish
 *  machinery alongside the results pages, each with its own row and URL, and
 *  none of them counts when asking whether a publication has results. */
const EXTRA_PAGE_KINDS = new Set<PublishPageKind>([
  'race-results',
  'assignments',
  'prizes',
  'entries',
]);

/** The fixed names of the pages a series publishes that are nobody's fleet.
 *  Stable: a published page is stored under its name, so renaming one would
 *  orphan every live page. */
export const CHAMPIONSHIP_PAGE = 'Championship';
export const RACE_RESULTS_PAGE = 'Race results';
export const FLEET_ASSIGNMENTS_PAGE = 'Fleet assignments';
export const PRIZES_PAGE = 'Prizes';
export const ENTRIES_PAGE = 'Entries';

export interface PublishPage {
  /** The page's name: its heading, the `fleetName` of the file the build
   *  renders for it, and the key its published page is stored under. */
  name: string;
  kind: PublishPageKind;
  /** The publication's lone default page — served at `standings` (or
   *  `results`) rather than at its own name. At most one page carries it. */
  isDefault: boolean;
  /** Whose results the page shows, for `kind: 'fleet'`. */
  fleetId?: string;
  /** The publishing group behind the page, for `kind: 'combined'`. */
  groupId?: string;
}

export interface PublishPagesInput {
  series: Series;
  /** The series' fleets, in the order their pages render (display order). */
  fleets: Fleet[];
  /** Whether the series scores as a championship — a split-fleet config with
   *  at least one round. Its round fleets are internal, so it publishes the
   *  championship trio instead of per-fleet pages. */
  splitFleets?: boolean;
  /** The workspace features that add a page. Both default off: a series
   *  carrying prizes into a workspace without the feature publishes none. */
  features?: { prizes?: boolean; entryList?: boolean };
}

/** Whether a page is one of the extras — not a fleet's results. */
export function isExtraPage(page: PublishPage): boolean {
  return EXTRA_PAGE_KINDS.has(page.kind);
}

/** The page a built file belongs to, by name. A file naming no listed page
 *  is a synthetic "Unknown" fleet's — see the module note. */
export function findPublishPage(
  pages: PublishPage[],
  fleetName: string,
): PublishPage | undefined {
  return pages.find((p) => p.name === fleetName);
}

/** The page the scoring engine's fleetless bucket renders as, when a series'
 *  competitors belong to no fleet at all. `resolvePublishPages` returns it as
 *  the lone default page of a series with no fleet rows; a series that has
 *  fleets *and* orphan competitors grows it as a second page, which only the
 *  scored competitor rows reveal. */
export function unknownFleetPage(): PublishPage {
  return { name: 'Unknown', kind: 'fleet', isDefault: true };
}

/**
 * The pages this series publishes, in the order the build renders them:
 * combined pages ahead of the fleet pages they draw on, then the prize sheet
 * and the entry list. A championship publishes its own trio instead.
 */
export function resolvePublishPages(input: PublishPagesInput): PublishPage[] {
  const { series, fleets } = input;
  const wantsPrizes = !!input.features?.prizes && (series.prizes?.length ?? 0) > 0;
  const wantsEntries = !!input.features?.entryList;
  const entriesPage: PublishPage[] = wantsEntries
    ? [{ name: ENTRIES_PAGE, kind: 'entries', isDefault: false }]
    : [];

  if (input.splitFleets) {
    return [
      { name: CHAMPIONSHIP_PAGE, kind: 'championship', isDefault: true },
      { name: RACE_RESULTS_PAGE, kind: 'race-results', isDefault: false },
      { name: FLEET_ASSIGNMENTS_PAGE, kind: 'assignments', isDefault: false },
      ...entriesPage,
    ];
  }

  const groups = resolvePublishingGroups(series.publishingGroups, fleets)
    .filter(({ group }) => groupApplies(group, fleets.length > 1))
    .filter(producesPage);
  const suppressed = fleetPagesSuppressed(series.publishIndividualFleetPages, groups);
  // One fleet — or none, which scores as one — publishes the series' lone
  // default page; with several, every page is served at its own name.
  const isSingleDefault = fleets.length <= 1;
  const fleetPages: PublishPage[] = suppressed
    ? []
    : fleets.length === 0
      ? [unknownFleetPage()]
      : fleets.map((fleet) => ({
          name: fleet.name,
          kind: 'fleet' as const,
          isDefault: isSingleDefault,
          fleetId: fleet.id,
        }));

  return [
    ...groups.map(({ group }) => ({
      name: group.name.trim(),
      kind: 'combined' as const,
      isDefault: false,
      groupId: group.id,
    })),
    ...fleetPages,
    ...(wantsPrizes ? [{ name: PRIZES_PAGE, kind: 'prizes' as const, isDefault: false }] : []),
    ...entriesPage,
  ];
}
