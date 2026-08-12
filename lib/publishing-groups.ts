/**
 * Pure helpers for the extra published pages a series can define (#255, #390).
 * A publishing group names a page assembled from sections — several fleets, or
 * the values of one subdivision axis — see `PublishingGroup` in
 * `lib/types.ts`. This module resolves the stored group config against the
 * series' live fleets, in one place, so the build path
 * (`buildFleetHtmlFiles`), the publish handler's retraction of suppressed
 * pages, and the publish dialog's reflection all agree on which fleets a group
 * covers and when standalone fleet pages are skipped
 * (`Series.publishIndividualFleetPages`).
 *
 * Groups never apply to sub-series, which publish their own (block × fleet)
 * page grid. Fleet-sectioned groups additionally need more than one fleet —
 * a lone fleet has nothing to combine — while an axis-sectioned group is
 * exactly what a single-fleet series with divisions wants. Callers gate on
 * `groupApplies` before resolving.
 */

import { subdivisionAxisLabel } from './competitor-fields';
import type { Fleet, PublishingGroup, Standing, SubdivisionAxis } from './types';

/** Bound on a group's name — it becomes the page title and seeds the URL
 *  sub-path, which shares the slug's length cap. */
export const PUBLISHING_GROUP_NAME_MAX_LENGTH = 60;

/** A group resolved against the live fleet list: its members in fleet
 *  displayOrder, dropping ids whose fleet no longer exists. */
export interface ResolvedPublishingGroup {
  group: PublishingGroup;
  /** Member fleets in displayOrder. Empty when a 'chosen' group's fleets
   *  were all deleted — such a group renders no page. */
  fleets: Fleet[];
}

/** Fleets sorted the way sections (and pages) render. */
function inDisplayOrder(fleets: Fleet[]): Fleet[] {
  return [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);
}

/**
 * Resolve every group against the live fleets, preserving the stored group
 * order. Groups that resolve to no members are kept (with `fleets: []`) so
 * the settings editor can still show them; page-producing callers skip them.
 */
export function resolvePublishingGroups(
  groups: PublishingGroup[] | undefined,
  fleets: Fleet[],
): ResolvedPublishingGroup[] {
  if (!groups || groups.length === 0) return [];
  const ordered = inDisplayOrder(fleets);
  return groups.map((group) => ({
    group,
    fleets:
      group.fleetMode === 'all'
        ? ordered
        : ordered.filter((f) => group.fleetIds.includes(f.id)),
  }));
}

/** Whether a resolved group produces a page: it has a name and at least one
 *  member. The build path and the publish dialog both filter on this, so a
 *  half-configured group is inert everywhere until it's completed. An
 *  axis-sectioned group also needs its axis to yield sections, which depends
 *  on scored competitors rather than config — the build path drops such a
 *  page when it resolves to nothing. */
export function producesPage(resolved: ResolvedPublishingGroup): boolean {
  if (resolved.group.name.trim().length === 0) return false;
  if (resolved.fleets.length > 0) return true;
  // A series with no fleet rows at all still scores one (synthetic) fleet, and
  // an 'all'-mode axis page cuts within it — so membership can't be required
  // here. A 'chosen' group whose fleets were deleted stays inert.
  return resolved.group.sectionAxisId != null && resolved.group.fleetMode === 'all';
}

/** Whether a group applies to a series at all. Fleet sections need something
 *  to combine; axis sections cut within a fleet, so one fleet is enough. */
export function groupApplies(group: PublishingGroup, multiFleet: boolean): boolean {
  return group.sectionAxisId != null || multiFleet;
}

/** One section of an axis-sectioned page: the competitors carrying one value
 *  of the axis, ranked among themselves. */
export interface SubdivisionSection {
  /** The axis value, spelled as the first competitor carrying it spells it. */
  value: string;
  /** The section's standings, renumbered 1..n. Everything else — points,
   *  discards, race scores — is the series' own, untouched. */
  standings: Standing[];
}

