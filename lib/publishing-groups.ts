/**
 * Pure helpers for combined published pages (#255). A publishing group names
 * a page that renders several fleets' results as sections of one document —
 * see `PublishingGroup` in `lib/types.ts`. This module resolves the stored
 * group config against the series' live fleets, in one place, so the build
 * path (`buildFleetHtmlFiles`), the publish handler's retraction of
 * suppressed pages, and the publish dialog's reflection all agree on which
 * fleets a group covers and which fleets lose their standalone page.
 *
 * Groups apply only to blockless multi-fleet series: sub-series publish
 * their own (block × fleet) page grid, and a single-fleet series has nothing
 * to combine. Callers gate on that before resolving.
 */

import type { Fleet, PublishingGroup } from './types';

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

/**
 * Ids of fleets whose standalone page is suppressed: members of at least one
 * non-empty group with `publishMembersIndividually === false`. Such a fleet
 * publishes only through its group page(s).
 */
export function suppressedFleetIds(
  groups: PublishingGroup[] | undefined,
  fleets: Fleet[],
): Set<string> {
  const suppressed = new Set<string>();
  for (const { group, fleets: members } of resolvePublishingGroups(groups, fleets)) {
    if (group.publishMembersIndividually || members.length === 0) continue;
    for (const f of members) suppressed.add(f.id);
  }
  return suppressed;
}

/** Human summary of a group's membership for the settings card and publish
 *  dialog, e.g. `all fleets` or `Scratch + HPH`. */
export function describeGroupMembers(resolved: ResolvedPublishingGroup): string {
  if (resolved.group.fleetMode === 'all') return 'all fleets';
  if (resolved.fleets.length === 0) return 'no fleets';
  return resolved.fleets.map((f) => f.name).join(' + ');
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
  return null;
}
