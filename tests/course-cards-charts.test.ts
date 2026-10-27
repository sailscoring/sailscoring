import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  COURSE_CARDS_RELEASE,
  COURSE_CHARTS,
  courseBackgroundOf,
  courseCardFileUrl,
  findCourseChart,
} from '@/lib/course-cards';

/** The committed list of charts is what the sync script wrote from the
 *  pinned release: one per data set that captured its water, each saying
 *  where it sits and who to credit. */
describe('the vendored course-cards charts', () => {
  it('are the pinned release’s', () => {
    expect(COURSE_CARDS_RELEASE).toBe(
      readFileSync(join(__dirname, '..', 'lib', 'course-cards', 'dataset-version.txt'), 'utf8').trim(),
    );
    expect(COURSE_CHARTS.length).toBeGreaterThanOrEqual(3);
    const hyc = findCourseChart('hyc/al-2026')!;
    expect(hyc).toMatchObject({ club: 'Howth Yacht Club', event: 'Autumn League 2026' });
    expect(findCourseChart('nowhere/never')).toBeUndefined();
  });

  it('serve every image from the app’s own origin', () => {
    expect(courseCardFileUrl('hyc/al-2026/map/background.png')).toBe('/course-cards/hyc/al-2026/map/background.png');
  });

  it('carry what a chart needs to be placed', () => {
    // The app fetches the image and nothing else: where it sits, how big it
    // is and who to credit all come from here.
    for (const chart of COURSE_CHARTS) {
      expect(chart.file.startsWith(`${chart.set}/`)).toBe(true);
      expect(chart.placement.width).toBeGreaterThan(0);
      expect(chart.placement.height).toBeGreaterThan(0);
      expect(chart.placement.bounds.north).toBeGreaterThan(chart.placement.bounds.south);
      expect(chart.placement.bounds.east).toBeGreaterThan(chart.placement.bounds.west);
      expect(chart.placement.attribution).toContain('OpenStreetMap');
    }
    const png = new Uint8Array([1, 2, 3]);
    const { bounds, width, height, attribution } = COURSE_CHARTS[0].placement;
    expect(courseBackgroundOf(COURSE_CHARTS[0], png)).toEqual({ png, bounds, width, height, attribution });
  });
});
