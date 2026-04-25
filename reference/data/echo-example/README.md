# ECHO scoring example — Volvo Dún Laoghaire Regatta 2025 (CR0–CR3)

External reference data captured from HalSail's public results pages for the
2025 Volvo Dún Laoghaire Regatta cruiser fleets (CR 0, CR 1, CR 2, CR 3),
scored under both IRC and ECHO. Use it as worked input for testing handicap
scoring (IRC progressive comparison, ECHO base/refinement) end-to-end against
a published, externally-computed result set.

Source: <https://halsail-1e484.kxcdn.com/Result/Public/90202>
(switch fleet via the dropdown). Captured 2026-04-25.

## Layout

```
raw/                        verbatim HalSail HTML (source of truth)
  series-listing/index.html
  cr{0,1,2,3}-{irc,echo}/
    series.html             per-race results (/Result/_Boat/{seriesId})
    overall.html            overall standings (/Result/Overall/{seriesId})
    echo-analysis-series.html         ECHO only — series-wide handicap matrix
    race-{1..6}-handicap.html         per-race elapsed/corrected (% fast/slow)
    race-{1..6}-echo.html             ECHO only — per-race hcap before/after

parsed/                     extracted CSVs
  competitors.csv           one row per (fleet, sail), with IRC TCC and
                            initial ECHO rating
  finish-sheets/
    starts.csv              raceNo, raceDate, fleet, startTime
    race-{1..6}.csv         fleet, sailNumber, finishTime, resultCode
                            (rows ordered by finishTime; DNC/DNS at end)
  echo-adjustments/
    cr{0,1,2,3}.csv         wide format: per-boat per-race hcap achieved /
                            change / time delta / next hcap, plus composite
  echo-per-race.csv         long format ECHO log (boat × race)
  irc-per-race.csv          long format IRC log (boat × race)
```

## Series and race ID map

| Fleet | ECHO seriesId | IRC seriesId | ECHO raceIds   | IRC raceIds    |
|-------|--------------:|-------------:|----------------|----------------|
| CR 0  | 90196         | 90197        | 614735–614740  | 614741–614746  |
| CR 1  | 90198         | 90199        | 614747–614752  | 614753–614758  |
| CR 2  | 90200         | 90201        | 614759–614764  | 614765–614770  |
| CR 3  | 90202         | 90203        | 614771–614776  | 614777–614782  |

Race numbers map across fleets — Race 1 = 10 Jul afternoon, Race 2 = 11 Jul
morning, Race 3 = 11 Jul afternoon, Race 4 = 12 Jul morning, Race 5 = 12 Jul
afternoon, Race 6 = 13 Jul morning. Each fleet has its own start time within
a race (see `finish-sheets/starts.csv`); finish times are wall-clock and
shared across IRC and ECHO scoring of the same fleet.

## HalSail URL patterns

- `/Result/_Boat/{seriesId}` — race-by-race results (HTML fragment, AJAX target)
- `/Result/Overall/{seriesId}` — overall standings
- `/Result/EchoAnalysis/{seriesId}` — series-wide ECHO handicap matrix
- `/Result/EchoAnalysisRace/{raceId}` — per-race ECHO breakdown
- `/Analysis/HandicapResultsOneRace/{raceId}` — single-race elapsed/corrected
  view with "% fast/slow" deltas

## Notes on field semantics

- `competitors.csv > ircTcc` — IRC TCC from the IRC overall standings page.
  Constant across the series under IRC.
- `competitors.csv > initialEcho` — ECHO rating going into Race 1, taken
  from the "Before Race 1" column of `echo-analysis-series.html`. A boat that
  raced IRC only has no `initialEcho`; a boat that raced ECHO only has no
  `ircTcc`.
- `echo-adjustments/*.csv > rN_hcapAchieved` — handicap a boat would have
  needed to corrected-tie the elapsed-to-win time. Same value as the
  smallblue "achieved" detail in HalSail's series view.
- `echo-adjustments/*.csv > rN_change` — adjustment HalSail applied to that
  boat's handicap as a result of this race (signed).
- `echo-adjustments/*.csv > rN_timeDelta` — gap from the elapsed-to-win
  time on corrected. `NF` = boat did not finish that race.
- `echo-adjustments/*.csv > compositeHcap` — series-end composite ECHO
  rating shown by HalSail next to the "change over series" cell.
