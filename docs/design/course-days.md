# Course days: courses at the workspace level

The course builder (`docs/design/orc/course-builder.md`, #437) started as a
per-series library of marks and courses that a race start picks from. It has
since gained leg tables, magnetic bearings, chart backgrounds and routing
through a club's passages. What comes next, collecting positions from the
water (horizon: "Course data from the water"), does not fit inside a series.

This note proposes moving courses to the workspace, organised by **day**. It
draws the line that keeps that work within scoring, says what the work could
become outside it, and gives the order of changes.

**Status: proposed** (October 2026).

---

## Why the series is the wrong owner

- **The committee boat's unit is the day, not the series.** One committee
  boat lays one set of marks and runs the starts of several series on them.
  Wherever two series race on the same water on the same day, the same marks
  have to be entered once per series today.
- **The library's names carry the missing date.** Rule 4 has the scorer
  write names like "Z outer — 6 Sep R2". The date is in the name because the
  model has nowhere else to keep it.
- **Time-bound positions belong to the day.** A laid mark has a position
  from the moment it is laid, and it can move during a race. Fixes, wind
  readings and tracks are all about a stretch of water on a particular day.
  None of them belongs to one series.
- **The people are not scorers.** The race officer and the RIB crews record
  what happened on the water. They should not need a series, or a role that
  lets them edit finishes.
- **The outside evidence is organised this way already.** Pat Tanner's pages
  for RCYC store a day's fixes, and its courses keyed by race and start,
  under the race date.

Rule 1 makes the move cheap: the start keeps a snapshot of what it was scored
over, and scoring reads only `RaceStart.courseLegs`. The libraries can move
without touching a single score.

## Options considered

| Option | Verdict |
|---|---|
| Keep the series libraries and add a workspace tier above them (the logo-library shape) | Rejected. Saves re-adopting fixed marks, but fixes and time still have nowhere to live |
| Flat workspace libraries of marks and courses | Rejected. Laid marks are dated, so the date ends up back in the names |
| **A workspace-level day holding the day's marks, fixes and courses** | **Chosen.** Matches the committee boat's paperwork and Pat's data |
| A separate app now | Not yet: see "If it moves out" for what has to be true first |

## The model

A **course day** is one date on one course area. Most clubs have a single
area, so "Sun 27 Sept · Outer harbour" is enough to identify one. It holds:

- **The day's marks.** Each has a name and a **kind**: laid, moored race
  mark, charted navigation mark, committee boat, pin, or routing waypoint.
  Kind and position source are separate properties (Pat's point on
  course-cards #19). Fixed marks still arrive from the club's card.
- **Fixes.** A mark holds a list of fixes. Each fix has a position, the
  position's own time, the time of the tap that asked for it, an accuracy,
  and a source (a RIB link, a phone, typed in, the card, or derived from a
  track). Keeping both times makes the age of every position measurable
  afterwards: on 4 October 2026 half of Pat's RIB fixes were between 24
  seconds and 12.5 minutes old when saved. The scorer can pin any fix, or go
  back to the automatic choice.
- **Lines.** A start or finish line has two ends, committee boat and pin, and
  legs are measured from its midpoint. A card's single start mark stands in
  until both ends are recorded.
- **The day's schedule.** Race numbers, the starts in each race, the classes
  in each start, and start times. The race officer works in these terms, and
  time-binding needs the start time.
- **Courses.** A course is a mark sequence or a leg table, as now. It is
  attached to a race and start of the schedule, or kept in the day for reuse.
- **Observations.** Wind (and optionally current) readings over the day, and
  later the evidence derived from competitors' tracks.

**Resolution** turns a day's course into what a start is scored over. These
rules are Pat's, proven on the water:

- A laid mark takes the newest fix with exactly its name that was recorded
  before the start. Failing that, it takes the card position, flagged as a
  planning position.
- A moored or charted mark takes its charted position.
- A near-miss name is suggested and never applied automatically.
- A mark moved during a race keeps both positions, and each rounding uses the
  one in place when it was rounded.

The output is the waypoints, routed legs and wind that a series start
snapshots, in the format described under "The course record" below.

**The series side barely changes.** A start's snapshot records the day and
course it came from instead of a series-library course id. The "course
changed since" badge and the explicit recompute work exactly as they do now.
The start dialog's course picker lists the courses of the race's day first.
Its "New course…" creates the course in that day, creating the day if there
isn't one.

## The line: scoring, not race management

> **Sail Scoring keeps the record of what was sailed. It does not help run
> the race.**

Something is in scope if it establishes a fact that a score or a published
result depends on, or if it is evidence for checking or challenging such a
fact. Those facts are the positions in force, the course each start sailed,
the distances and bearings, the wind over each leg, and when boats crossed
the lines. Anything whose purpose is to change what happens on the water is
out of scope.

Three tests settle most cases:

1. **Direction and purpose.** Data flowing from the water into the record is
   in. A message from the app back out to the water is out when its purpose
   is the race: where to lay a mark, the course sent to competitors, live
   positions. It is in when its purpose is the record. Asking a RIB to
   record a doubtful mark again is a request for evidence, not a race
   instruction.
2. **Would a hearing need it?** Suppose it were deleted once the results were
   final. If a protest committee, a scorer handling a redress request, or a
   competitor checking a distance could have needed it, it is part of the
   record.
3. **After the fact, for a reader.** A number computed from the record and
   shown with the results is presentation, and is in. The same number shown
   live to a race officer as advice is out.

| Feature | Side of the line |
|---|---|
| Recording mark fixes, committee boat, pin | In: evidence |
| Checking the day's fixes, with advisory flags (an old position, a pin within 60 m of a mark, a line far off square to the first leg, the same mark 500 m apart in two races) and a message asking for a re-record | In: quality control of the record. Flags never block anything |
| Moved marks, time-bound positions | In: changes scored distance |
| Two-ended lines, legs from the midpoint | In: changes scored distance |
| Wind readings feeding the ORC leg wind | In: scoring input |
| Competitor tracks, for closest approach to each mark, line crossings, clock offset, and wind from tacking angles | In: evidence. **Never changes a score by itself.** NSC, OCS and DSQ stay decisions for the scorer or the protest committee |
| Line length, bias and squareness shown on the results page | In, as a description of the race. Low priority |
| "Move the windward mark 38 m towards 190°M" | Out: advice to the water |
| Mark moves to restore a beat after a wind shift | Out |
| Sending the course to competitors (WhatsApp message, digital course board) | Out. A plain-text export of the record is fine, and so is the RIB crew's backup message of their own fixes |
| Start sequence timer, signals, recalls | Out |
| Speed, VMG, replays, performance against polars | Out. Consistent with the RaceSense metrics (displayed when a device computed them, never computed here) and with horizon's sector-analysis entry |
| Live mark roundings feeding projected standings | In. It is scoring, and it is already in horizon |

Pat's race officer page sits on both sides. Building and checking the course
record is in. Squaring the line and re-laying marks are out. The roadmap
below builds only the first half.

## The course record

The handover between a course day and a series start should be a documented,
versioned format, whether the day lives in Sail Scoring or somewhere else.
It belongs in `@sailscoring/course-cards`, which is already MIT, already
versioned, and already a dependency of both the app and Pat's tools.

One record describes one start's course:

```
course record v1
  race        date, course area, race number, start number, classes, start time
  reference   bearings stored true; variation, model, position and date used
  marks       id, name, kind, position, and the fix it came from
              (time, accuracy, source)
  lines       start and finish: committee boat + pin, or a single mark
  sequence    mark ids with side and rounding or passing; which fix each
              rounding used
  legs        from, to, distance (0.01 NM), true bearing, wind direction and
              speed, current, routed-via waypoints
  provenance  producing app, URL, version, generated-at
```

This replaces the ad-hoc shapes in today's snapshot, the paste box, and the
`courses[]` entries of the public export. A bare leg table is a record with
only `legs`. A leg table with one known point (an anchor, as Pat proposes) is
a record whose single mark locates the rest. Pat's WhatsApp text, and the
paste format he proposed, become plain-text renderings of the same record,
so it survives a phone message.

## Roadmap

The steps are ordered so that each one is useful on its own, and so that
nothing is built on the series libraries that the move would then have to
port.

**1. Course record and import (small, now).** Add the format to course-cards.
In the start dialog, add "Import course…", which takes a record pasted,
uploaded or fetched from a URL. The start keeps the record as its snapshot,
plus the source and a content hash. Anchored leg tables come with it. Ask Pat
to have his course page emit records; he has offered to change its output.
That gives the RCYC trial a clean route in while everything below is built.
This step settles the series side for good, whichever way the rest goes.

**2. Lines with two ends (small, now).** Course-cards and the app both learn
committee boat + pin, with legs measured from the midpoint. The 27 September
proof of concept showed the first and last legs 5° and 11° off when measured
from the committee boat, so this changes scored distances, not only the
drawing. It goes in before the move because both models need it.

**3. The workspace Courses tab (the move; medium–large).**
- New `course_days` tables: the series library tables re-parented to a day,
  with mark kind added.
- A **Courses** tab in the workspace tab bar, with days listed by date. A
  day's page is today's series Courses tab plus the schedule.
- The start dialog picks from days. Snapshots carry `{day, course}`.
- A new `manage-courses` permission, which owners, admins and scorers all
  get. Today a scorer can't save a course made from the start dialog,
  because the library needs `manage-series` (#665).
- Migration: each series library becomes days. A course goes to the race
  date of the starts that used it, and an unused entry goes to the series'
  first race date. A dry-run report is a named script. Scores can't move,
  because scoring reads the snapshot.
- Series file v66 and public export v9 stop carrying a library, and starts
  carry their course record. Readers keep every older version (ADR-013).
  Importing an older file puts its library into days, so nothing is lost.
- The series Courses tab becomes a read-only list of the starts and the
  courses they used, each linking to its day.
- Build it as a spin-out-ready module, `lib/course-kit/` in the
  `archive-kit/` mould. The series reaches it only through the course record.
- An ADR for the move and the contract.
- This is also the point to decouple courses from the `orc` gate. A located
  drawing on the results page is worth having for any fleet, and
  time-on-distance needs the distance.

**4. Fixes and time-bound positions (medium).**
- Fixes on day marks, the resolution rules above, pinning, and a
  per-rounding choice for a moved mark.
- The scorer types or pastes fixes first, including from a WhatsApp backup
  message. That is the shore-side workflow that exists today, and it needs
  no new people.
- Pat's "check the day's fixes" goes here: a read-only plot of a race's or
  the whole day's fixes. Tapping one shows its details and how old the
  position was when saved. Typed positions are drawn as estimates, and the
  flags in the table above are advice only.
- The day's page is used ashore at a desk, so the wide layout comes first.

**5. A race-officer role and the day on a phone (medium).** Add a
`race-officer` role with `read` and `manage-courses`, invited like any member
(Phase 10's UI). The day's page gets a mobile layout: "Record committee boat
here" from the phone's GPS, the schedule, building the course, and the leg
table with total, accuracy warnings, and labels on hops not checked for
depth. It needs a signal for now. Linking the schedule to series starts by
date, race number and class is suggested, and the scorer confirms it.

**6. RIB links that need no account (medium–large).** Per-day capability
links:
- Each link is labelled per RIB, stored hashed, expiring and revocable.
  Revoking a link quarantines its fixes.
- The link opens a narrow offline page: a service worker scoped to that one
  route, a queue on the phone, and a client-generated fix id so retries are
  harmless (the `Idempotency-Key` pattern).
- **Only a fresh position is saved.** Android Chrome can return the last
  known position even when asked for a new one. Pat's rules handle this:
  - A position more than 5 s older than the tap is ignored.
  - A fresh position at ±5 m or better is saved at once. Otherwise the best
    fresh one is saved after 10 s, and nothing is saved after 20 s.
  - The page shows "hold still" while waiting.
  - The page explains a refusal caused by the phone's clock being out.
  - Still open: a RIB still closing on the mark.
- Re-record requests from the fixes check (step 4) arrive at the RIB link.
- The RIB crew can produce a WhatsApp backup of their own fixes.
- The race officer's view refreshes itself and raises alerts: a mark moved,
  two phones disagreeing about one mark, a link revoked, the refresh stopped.

Pat's offline queue and service-worker rules are MIT, worked out on the
water, and worth porting rather than reinventing. This step replaces his
shared race key, which anyone who loads the page can read.

**7. Competitor tracks (large; needs a privacy decision first).**
- A track link per day, and later a "Submit your track" link from the
  published page. A track is bound to an entry by sail number on the day.
- GPX first. Parsing happens in the browser.
- The evidence kept: closest approach per rounding, start and finish
  crossings, the clock offset, rounding times, and wind from tacking angles.
  Each is shown overlaid on the day, with "fleet passed well clear" flagged.
- Raw tracks are kept only with the sailor's consent, are visible to the
  scorer and race officer only, and are deleted after a retention period.
  The Privacy Policy update goes in the marketing repo, and Vercel Blob
  (private) holds the files.

**8. Wind and current (medium).** An observation log on the day: entered on
the committee boat first, then from RIBs, then from instruments or a weather
station. Each leg's wind comes from the observations over that leg's time.
The time comes from track rounding times when there are tracks, otherwise
from the start time. This fills the recorded-wind ORC options, with the
source shown.

**9. Publishing the evidence (small–medium).** The results page shows the
located drawing with laid positions and fix times. The ADR-012 sidecar
carries each start's course record. A published day page is optional.

Timing: while the autumn leagues are running, only steps 1 and 2 touch the
race-day path. Step 3 is a restructure for the gap between leagues. Steps 5
and 6 need on-water testing, so a winter series is the next chance.

## If it moves out

What this could become without the scoring constraint is **the race
committee's app**. It would cover before, during and after the race:

- **Planning:** a course-card designer, routing validated against depth data
  (Pat's workbook method as a tool), forecast-led course choice, and leg
  lengths sized to a target race time from the fleet's ORC polars.
- **Laying:** RIB guidance to a target position ("steer 190°, 380 m"), with
  the drop recorded as the fix.
- **Starting:** line squaring and bias, a sequence timer, and OCS from line
  crossings.
- **During the race:** mark moves on a shift, shortening, and safety-boat
  positions.
- **Communicating:** a digital course board on competitors' phones, replacing
  VHF and WhatsApp.
- **Afterwards:** replays, leg and sector analysis, performance against
  polars, and a shared regional register of marks (Cork harbour's buoys are
  used by more than one club, course-cards #13).

The audience changes from one scorer per club to race officers, mark layers
and every competitor. The work becomes real-time, mobile, offline and
hardware-integrated, and it competes with tracking and race-management
products. It is a different product. course-cards, with its own catalogue,
is the natural seed for it.

**How a scorer would import from it.** Through the course record, which is
why step 1 comes first. In order of integration:

1. **Paste.** The plain-text or JSON record into "Import course…". This
   works between any two apps.
2. **A link.** The start keeps the record's URL and hash. Sail Scoring
   re-fetches it and shows "course changed since", exactly like today's
   library badge, and recompute stays explicit.
3. **An inbox.** The external app pushes records into a workspace through
   the `/api/v1` keyed client (ADR-009). The importer matches them to series
   starts by date, race number and classes, and the scorer confirms.

In the other direction, the external app reads the entry list and start times
through the same API, to bind tracks to boats. If step 3 is built against the
course record, moving out later changes the transport and nothing in the
series.

**When to move it out.** Not while the line above holds. Moving out would
duplicate auth, workspaces, roles and publishing for users who are already
here. Any of these would change that:

- Users ask for out-of-scope features, such as squaring and the course
  board, often enough to justify a second product.
- Race officers at clubs that score in Sailwave or HalSail want it. They
  would need export to those tools, and the app would then be a separate
  product in all but name.
- Real-time on-water requirements start to bend the scoring app's
  architecture.
