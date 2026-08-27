# RaceSense regatta export — format reference

**RaceSense** is Vakaros' iOS app for race-committee timing. It exports a
regatta as a single `.xlsx` workbook: one **`Race N`** sheet per race,
followed by a **`Summary`** sheet.

These notes describe the format as observed. The import design built on
them is
[**#412**](https://github.com/sailscoring/sailscoring/issues/412);
`lib/racesense-workbook.ts` is the parser.

Observations below come from a 40-race club-series export written by App
Version `0.10.11 (1)`. Where a field varies, that is called out — a
championship export will differ and the parser reports what it doesn't
recognise rather than guessing.

## What RaceSense captures

Deliberately narrow: **which boats started, which were OCS, which cleared
their OCS, and the finish times of the boats that finished.** Retirements,
disqualifications, redress, penalties and protest outcomes are not in the
workbook — they reach the scorer as separate notes from the race
committee.

## Workbook structure

Sheet order is `Race 1` … `Race N`, then `Summary`. Sheet *names* match
`^Race \d+$`; don't rely on position.

Every sheet opens with the same four rows:

```
RaceSense Event Report |   |   | App Version: 0.10.11 (1)
Regatta                | M15 SATURDAY SERIES
Division               | M15 NON COACHED
Regatta Start Date     | 2025-09-20
```

### `Race N` sheets

A title row (`Race 13` in col A), then `Starts`, then key/value rows and
two blocks:

```
Race 13
Starts
Start #                 | 1
Date                    | 2025-11-01
Preparatory Signal Used | P
Start Time              | 11:31
Boat Location           | 53.3016777, -6.1280121
Pin Location            | 53.3013895, -6.1277042

Sail Number | Boat Name | Bow Number | Status | DTL at Start (m)
1022        |           |            | OCS    | -326.16
563         |           |            |        | --
...

Finishes

     | Sail Number | Boat Name | Bow Number | Total Time | Finishing Time | Max Speed (kts) | Distance Traveled (km)
1.   | 1021        |           |            | 14:20.450  | 11:45:20.450   | 14.6            | 2.730
DNF  | 563         |           |            | ---        | ---            | ---             |
```

**Row positions vary and must never be assumed.** Locate every block by
content:

- `Boat Location` / `Pin Location` are absent when no line was recorded,
  which moves the Starts header row up (3 of 40 sheets).
- The Starts header carries 4, 5 or 6 columns: `DTL at Start (m)` is
  absent when no line was recorded, and a **`Protest`** column appears
  only when at least one boat in that race has one (value `Yes`).
- The Finishes block is **absent entirely** when nobody finished (4 of 40
  sheets); the `Summary` tab still shows DNF for everyone in that race.
- A footnote row **`* cleared manually`** sits in **column A** — the
  sail-number column — directly below the last starter row whenever the
  race has an `OCS *` status. It reads like a boat and isn't one.

### `Summary` sheet

Three superlative rows (`Fastest Speed`, `Shortest Race`, `Quickest
Race`), then a results grid: a header row whose col A is empty and whose
cols B+ are `Race 1`…`Race N`, then one row per competitor. Col A is the
competitor label — either `"<sail>"` or `"<sail> - <boatName>"`, split on
the literal `" - "`.

The grid encodes only positions and `DNF`. **It does not encode OCS** —
an uncleared OCS boat reads `DNF` here. Useful as an independent checksum
of the per-race sheets, not as a source of codes.

## Field semantics

### Status (Starts block) — do not ignore this column

| Status | Meaning |
|---|---|
| *(empty)* | Started clean |
| `OCS` | On the course side and did not return |
| `OCS (Cleared)` | Returned and re-crossed; RaceSense saw it. No penalty, finish stands |
| `OCS *` | Cleared **manually** by the race committee (hence the footnote row). No penalty, finish stands |
| `Not Checked-In` | Operational; see below |

**An uncleared `OCS` boat also appears as a `DNF` row in the Finishes
tail.** Verified for all five occurrences in the sample (Races 13, 14, 20,
31, 32). The Status column is the only place the OCS fact survives, so a
parser that trusts the Finishes block alone silently turns real OCS calls
into DNFs. An earlier revision of this note recommended exactly that; it
was wrong.

Which OCS-family code an `OCS` status becomes depends on the preparatory
signal — P/I → `OCS`, U → `UFD` (RRS 30.3), Black → `BFD` (RRS 30.4), Z →
the additive `ZFP` penalty (RRS 30.2). Only `P` has been observed, so the
literal strings RaceSense writes for the others are still unknown.

`Not Checked-In` is most likely about checking the *device* in at
registration rather than a racing fact — 146 rows carry it in the sample,
including boats that went on to finish. It is reported and otherwise
ignored; if it ever warrants a scoring code, that is a race-committee
call, not a parser's.

Boats with a non-empty status are **hoisted to the top of the Starts
block**, out of sail-number order.

### Finishes block

Col A is the position (`1.`, `2.`, …) or `DNF`. Finishers come first in
finishing order, then a DNF tail. `Not Checked-In` boats and uncleared
`OCS` boats both land in that tail.

`---` is RaceSense's placeholder for "no value" in the Finishes block;
`--` is the equivalent in `DTL at Start (m)`.

### Cell types

Every value-bearing cell in the sample is a **shared string** — including
dates and times. There are no Excel date serials and no locale ambiguity,
so `stringifyCell` passes them through unchanged.

Times need normalising before they reach the app: `Start Time` is `11:03`
(no seconds) and `Finishing Time` is `11:11:20.830` (fractional seconds).
`normalizeTimeInput` rejects both, so the RaceSense parser normalises
them itself rather than the strict global gate being loosened.

### `Total Time`, not `Finishing Time`

`Total Time` is the elapsed measurement; `Finishing Time` is a rendering of
it against the gun, and the rendering is not reliable. In the raw Day 2 Blue
export from the 2026 ILCA 7 Worlds, four boats in Race 2 carry a timestamp
exactly one hour early — FRA 218241, BRA 223024, GBR 228011 and AUS 196441 —
while their `Total Time`, positions, distance and max speed are all correct,
and every other boat on the sheet is right. The finishing positions are
unaffected, since RaceSense orders the Finishes block by elapsed time.

Across the exports to hand — eight workbooks, 1116 finisher rows — `Start
Time + floor(Total Time)` reproduces RaceSense's own written timestamp
exactly in every row except those four, and for those it produces exactly
what the sheet had to be corrected by hand to say.

So the import reads `Total Time` and stores it as the finish's elapsed time.
`Finishing Time` is still parsed, and disagreeing with `Start Time + Total
Time` by more than a second raises a `finish-time-drift` anomaly — the one
second being the format's own rounding, since the timestamp truncates its
fractional seconds and the elapsed time keeps them.

### Discarded

No Sail Scoring analogue: distance-to-line, GPS positions, max speed.

## Unknowns

Answerable only by a real championship export:

1. The literal strings written for non-`P` preparatory signals.
2. Whether `Race N` numbering restarts per division, and how it behaves
   across an abandonment and resail.
3. What `Start #` means — it is `1` on all 40 sample sheets, so
   sequence-position and restart-index are indistinguishable.
4. Whether entries export with national letters (`IRL 214981`) or bare
   digits, as here.

## Implementation gotcha

SheetJS (`xlsx`) `read(..., { type: 'array' })` is sensitive to the exact
view it receives — passing a raw `ArrayBuffer` in some realms (notably
jsdom under Vitest) yields a stub single-sheet workbook. Wrap in a
`Uint8Array` first. This repo reads workbooks with `read-excel-file`
instead, via `lib/import-table.ts`, and doesn't hit it.
