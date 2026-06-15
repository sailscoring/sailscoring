# Irish Sailing Live — public results API

[Irish Sailing Live](https://irishsailinglive.ie) is Irish Sailing's results
portal. The site is a React single-page app served from a static JS bundle
(`/static/js/main.js`); all data comes from a small unauthenticated JSON API.
These notes were reverse-engineered from that bundle (the API is undocumented),
while confirming an IODAI Optimist result against it — so treat the param names
as inferred from minified code, and the whole surface as liable to change.

## Basics

- **Base URL:** `https://www.irishsailinglive.ie/api/v1/` (note the `www.` — the
  site itself is served without it). The bundle creates the axios client with
  this `baseURL` and permissive CORS headers.
- **Method:** plain `GET` with query-string params. No auth, no API key.
- **Source of truth:** each event carries a `ResultsFrom` field (e.g. `Sailwave`,
  `HalSail`) naming the scoring software the results were imported from. The data
  served here is that import, re-keyed into Irish Sailing Live's own ids.

## From a public URL to the data

The front-end routes encode the ids you need for the API:

| Front-end route | Example |
|---|---|
| `/events` | event listing |
| `/event-details/:eventId/:calendarDate` | an event's overview |
| `/event-results/:eventId/:date/:fleetId` | a fleet's standings |
| `/event-results/:eventId/:date/:fleetId/:seriesId` | a sub-series' standings |

So `https://irishsailinglive.ie/event-results/847/2024-04-04/482` →
`eventId=847`, `date=2024-04-04`, `fleetId=482`.

## Endpoint catalogue

Parameter names are exactly as they appear in the bundle's request wrappers.

| Endpoint (`…/api/v1/` +) | Query params | Returns |
|---|---|---|
| `App/Events` | `date` | events on/around a date |
| `App/Calendar` | `_from`, `page`, `pageSize` | paged event calendar |
| `App/Dates` | `year` | dates that have events in a year |
| `App/Years` | — | years with data |
| `App/EventDetails` | `eventId`, `date` | event header (+ fleet list) |
| `App/EventDetailsAndSeries` | `eventId`, `fleetId` (optional `date`) | event header **+ full standings** for the fleet |
| `App/EventFleets` | `eventId`, `date` | fleets in an event (404s without `date`) |
| `App/Race` | `raceId` | a single race's results |
| `App/CompetitorResults` | `competitorId`, `seriesId` | one competitor's per-race scores |
| `App/Courses` / `App/GetCourse` | (`courseDateId`) | course info |
| `App/GetOrganisationLogo` | `eventId` | organiser logo |
| `App/News` / `App/GetNewsById` / `App/GetNewsCategories` | `PageNumber` / `contentId` | news |
| `App/Feedback` | — | feedback submission |

## `App/EventDetailsAndSeries` response (the useful one)

`GET …/App/EventDetailsAndSeries?eventId=847&fleetId=482` returns standings
directly — no need to walk races/competitors. Top-level shape:

```jsonc
{
  "eventData": {
    "Id": 847,
    "EventName": "Irish Sailing Youth Nationals 2024",
    "ClubVenue": "Royal Cork Yacht Club",
    "Dates": "4-apr / 4-apr",
    "StartDate": "2024-04-04T00:00:00",
    "EndDate": "2024-04-04T00:00:00",
    "ResultsFrom": "Sailwave",
    "LastUpdatedDate": "2024-04-19T09:52:39.55",
    "HasResults": true,
    "EventLogoURL": "…", "SponsorLogoURL": "…",
    "Fleets": [ { "Id": 482, "FleetName": "Optimist" }, … ]
  },
  "series": [
    {
      "Id": …, "Name": "…", "RatingSystem": …, "RaceType": "OneDesign",
      "NumEntries": 38, "Races": [ … ],
      "SeriesResults": [ … ]   // one row per boat
    }
  ]
}
```

Each `series[].SeriesResults[]` row:

| Field | Notes |
|---|---|
| `Rank` | finishing rank in the fleet |
| `sailNumber` / `sailNumberFull` | bare / full sail number |
| `helmName` | helm |
| `clubName`, `boatName`, `boatOwner`, `crew` | may be null |
| `Total`, `Nett` | series points (floats) |
| `ScoringCode` | series-level code, else null |
| `InitialRating`, `FinalRating` | handicap fleets only |
| `id`, `CompetitorId` | Irish Sailing Live ids |

`eventData.Fleets` gives the `fleetId`s for the other fleets in the same event.

## Worked example / why this is here

Used to confirm IODAI's 2024 Youth Nationals copy in `../iodai`. Event 847
(Royal Cork YC, 4 Apr 2024), fleet 482 (Optimist): the feed returned 38 boats /
4 races with `ResultsFrom: Sailwave`, and every boat's `sailNumber`→`Nett`
matched the Sailwave page we held, byte-for-byte on the data. So Irish Sailing
Live is a reliable cross-check for any results it carries, and a way to pull
clean JSON standings without scraping the Sailwave HTML.

## Caveats

- Undocumented/unofficial; param names inferred from a minified bundle.
- `EventFleets` (and some others) require `date` as well as `eventId`.
- Results are only as current as the last import (`LastUpdatedDate`).
