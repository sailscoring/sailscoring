# Related apps

The other software we know of that touches what Sail Scoring does: apps built on
it, apps it reads from or writes to, apps that do the same job, and apps next to
it. It's a catalogue, not a comparison, and it records each app's relationship to
Sail Scoring. Where we have studied an app in detail, the entry links the notes.
Add an app when we come across one. If one starts to shape a design decision,
put that in the design doc or ADR and link to it from here.

## Built on Sail Scoring

Outside apps that call Sail Scoring's public API
([`docs/public-api.md`](../public-api.md), ADR-015 and ADR-016).

| App | What it is | How it uses Sail Scoring |
|-----|------------|--------------------------|
| [tradboats.ie/course](https://tradboats.ie/course/) | Pat Tanner's ORC course-plotting page (Royal Cork YC) | A connected app (OAuth, ADR-016). It sets up a day's races and starts, plus an ORC constructed course for each start, in the scorer's workspace. |
| RaceOps ([racing.gbsc.ie](https://racing.gbsc.ie)) | Fergal Lyons's race-day app for Galway Bay SC. It records finishes on the water, offline. | Reads published results through the results API (ADR-015). Sending finish sheets in under the `submissions` scope is the next step (ADR-016). |

## Apps Sail Scoring integrates with

| App | What it is | Integration | Notes |
|-----|------------|-------------|-------|
| [Sailwave](https://www.sailwave.com) | The desktop scoring program most clubs use | Imports `.blw` files and exports to Sailwave; the results page mirrors Sailwave's HTML layout; as-published archives ingest Sailwave pages | [`notes/sailwave/`](../notes/sailwave/) |
| [HalSail](https://halsail.com) | Online club scoring service | Competitor import recognises HalSail's class export; archive repos capture HalSail results pages | [`notes/halsail/`](../notes/halsail/) |
| [Racing Rules of Sailing](https://www.racingrulesofsailing.org) (RRS.org) | Online notice board, protests and entry lists | Optionally sends the competitor list to RRS.org when a CSV is imported | [`notes/rrs-org/`](../notes/rrs-org/competitor-import-api.md) |
| Vakaros [RaceSense](https://player.vakaros.com) | Electronic start line and boat tracking | Imports finish data from the RaceSense workbook, the old player and the regatta API | [`notes/racesense/`](../notes/racesense/), [`racesense-track-data.md`](racesense-track-data.md) |
| [World Sailing](https://www.sailing.org) | Sailor ID and its datafeed | Records and checks Sailor IDs (`world-sailing-id` gate); submitting results as XRR is in [`horizon.md`](horizon.md) | |
| Rating publishers | TopYacht's IRC listing (ircrating.org), RORC's YTC sheet, [ORC](https://orc.org) certificates, Irish Sailing's ECHO list, RYA PY | Ratings and certificates fetched by sail number; PY tables built in at build time | [`handicap-scoring.md`](handicap-scoring.md), [`orc/`](orc/) |
| Club websites over FTP | Clubs' own results pages | Publishes through the Scupper upload relay | |

Studied but not integrated:

- [**Irish Sailing Live**](https://irishsailinglive.ie): Irish Sailing's results
  portal, which reads an undocumented public JSON API. Sailwave and HalSail push
  results to it. See [`notes/irish-sailing/`](../notes/irish-sailing/irishsailinglive-api.md).
- **Sailwave Tally**: NFC sign-out and sign-in at the slip, trialled at the 2026
  ILCA 7 Worlds. Sailwave files carry its tally field and penalty codes. See
  [`notes/sailwave-tally/`](../notes/sailwave-tally/).

## Apps that could integrate

| App | What it is | The obvious integration |
|-----|------------|-------------------------|
| [Pwllheli Race Officer](https://github.com/mojito9047/pwllheli-race-officer) | Race management for Pwllheli SC on a Windows PC in the start hut: course recommendation, RRS 26 start sequences driving a horn, start and finish video, GPS finish detection, live public pages and a TV display in the bar, 3D replays. It also scores IRC/YTC races and series under Appendix A. | It exports Sailwave CSV for importing elsewhere and has a read-only JSON API for the current race and its marks. A Sail Scoring import from either is the route. The code is All Rights Reserved, so we can read it for ideas but not reuse it. |
| [Mojito RTC TWA calculator](https://github.com/mojito9047/mojito-rtc-twa-calculator) | Leg-by-leg bearings, wind angles and target speeds for one J/122. It reads the course from Pwllheli Race Officer's API. | The same kind of consumer our race schedule and courses could serve. |

## Alternatives

Tools that score races, so a club picks one of them or Sail Scoring. How they
handle particular formats is covered in the design docs, notably
[`split-fleets.md`](split-fleets.md).

| App | Notes |
|-----|-------|
| [Sailwave](https://www.sailwave.com) | The default for clubs and many championships. Desktop, Windows. |
| [HalSail](https://halsail.com) | Online club scoring, strong in UK and Irish handicap racing (DBSC, Bray from 2025). |
| [Manage2Sail](https://www.manage2sail.com) | Entries, notice board and the ORM scorer. Has qualifying/final series natively. |
| Sailti | Results platform for many international class championships. |
| ORC Scorer | ORC's own scoring program for ORC events. |
| [TopYacht](https://www.topyacht.com.au) | Australian scoring and entries. Also produces the IRC rating listing. |
| ZW | Dutch scoring tool with automated group assignment for split fleets. |
| St Pete Scorer | IODA's co-recommendation alongside Sailwave. |
| KSail | Listed by World Sailing as integrated with Sailor ID. |
| Yacht Scoring, Regatta Network, Clubspot | US-centred regatta management with scoring. |
| Sail100 | Results on Bray SC's site before 2025. |
| Pwllheli Race Officer | Scores IRC/YTC series for one club, as part of race management (see above). |

The CORK results-management manual is a reference for how a large regatta runs
scoring. It isn't a tool.

## Adjacent, with no overlap

| App | What it is | Why it stays separate |
|-----|------------|-----------------------|
| [RaceFlow](https://teamracing.xyz) | Team racing (Appendix D) events: the draw, rotations, flights, and views for the start boat and finish boat | Sail Scoring doesn't score team racing ([`horizon.md`](horizon.md#team-racing-appendix-d--out-of-scope)). The integration we would accept is a publication-tree entry that links to results published elsewhere. |
