/**
 * Activity action vocabulary and the pure `activityKind` mapping (#153).
 *
 * Client-safe (no `server-only`): the write seam and read queries live in
 * `lib/activity-log.ts`, but the action strings and the icon-grouping helper
 * are needed by the client Activity surfaces too, so they live here.
 */

/**
 * The action vocabulary. Coarse and stable; surfaces key icons/grouping off
 * `activityKind(action)`, and an unknown string degrades gracefully rather
 * than throwing, so a newer server writing an action an older client doesn't
 * recognise never crashes the feed.
 */
export const ACTIVITY_ACTIONS = [
  'series.created',
  'series.updated',
  'series.archived',
  'series.unarchived',
  'series.recategorized',
  'series.deleted',
  'series.restored',
  'series.purged',
  'series.copied',
  'series.imported',
  'series.created-follow-on',
  'series.reverted',
  'competitors.imported',
  'competitors.handicaps_updated',
  'competitors.cleared',
  'competitor.updated',
  'competitor.deleted',
  'fleet.updated',
  'fleet.deleted',
  'fleets.cleared',
  'race.added',
  'race.updated',
  'race.deleted',
  'races.cleared',
  'races.reordered',
  'sub-series.created',
  'sub-series.renamed',
  'sub-series.updated',
  'sub-series.deleted',
  'sub-series.cleared',
  'finishes.recorded',
  'finishes.entered',
  'finishes.cleared',
  'finish.deleted',
  'starts.updated',
  'starts.cleared',
  'ratings.updated',
  'ratings.cleared',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type ActivityKind =
  | 'series'
  | 'competitor'
  | 'fleet'
  | 'race'
  | 'finish'
  | 'other';

/**
 * Maps an action to its display kind (drives the icon/colour on the Activity
 * surfaces). Pure and total: any unrecognised action — including a future one
 * this build predates — falls back to `'other'`.
 */
export function activityKind(action: string): ActivityKind {
  if (action.startsWith('series.')) return 'series';
  if (action.startsWith('competitor')) return 'competitor';
  if (action.startsWith('fleet')) return 'fleet';
  if (action.startsWith('finish')) return 'finish';
  if (action.startsWith('race') || action.startsWith('sub-series.') || action.startsWith('starts.') || action.startsWith('ratings.')) return 'race';
  return 'other';
}
