# RaceSense player — the regatta document

The **RaceSense player** (`player.vakaros.com/watch/{regattaId}/{division}`)
is a replay viewer over one document per regatta, and that document holds
the record the `RaceSense-Report` workbook
([`import-format.md`](import-format.md)) is exported from. Reading it
directly imports a race the moment the committee finishes it, without
waiting for an export. The import design is
[**#495**](https://github.com/sailscoring/sailscoring/issues/495);
`lib/racesense-regatta.ts` reads the document and
`lib/racesense-player.ts` fetches it.

These notes describe the document as observed in September 2026, from the
ILCA 7 Worlds 2026 Elimination Series and Finals regattas (`schemaVersion`
4, divisions at 5). It is Vakaros's to change, and nothing here is a
published API — the app reads it through the player's own public web key
and a rules setup that lets any signed-in user read any regatta. When that
changes the read fails with a sentence saying so, and the workbook export
is the fallback.

## Getting the document

- The regatta id is the second path segment of the watch URL. Championship
  exports also print it on every sheet as `Regatta ID`, which ties a
  workbook to its document.
- One anonymous sign-in, then one GET of
  `regattas/{regattaId}` from the Firestore REST API as that user. The
  whole regatta — every division, every race — comes back as one document,
  about 10 MB for three divisions of 47 boats and six races, most of it
  per-boat positions the import doesn't read. Track data proper (the GPS
  frames) is elsewhere and not needed.
- `pnpm racesense:inspect <player URL> --save capture.json` reads it and
  keeps a copy pruned of positions and device identifiers, which is also
  what the test fixture is.

## Shape, in the terms the workbook uses

```
regatta:     name, startDate, endDate, modifiedTs, sequenceNumber, divisions[]
division:    name ("Gold"), fleetIndex, boatClass, participants[], races[]
participant: sailNumber, boatName, bowNumber
race:        raceNumber, name, currentStage, isPractice, timezoneOffset (µs),
             endTime, protestingBoats[], starts[], finishes[]
start:       startNumber, startTime (UTC), stopReason, prepFlag,
             checkedInParticipants[], ocsParticipants[],
             exoneratedParticipants[], clearedOcs[],
             startingStats[] { sailNumber, dtlMm }
finish:      sailNumber, finishingTime (UTC, ms), maxSpeed (knots),
             distanceTraveled (m)
```

A **division** is a split fleet. A race with several entries in `starts[]`
had general recalls; the last is the start that ran. `currentStage` is
`finished` once the committee has finished the race; `stopReason` on a
start is `finished` when it ran to the finish.

## How it maps to the workbook

Verified row by row against the Gold workbook exported from the same
regatta (six races, 47 boats): `tests/racesense-regatta.test.ts` walks the
pair and is the record.

| Workbook | Document |
|---|---|
| `Start Time` | `startTime` **floored to the minute** — see below |
| `Date`, times of day | UTC instants shifted by the race's `timezoneOffset` |
| `Preparatory Signal Used` (`P`) | `prepFlag` (`p`) |
| Starts block, one row per boat | **every participant of the division** |
| Status `OCS` | in `ocsParticipants`, not in `exoneratedParticipants` or `clearedOcs` |
| Status `OCS (Cleared)` | in `ocsParticipants` and `exoneratedParticipants` |
| Status `OCS *` | in `ocsParticipants` and `clearedOcs` (unobserved; by the workbook's meaning of the footnote) |
| Status `Not Checked-In` | not in `checkedInParticipants` |
| `DTL at Start (m)` | `startingStats[].dtlMm / 1000`, to 2 dp |
| Finishes block, in order | `finishes[]` by `finishingTime`, positions 1…n |
| `Total Time` | `finishingTime − floored start`, to the ms |
| `Finishing Time` | `finishingTime` as local time of day — the document is right where the workbook's rendering is an hour out (the drift the workbook parser flags) |
| `Max Speed (kts)` | `maxSpeed`, to 1 dp |
| `Distance Traveled (km)` | `distanceTraveled / 1000`, to 3 dp |
| `DNF` tail rows | every participant without a finish record |
| `Summary` sheet | nothing — no cross-check on this path |

Three things are decided rather than read:

1. **The start is floored to the minute.** Every recorded `startTime` in
   two regattas (23 starts) is one second past the minute — the device's
   lag on the gun — and the workbook measures `Total Time` from the whole
   minute. Flooring reproduces the workbook to the millisecond. A start
   more than a few seconds past the minute is flagged, since it may not be
   lag.
2. **Every participant is a starter**, as the workbook's Starts block
   lists them, and every participant without a finish is a `DNF` tail row.
   Both are what the workbook does (the Bronze workbook carries two
   `Not Checked-In` rows per race for the two boats absent from
   `checkedInParticipants`, and the same two in its DNF tail), and it is
   what lets the plan's reading — a never-checked-in boat with no distance
   to the line is DNC, not DNF — apply to both sources alike.
3. **The workbook's precision.** Figures are formatted to the decimals the
   workbook prints (the binary double formatted, not rounded half-up:
   4925 mm is 4.92 m in the export), so a race imported from the player
   and then from the export reads back `unchanged`.

Races that are practice, unstarted, or not yet at stage `finished` are
left out of the workbook and listed at the top of the plan, so a read
taken mid-race can't half-import the race on the water.

## What the document has that the workbook doesn't

Per-boat position and heading at the start and finish; the exonerated and
manually-cleared lists separately; `protestingBoats`; the course marks;
the general-recall history; `modifiedTs` and `sequenceNumber`, which say
how fresh a read is. Nothing on this path imports any of it beyond a note.

What neither carries: any result code other than OCS and DNF. The jury's
work still comes from the race committee.

## Live

The document is the object the player subscribes to during a race, so a
subscription in the scorer's browser would see finishes as they land. Not
built yet; the issue's second comment sets out what it would give and the
cadence check that decides how live it can be.
