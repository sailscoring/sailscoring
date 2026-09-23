# RaceSense — the regatta API

In September 2026 Vakaros replaced the player with a new viewer, the
**RaceSense Race Replayer**, and the new one reads the regatta a
different way. There is no Firebase in it at all — no SDK, no web key in
the page bundle, no call to `identitytoolkit` or `firestore.googleapis.com`.
It reads through an endpoint of its own:

```
GET https://player.vakaros.com/api/regatta?event={regattaId}
```

No credential of any kind. This note describes what that answers, as
observed on 2026-09-22 and 2026-09-23 from three regattas: the Melges 24
Worlds (`i6WfokvPgVWlOVwyaaer`), the ILCA 6 Worlds Final
(`sRFoNUwGjwnyCUiY3FsN`) and the ILCA 7 Worlds Elimination Series
(`5JsqWPmBU6P7G5rk15ic`).

[`player-document.md`](player-document.md) describes the Firestore
document the import read until now, and stays the record of that route
and of how the document maps to the committee's workbook. The two carry
the same regatta — every finish and every start agreed exactly across
the four races of the ILCA 6 Worlds Final — so that mapping holds here
and is not repeated. This note is about the differences. Moving the
import onto this endpoint, and dropping the Firestore route, is
[**#632**](https://github.com/sailscoring/sailscoring/issues/632).

It is no more a published API than the Firestore read was. It is
Vakaros's to change; the difference is that this one is what their own
viewer depends on, so it breaks when their product breaks.

## Why it replaces the Firestore route

- **No key.** `RACESENSE_PLAYER_WEB_KEY` and the anonymous sign-in that
  used it both go away, along with a deployment that can't read because
  a key wasn't configured.
- **Two orders of magnitude smaller.** The Firestore document is about
  10 MB, most of it per-boat positions the import never reads. The same
  regattas here: 65 KB (Melges 24 Worlds, one division of 54), 105 KB
  (ILCA 6 Worlds Final, three divisions), 694 KB (ILCA 7 Worlds
  Elimination Series, three divisions of six races). Under a second,
  against a read that needed a 60-second budget.
- **Plain JSON.** Values are values, not Firestore's typed wrapper, so
  integers are integers rather than strings in `integerValue`.

## The envelope

```
{ eventId, source: "firestore-snapshot", revisions: [ { validFrom, doc } ] }
```

The endpoint answers a **history** of the event's metadata rather than
its current state, because two things the committee edits are
overwritten in place — the course and the entry list — and reading the
current state draws race 1 against race 4's marks. Every regatta read so
far has one revision with `validFrom: null`; the viewer's own comment
says the shape is for a metadata API Vakaros has yet to ship.

The rule the viewer applies, which a reader here should match: for the
current state take the **last** revision; for an instant take the last
revision whose `validFrom` is null or at or before it, and for an
instant before them all take the first. Starts and finishes accrue, so
the current revision is the one to score from.

## The document

```
doc:         name, startDate, endDate, raceSenseEvent, divisions[]
division:    name ("Gold"), boatClass ("ILCA"), startLength, boatShapeId,
             participants[], courses[], races[]
participant: sailNumber, boatName, bowNumber
race:        raceNumber, isPractice, timezoneOffset (µs), endTime,
             starts[], finishes[]
start:       startNumber, startTime, stopReason, prepFlag, startLine,
             checkedInParticipants[], ocsParticipants[],
             exoneratedParticipants[], clearedOcs[], startingStats[],
             exonerationEnabled, gpsCorrectionType, gpsCorrectionAge, id
finish:      sailNumber, finishingTime, maxSpeed (knots),
             distanceTraveled (m), heading, positionAtFinish,
             lineLeftLocation, lineRightLocation, lineLeftAge,
             lineRightAge, mask, serialNumber, raceNumber
```

Field names and meanings are the document's, so everything
[`player-document.md`](player-document.md) says about divisions being
split fleets, about several `starts[]` meaning general recalls with the
last one the start that ran, and about `stopReason` being `finished` on
a start that ran to the finish, holds unchanged.

## Timestamps arrive in four shapes

This is the part to get right. Instants are normalised to epoch
milliseconds in some places and left as the document wrote them in
others, and a reader has to take all of:

| Shape | Example | Where |
|---|---|---|
| Epoch ms, integer | `1789207501000` | `startTime` on a start; `startDate`, `endDate` |
| RFC 3339 with `Z` | `"2026-09-12T11:11:28.983162Z"` | `finishingTime`, race `endTime` |
| **ISO with no zone** | `"2026-09-12T11:05:01.000"` | `startTime` on a `startingStats` row |
| `{seconds, nanoseconds}` or `{_seconds, _nanoseconds}` | — | not yet observed here; the viewer's decoder accepts it |

The third is a trap. `Date.parse` reads a zone-less ISO datetime as
**local time**, and this one is not local to the reader — it is the
race's own local time, the start shifted by the race's `timezoneOffset`.
For ILCA 6 Gold race 1 the start is `1789207501000`, which is
`10:05:01Z`, and the `startingStats` rows say `2026-09-12T11:05:01.000`,
an hour later, because that race's `timezoneOffset` is +1 h. Parsed in
Ireland in September that string reads back as `10:05:01Z` and looks
right; parsed anywhere else, or in January, it doesn't. It is the same
shape of mistake as the hour-early finishing times of
[#459](https://github.com/sailscoring/sailscoring/issues/459).

Nothing scored depends on it — the import reads `dtlMm` from those rows
and not their time — but a reader that normalises timestamps generically
will walk into it.

The **one-second lag on the gun** documented for the Firestore route
holds here too, and is now checked against more of them: all 25 starts
across the three regattas are exactly one second past the minute. The
flooring rule stands.

## `raceNumber` inside a row is not the race number

`finishes[]` and `startingStats[]` rows each carry a `raceNumber`, and
it is a per-device field that cannot be used as a key. Across the three
regattas it is variously `0`, the race's own number, the number of a
**previous** race the device still had, or — on the Melges 24 race that
was recalled — the **start** number rather than the race number. The
ILCA 7 Gold races carry two different values in a single race's finish
list.

The race a finish belongs to is the `finishes[]` array it is in. Nothing
should group by the field.

## The `mask` on a finish

Each finish row carries `mask: { value }`, a bitfield saying what the
device actually acquired: bit 0 gates `maxSpeed` and `distanceTraveled`,
bit 1 gates `heading`, and `0` means nothing was. The viewer honours it
and reads those figures as null when the bit is clear.

In practice it is nearly always 15. Of 918 finish rows across the three
regattas, 917 are 15 and one is 1 (heading not acquired); none has bit 0
clear and none is missing the mask. So it is a note rather than a
redesign — but a row with bit 0 clear would otherwise print a max speed
and a distance of whatever the device last held.

## What it doesn't carry

Four fields the Firestore document has are absent, three of them
mattering:

| Absent | What to do |
|---|---|
| `currentStage` | Substitute `endTime != null`. That is what the viewer does (`_inProgress: !endIsReal`), and it agrees with `currentStage` on every race checked, including one read mid-race: the race on the water had no `endTime` and its start no `stopReason`. |
| `protestingBoats` | Lost. It feeds `protest:` on every starter row. |
| `modifiedTs`, `sequenceNumber` | Lost. These are the freshness note — "the committee's device last wrote the regatta at 11:35:38 … (update 11)" — which is what tells a scorer mid-championship whether a re-read is worth doing. |
| `fleetIndex` | Nothing. It is read into the model and never used downstream. |

Also absent and unread: `fleetId`, race `name` and `customRaceName`,
`networkRaceNumber`, the race and division `id`s, and the division's
device settings (`ocsEnabled`, `markZoneEnabled`, `useCog` and the
rest).

Going the other way, the endpoint carries per-finish and per-start
geometry the Firestore capture prunes: `positionAtFinish`, `heading`,
the line ends and their ages, `serialNumber`, and the division's
`courses[]`. The device serials are identifiers, and a capture kept in
the repo should prune them as the Firestore captures do.

## Division keys in the new deep links

The viewer's URLs changed what their division segment means, which
matters to anything parsing a link a scorer pastes. It is now the
division's **boat class**, and when two divisions of a regatta share a
class the name is appended:

| Regatta | Division in the document | Segment in the URL |
|---|---|---|
| Melges 24 Worlds | `M24` (class `Melges 24`) | `Melges 24` |
| ILCA 6 Worlds Final | `Gold`, `Silver`, `Final` (all class `ILCA`) | `ILCA Gold`, `ILCA Silver`, `ILCA Final` |

Three link forms name an event and a division, in the viewer's order of
precedence — path, then query, then hash:

```
/watch/{eventId}/{division}          the canonical form the share button emits
/?event={eventId}&division={division}    the escape hatch for a division with a slash
/#event={eventId}&division={division}    legacy; links to it have been shared
```

Race, day, boat and tab are view state and ride in the hash
(`#day=2026-09-22&race=2`). `/admin`, `/umpire` and `/organizer` are the
same path shape with the first segment swapped.

Matching only on the division name is
[#631](https://github.com/sailscoring/sailscoring/issues/631): with the
name alone, a pasted Silver link resolves to no division and the import
falls back to the first one.

## teleapi, alongside

The viewer's other source is `https://teleapi.regatta.app`, also open
and unkeyed, and the one that serves the replay's telemetry. Its

```
GET /telemetry/racing-summary/{eventId}
```

answers per-race `begin`, `start`, `end` and `start_number` per
division. Useful for corroborating a race's window; it carries no finish
times, so nothing scoring needs it. Its division label is a third
spelling — the division's **name** with dots as `//` and spaces as `_` —
and the viewer probes both that and the boat class because race control
uploads under one or the other.

Worth knowing for reading the viewer, not for the import: the summary is
a `GROUP BY` over every row of the event and takes tens of seconds on a
championship's fourth day.

## What neither route gives

Unchanged from the Firestore document, and worth restating because it is
the boundary of the whole import: no result code other than OCS and DNF.
The jury's work still comes from the race committee.
