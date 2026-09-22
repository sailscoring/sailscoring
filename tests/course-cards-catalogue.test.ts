import { parseCatalogue } from '@sailscoring/course-cards';
import { describe, expect, it } from 'vitest';

import {
  COURSE_CARD_CATALOGUE,
  COURSE_CARDS_RELEASE,
  courseCardFileUrl,
  courseCardSetLabel,
  courseCardSets,
  findCourseCardSet,
} from '@/lib/course-cards';

/** The committed catalogue is what the sync script wrote from the pinned
 *  release: it must parse as the library reads a catalogue, and every set
 *  must name a marks file and at least one card. */
describe('the vendored course-cards catalogue', () => {
  it('is the pinned release, and parses as a catalogue', () => {
    expect(COURSE_CARD_CATALOGUE.version).toBe(COURSE_CARDS_RELEASE);
    expect(() => parseCatalogue(JSON.parse(JSON.stringify(COURSE_CARD_CATALOGUE)))).not.toThrow();
  });

  it('lists the clubs’ sets with their marks and cards', () => {
    const sets = courseCardSets();
    expect(sets.length).toBeGreaterThanOrEqual(3);
    for (const set of sets) {
      expect(set.marks.count).toBeGreaterThan(0);
      expect(set.cards.length).toBeGreaterThan(0);
      // A card may print no courses at all — Schull Harbour's does not, and
      // is the marks, the line and the instructions for a course called on
      // the day — but a release where none of them did would be a bad sync.
      for (const card of set.cards) expect(card.courses).toBeGreaterThanOrEqual(0);
    }
    expect(sets.flatMap((s) => s.cards).some((c) => c.courses > 0)).toBe(true);
    const hyc = findCourseCardSet('hyc/al-2026')!;
    expect(courseCardSetLabel(hyc)).toBe('Howth Yacht Club — Autumn League 2026');
    expect(hyc.cards.map((c) => c.id)).toEqual(['offshore', 'inshore']);
  });

  it('serves every file from the app’s own origin', () => {
    expect(courseCardFileUrl('hyc/al-2026/offshore.json')).toBe('/course-cards/hyc/al-2026/offshore.json');
  });

  it('carries what a chart needs to be placed, for every set that has one', () => {
    // The app fetches the image and nothing else: where it sits, how big it
    // is and who to credit all come from here.
    const charted = courseCardSets().filter((s) => s.map?.placement);
    expect(charted.length).toBeGreaterThan(0);
    for (const set of charted) {
      const { background, placement } = set.map!;
      expect(background.startsWith(`${set.path}/`)).toBe(true);
      expect(placement!.width).toBeGreaterThan(0);
      expect(placement!.height).toBeGreaterThan(0);
      expect(placement!.bounds.north).toBeGreaterThan(placement!.bounds.south);
      expect(placement!.bounds.east).toBeGreaterThan(placement!.bounds.west);
      expect(placement!.attribution).toContain('OpenStreetMap');
    }
  });
});
