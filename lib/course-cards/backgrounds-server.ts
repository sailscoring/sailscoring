import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { courseBackgroundOf, findCourseCardSet, type CourseBackground } from './index';

/**
 * A data set's captured chart, read off disk rather than fetched.
 *
 * In-app publishing renders its pages on the server, so the chart a course
 * is drawn on has to be there too. The images are vendored into
 * `public/course-cards/` by scripts/sync-course-cards.ts at build time; this
 * reads them from `process.cwd()` the way lib/sample-series/seed.ts reads the
 * sample files, and the `outputFileTracingIncludes` glob in next.config.ts is
 * what ships them into the publish route's bundle.
 *
 * Failure is not an error: a page whose chart could not be read draws the
 * course on plain ground, which is what it drew before there were charts at
 * all. Publishing is the irreversible step, and it is not the place to fail
 * over an illustration.
 */
const cache = new Map<string, Promise<CourseBackground | undefined>>();

export function readCourseBackground(setPath: string): Promise<CourseBackground | undefined> {
  let p = cache.get(setPath);
  if (!p) {
    const set = findCourseCardSet(setPath);
    p = !set?.map
      ? Promise.resolve(undefined)
      : readFile(join(process.cwd(), 'public', 'course-cards', set.map.background))
          .then((png) => courseBackgroundOf(set, new Uint8Array(png)))
          .catch((err: unknown) => {
            console.warn(`course-cards: no chart for ${setPath}:`, err);
            return undefined;
          });
    cache.set(setPath, p);
  }
  return p;
}
