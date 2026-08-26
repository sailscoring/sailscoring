# RaceSense track data on race results

Electronic race management doesn't just produce finish times — it produces
a record of how each boat sailed the race. Melges Ireland's
[data write-up of the Melges 15 Europeans](https://www.melgesireland.com/news/data-behind-the-melges-15-europeans)
shows what that record is worth: across nine races, distance to the line
at the gun correlated 38% with overall ranking, distance sailed 72%, and
average speed 90%. Numbers like these turn a results page from a record
into a story, and the race committee's device already captured them —
they are thrown away today. The implementation plan is
[**#456**](https://github.com/sailscoring/sailscoring/issues/456).

This is explicitly a RaceSense feature: the data comes from the
RaceSense import and from nowhere else, and it shows only where that
import is in use.

## Source

The RaceSense regatta export (`docs/notes/racesense/import-format.md`)
carries, beyond the finish order the importer already uses:

- **`DTL at Start (m)`** — distance to the line at the starting signal,
  per starter (absent when no line was recorded);
- **`Total Time`** — elapsed time, fractional seconds;
- **`Max Speed (kts)`** and **`Distance Traveled (km)`** — per finisher.

Average speed is not exported; it is derived (distance ÷ elapsed). The
parser recognises all four columns today and discards the values.

## Model

A sparse optional `trackData` object on `Finish` — the metrics belong to
one boat's sailing of one race, which is exactly what a finish row is.
Import-only and display-only: nothing here reaches the scoring engine,
there is no hand-entry UI, and a boat without data simply has none.
Carried through the series file (format bump — silent loss on round-trip
otherwise), the public JSON export, and a `jsonb` column on `finishes`.

## Display

All of it, as columns on the per-race finishers tables: finish time,
elapsed time, distance sailed, average speed, max speed, and DTL at
start. Published tables already sort on any column, so every metric is
its own ranking — click Avg speed and the table *is* the
speed-versus-result story, no separate presentation needed.

The columns appear only when all three hold:

- the **`racesense-import`** feature is enabled for the workspace;
- track data has actually been **imported** for the race;
- the series' **publish track data** setting is on — a per-series
  toggle beside `publishOfficials`, defaulting to off.

The split-fleet per-race results page is the first target; the ordinary
series race sections follow.

## Later

The Melges article's series-level analysis — per-metric averages across a
whole event and their correlation with the final ranking — is a natural
follow-on once per-race data exists. Not part of the initial feature.
