/**
 * The built-in tier of the course library: the clubs' course cards
 * published at courses.sailscoring.ie, vendored into the app at build time
 * by scripts/sync-course-cards.ts. The catalogue is a committed module, so
 * the picker renders with no network call; the marks and card files are
 * fetched on demand from the app's own origin and parsed by the library.
 */

import {
  parseCourseCardFile,
  parseMarksFile,
  type Catalogue,
  type CatalogueCard,
  type CatalogueSet,
  type CourseBackground,
  type CourseCardFile,
  type MarksFile,
} from '@sailscoring/course-cards';

import { COURSE_CARDS_RELEASE, COURSE_CARD_CATALOGUE } from './generated/catalogue';

export { COURSE_CARDS_RELEASE, COURSE_CARD_CATALOGUE };
export type { Catalogue, CatalogueCard, CatalogueSet, CourseBackground };

/** The data sets on offer, as the catalogue lists them. */
export function courseCardSets(): CatalogueSet[] {
  return COURSE_CARD_CATALOGUE.sets;
}

export function findCourseCardSet(path: string): CatalogueSet | undefined {
  return COURSE_CARD_CATALOGUE.sets.find((s) => s.path === path);
}

/** "Howth Yacht Club — Autumn League 2026". */
export function courseCardSetLabel(set: CatalogueSet): string {
  return `${set.club} — ${set.event}`;
}

/** The app-hosted URL of a vendored file, relative to the app origin. */
export function courseCardFileUrl(file: string): string {
  return `/course-cards/${file}`;
}

/** A set's marks file and one of its cards, parsed. */
export interface LoadedCourseCard {
  set: CatalogueSet;
  card: CatalogueCard;
  marks: MarksFile;
  cardFile: CourseCardFile;
}

/** The chart a set captured, as the renderer takes it: the image with the
 *  ground it covers. Everything but the image itself is in the catalogue. */
export function courseBackgroundOf(
  placement: NonNullable<NonNullable<CatalogueSet['map']>['placement']>,
  png: Uint8Array,
): CourseBackground {
  return {
    png,
    bounds: placement.bounds,
    width: placement.width,
    height: placement.height,
    attribution: placement.attribution,
  };
}

/** A set's chart and how to place it, where the pinned release published
 *  both. A release before 0.8.0 lists the image without the ground it
 *  covers, and a course over that set's marks draws on plain ground. */
export function courseChartOf(set: CatalogueSet | undefined): { file: string; placement: NonNullable<NonNullable<CatalogueSet['map']>['placement']> } | undefined {
  return set?.map?.placement ? { file: set.map.background, placement: set.map.placement } : undefined;
}

const marksCache = new Map<string, Promise<MarksFile>>();
const cardCache = new Map<string, Promise<CourseCardFile>>();

async function fetchJson(file: string): Promise<unknown> {
  const res = await fetch(courseCardFileUrl(file));
  if (!res.ok) throw new Error(`course card file ${file}: ${res.status}`);
  return res.json();
}

export function loadMarksFile(set: CatalogueSet): Promise<MarksFile> {
  let p = marksCache.get(set.marks.file);
  if (!p) {
    p = fetchJson(set.marks.file).then(parseMarksFile);
    marksCache.set(set.marks.file, p);
  }
  return p;
}

export function loadCardFile(card: CatalogueCard): Promise<CourseCardFile> {
  let p = cardCache.get(card.json);
  if (!p) {
    p = fetchJson(card.json).then(parseCourseCardFile);
    cardCache.set(card.json, p);
  }
  return p;
}

const backgroundCache = new Map<string, Promise<CourseBackground | undefined>>();

/**
 * A set's captured chart, fetched from the app's own origin and kept for the
 * session — a few hundred kilobytes that every drawing of that club's water
 * reuses. Undefined for a set that captured none, and for a fetch that
 * fails: a drawing without its chart is the plain one, which is worth more
 * than an error.
 */
export function loadCourseBackground(setPath: string): Promise<CourseBackground | undefined> {
  let p = backgroundCache.get(setPath);
  if (!p) {
    const chart = courseChartOf(findCourseCardSet(setPath));
    p = !chart
      ? Promise.resolve(undefined)
      : fetch(courseCardFileUrl(chart.file))
          .then(async (res) => (res.ok ? courseBackgroundOf(chart.placement, new Uint8Array(await res.arrayBuffer())) : undefined))
          .catch(() => undefined);
    backgroundCache.set(setPath, p);
  }
  return p;
}

/** Load a card and its set's marks by their catalogue ids. */
export async function loadCourseCard(setPath: string, cardId: string): Promise<LoadedCourseCard> {
  const set = findCourseCardSet(setPath);
  if (!set) throw new Error(`unknown course card set ${setPath}`);
  const card = set.cards.find((c) => c.id === cardId);
  if (!card) throw new Error(`unknown course card ${cardId} in ${setPath}`);
  const [marks, cardFile] = await Promise.all([loadMarksFile(set), loadCardFile(card)]);
  return { set, card, marks, cardFile };
}
