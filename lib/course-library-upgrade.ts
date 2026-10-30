// Bring a series stored before series-file v71 and public-export v11 up to
// the current shape, under ADR-013: those versions removed the course
// library behind ORC constructed courses.
//
// A stored series can still carry the library, and starts whose course was
// picked from it — in a `.sailscoring` file, a revision snapshot, a Trash
// tombstone or a published data file — so every entry point that reads one
// of those passes it through here, and migrations 0123 and 0126 do the same
// for the rows the database holds. Each removed value is one of:
//
//   lossless        the library's marks and courses, which nothing scored
//                   reads, and the library course a start was picked from:
//                   dropped
//   presentational  a start's waypoints — the marks' positions and how they
//                   were rounded — which only the drawing and a recompute
//                   read: upgraded to the start's own legs, anchored where
//                   the first waypoint is (for a line its midpoint, which
//                   the legs were measured from), and, where those legs are
//                   the waypoints' own one for one and were never edited,
//                   each named after the marks it runs between. The drawing
//                   then walks the legs from there, on the same water, and
//                   loses the marks' labels, sides and line ends.
//   scoring         none: the start's legs are what is scored, and they are
//                   kept as they are, so nothing is refused or rescored.

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The longest name a start keeps for a leg. */
const MAX_LEG_NAME = 80;

/** "Cage – Harp": a leg named after the marks it runs between, shortened
 *  where it is longer than a leg's name can be. */
export function legNameBetween(from: string, to: string): string | undefined {
  if (!from.trim() || !to.trim()) return undefined;
  const name = `${from.trim()} – ${to.trim()}`;
  return name.length > MAX_LEG_NAME ? `${name.slice(0, MAX_LEG_NAME - 1)}…` : name;
}

/**
 * One start's course brought forward, in place: `start.course` loses the
 * library course it was picked from and its waypoints, and a course that
 * had waypoints gains an anchor and the legs it gave, with `courseLegs`
 * named where they are the waypoints' own. A course with no waypoints — a
 * leg table, or an imported course — keeps everything else as it was.
 *
 * Reads the shape both a `.sailscoring` file and a public export give a
 * start: the export names the library course `course` rather than
 * `courseId`, and its waypoints are otherwise the file's.
 */
export function upgradeStartCourse(start: Raw): void {
  const course = obj(start.course);
  if (!course) return;
  delete course.courseId;
  delete course.course;
  const waypoints = Array.isArray(course.waypoints) ? course.waypoints.map(obj) : [];
  delete course.waypoints;
  const first = waypoints[0];
  if (!first || !isNumber(first.lat) || !isNumber(first.lng)) return;
  if (course.anchor === undefined) course.anchor = { lat: first.lat, lng: first.lng };

  // An edited start keeps `legsEdited` and has no legs to measure an edit
  // against, so it reads as edited for good.
  const legs = Array.isArray(start.courseLegs) ? start.courseLegs.map(obj) : [];
  if (course.legsEdited === true || legs.length === 0 || legs.some((l) => !l)) return;
  if (course.legs === undefined) {
    course.legs = legs.map((l) => ({ distanceNm: l!.distanceNm, bearingDeg: l!.bearingDeg }));
  }
  // A course routed through a passage sailed more legs than it had marks to
  // name them by.
  if (legs.length !== waypoints.length - 1) return;
  legs.forEach((leg, i) => {
    if (leg!.name !== undefined) return;
    const from = waypoints[i]?.label;
    const to = waypoints[i + 1]?.label;
    const name = typeof from === 'string' && typeof to === 'string' ? legNameBetween(from, to) : undefined;
    if (name) leg!.name = name;
  });
}

/** A whole stored series brought forward, in place: the library dropped,
 *  and every start's course upgraded. Takes a `.sailscoring` file or a
 *  public export, which both hold their starts under `races[*].starts`. */
export function upgradeCourseLibrary(stored: Raw): void {
  delete stored.marks;
  delete stored.courses;
  if (!Array.isArray(stored.races)) return;
  for (const race of stored.races) {
    const starts = obj(race)?.starts;
    if (!Array.isArray(starts)) continue;
    for (const start of starts) {
      const s = obj(start);
      if (s) upgradeStartCourse(s);
    }
  }
}