/**
 * Cut one fleet's standings into sections by a subdivision axis's values.
 *
 * Section order is the order the values first appear in the standings, so the
 * division of the leading boat leads the page (Gold, Silver, Bronze for the
 * usual skill tiers) without anyone having to declare an order. Values are
 * matched case-insensitively — a CSV import that spells one row "gold" is the
 * same division — and displayed as first spelled.
 *
 * Ranks are renumbered 1..n down the standings order, which is already
 * tie-broken (RRS A7), so a section inherits the series' own ordering. Boats
 * tied in the series stay tied within their division. Competitors carrying no
 * value for the axis land in no section: the caller surfaces the count rather
 * than dropping them silently.
 */
export function subdivisionSections(
  standings: Standing[],
  axisId: string,
): SubdivisionSection[] {
  const byKey = new Map<string, { value: string; members: Standing[] }>();
  for (const standing of standings) {
    const value = standing.competitor.subdivisions?.[axisId]?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    const section = byKey.get(key);
    if (section) section.members.push(standing);
    else byKey.set(key, { value, members: [standing] });
  }
  return [...byKey.values()].map(({ value, members }) => {
    const ranked: Standing[] = [];
    members.forEach((standing, i) => {
      const tiedWithPrevious = i > 0 && members[i - 1].rank === standing.rank;
      ranked.push({
        ...standing,
        rank: tiedWithPrevious ? ranked[i - 1].rank : i + 1,
      });
    });
    return { value, standings: ranked };
  });
}

/** Scored competitors carrying no value for the axis — they appear on no
 *  section of the page, which the settings card reports. */
export function countMissingAxisValues(
  standings: Standing[],
  axisId: string,
): number {
  return standings.filter((s) => !s.competitor.subdivisions?.[axisId]?.trim())
    .length;
}

/**
 * Whether a view's standalone fleet pages are skipped: the scorer turned
 * `Series.publishIndividualFleetPages` off AND the view has at least one
 * page-producing combined page. With no combined page in the view, the
 * toggle is inert — fleet pages always publish, so a page-less publication
 * is never constructed. One rule for the build path, the publish handler's
 * retraction, and the dialog's reflection.
 */
export function fleetPagesSuppressed(
  publishIndividualFleetPages: boolean | undefined,
  producingGroups: ResolvedPublishingGroup[],
): boolean {
  return (publishIndividualFleetPages ?? true) === false && producingGroups.length > 0;
}

/** Human summary of a group's membership for the settings card and publish
 *  dialog, e.g. `all fleets` or `Scratch + HPH`. */
export function describeGroupMembers(resolved: ResolvedPublishingGroup): string {
  if (resolved.group.fleetMode === 'all') return 'all fleets';
  if (resolved.fleets.length === 0) return 'no fleets';
  return resolved.fleets.map((f) => f.name).join(' + ');
}

/** How a group's sections are cut, for the settings card and publish dialog:
 *  `one per fleet` or `one per Division`. */
export function describeGroupSections(
  group: PublishingGroup,
  axes: SubdivisionAxis[],
): string {
  if (group.sectionAxisId == null) return 'one section per fleet';
  const axis = axes.find((a) => a.id === group.sectionAxisId);
  return axis
    ? `one section per ${subdivisionAxisLabel(axis)}`
    : 'sectioned by a field the series no longer has';
}

/**
 * Validation for the group editor. Returns an error message, or null when
 * the group is well-formed within its series. Name rules: non-empty, unique
 * among groups, and distinct from every fleet name — published pages are
 * keyed by name alongside fleet pages, so a clash would collide.
 */
export function publishingGroupError(
  group: PublishingGroup,
  allGroups: PublishingGroup[],
  fleets: Fleet[],
  axes: SubdivisionAxis[] = [],
): string | null {
  const name = group.name.trim();
  if (!name) return 'Give the page a name.';
  const lower = name.toLowerCase();
  if (fleets.some((f) => f.name.trim().toLowerCase() === lower)) {
    return 'A fleet already has this name — combined pages need their own.';
  }
  if (
    allGroups.some(
      (g) => g.id !== group.id && g.name.trim().toLowerCase() === lower,
    )
  ) {
    return 'Another combined page already has this name.';
  }
  if (group.fleetMode === 'chosen' && group.fleetIds.length === 0) {
    return 'Choose at least one fleet.';
  }
  if (
    group.sectionAxisId != null &&
    !axes.some((a) => a.id === group.sectionAxisId)
  ) {
    return 'This page is sectioned by a field the series no longer has.';
  }
  return null;
}
