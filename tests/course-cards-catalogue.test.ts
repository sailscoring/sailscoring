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
      for (const card of set.cards) expect(card.courses).toBeGreaterThan(0);
    }
    const hyc = findCourseCardSet('hyc/al-2026')!;
    expect(courseCardSetLabel(hyc)).toBe('Howth Yacht Club — Autumn League 2026 (draft cards)');
    expect(hyc.cards.map((c) => c.id)).toEqual(['offshore', 'inshore']);
  });

  it('serves every file from the app’s own origin', () => {
    expect(courseCardFileUrl('hyc/al-2026/offshore.json')).toBe('/course-cards/hyc/al-2026/offshore.json');
  });
});
