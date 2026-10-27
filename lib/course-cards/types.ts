import type { CatalogueSet } from '@sailscoring/course-cards';

/** Where a captured chart sits: the ground it covers, its size, and who to
 *  credit — everything the renderer needs but the image itself. */
export type CourseChartPlacement = NonNullable<NonNullable<CatalogueSet['map']>['placement']>;

/** A course-cards data set's chart of its club's water, as the app draws a
 *  course on it. */
export interface CourseChart {
  /** The data set it belongs to: "hyc/al-2026". */
  set: string;
  club: string;
  event: string;
  /** The image, under `public/course-cards/`. */
  file: string;
  placement: CourseChartPlacement;
}
