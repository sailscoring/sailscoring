/**
 * The course-cards data sets' routing overlays: local knowledge of which
 * legs between a set's marks the straight line will do, and the passages a
 * fleet sails round the ones it won't (Ringabella to Cage goes by W2 and
 * Rams Head, not across the headland). Vendored with the catalogue by
 * scripts/sync-course-cards.ts, and kept apart from it so the course
 * geometry can read an overlay without pulling in the whole catalogue.
 */

import type { RoutingFile, Waypoint } from '@sailscoring/course-cards';

import { COURSE_ROUTING } from './generated/routing';

export interface CourseRouting {
  routing: RoutingFile;
  /** The marks the overlay's passages turn at, where the release places
   *  them — for a course or a snapshot that never visits them itself. */
  turnAt: Waypoint[];
}

/** A set's routing overlay, where somebody has written one. */
export function courseRoutingFor(set: string | undefined): CourseRouting | undefined {
  return set ? COURSE_ROUTING[set] : undefined;
}
