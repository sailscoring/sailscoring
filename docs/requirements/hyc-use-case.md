# HYC Autumn League Use Case

Target use case for introducing handicap-adjusted scoring to the MVP:
the Autumn League series at Howth Yacht Club.

## Why the Autumn League?

The HYC Autumn League introduces key scoring concepts not present in the
IODAI use case:

- **Time-based finish recording** rather than position-based
- **Handicap correction** using IRC (fixed TCC) and HPH (progressive NHC)
- **Dual scoring** -- one boat's finish time produces results under multiple
  handicap systems, each with its own series standings
- **One-design scratch scoring** alongside handicap scoring

It also shares important characteristics with IODAI:

- Low Point scoring per RRS Appendix A
- Standard result codes and discard rules
- Volunteer scorers using Sailwave
- Results published weekly on the club website

## About HYC

Howth Yacht Club is one of Ireland's larger sailing clubs, located on the
north coast of Dublin Bay. The club runs a busy year-round racing programme
including club series (Tuesday, Wednesday, Saturday keelboats; Thursday
dinghies), open events, and national/regional championships.

A panel of roughly four volunteer scorers handles results. Their duties
include: translating NOR/SI scoring rules into Sailwave configuration,
importing entrant lists, entering finish data from race officers' records,
publishing results to the HYC website, and handling scoring inquiries from
the jury.

## Event Overview

| Aspect | Detail |
|--------|--------|
| Name | HYC Autumn League |
| Type | Open event (club members + visitors) |
| Duration | 6 Saturdays, Sep 13 -- Oct 18 |
| Races | 9 scheduled for most classes; 6 for Howth 17 and Classes 4-5 |
| Entries | ~80 boats across 8 classes |
| Race areas | 2 (Offshore and Inshore), each with its own committee boat |
| Scoring | Low Point, Appendix A, with RRS A5.3 |
| Discards | 0 discards when fewer than 4 races completed; 1 discard when 4-9 races completed |
| Minimum series | 1 race completed constitutes a series |

## Fleet and Class Structure

The Autumn League has two race areas, each with its own committee boat,
start sequence, and finish recording.

### Offshore (Committee Boat: North Star, VHF Ch. 77)

| Class | Starts | Handicap systems | Typical entries |
|-------|--------|-----------------|-----------------|
| Cruiser Class 1 | Flag No. 1, 1405 | IRC + HPH | ~8 |
| Cruiser Class 2 | Flag No. 2, 1410 | IRC + HPH | ~10 |
| Cruiser Class 3 | Flag No. 3, 1415 | IRC + HPH | ~10 |
| Non-Spinnaker Class 4 | Flag No. 4, 1425 | IRC + HPH | ~8 |
| Non-Spinnaker Class 5 | Flag No. 5, 1430 | IRC + HPH | ~8 |

Class 0 (IRC TCC >= 1.045) is created only if 6+ boats qualify; otherwise
those boats race in Class 1.

Classes are assigned by the OA based on handicap ranges, aiming for
balanced numbers and spread. Class boundaries may shift between events.

### Inshore (Committee Boat: Sea Wych, VHF Ch. 69)

| Class | Starts | Handicap systems | Typical entries |
|-------|--------|-----------------|-----------------|
| Puppeteer 22 | Flag A, 1405 | Scratch + HPH | ~17 |
| Squib | Flag K, 1410 | Scratch + HPH | ~10 |
| Howth Seventeen | Flag C, 1420 | Scratch + HPH | ~8 |

Inshore classes are one-design, so scratch (uncorrected finishing order)
is the primary result. HPH provides a secondary handicap-adjusted result.

### Race Schedule per Day

On 3 of the 6 Saturdays, two races are scheduled (shorter
windward/leeward format). On the other 3 Saturdays, one race is scheduled
(round-the-cans format). On two-race days, Howth 17s and Classes 4-5
sail only the first race.

## Handicap Systems

### IRC (International Racing Certificate)

- **Type:** Fixed rating for the series
- **Rating value:** TCC (Time Correction Coefficient), a decimal e.g. 0.965
- **Formula:** `corrected_time = elapsed_time × TCC`
- **Behaviour:** TCC is declared at entry and remains fixed for the series.
  Certificates must not be dated later than 8 days before the series start.
- **Applies to:** Offshore Classes 1-5

### HPH (Howth Performance Handicap)

- **Type:** Progressive handicap, based on RYA NHC (National Handicap for
  Cruisers) system
- **Rating value:** NHC number (a decimal TCF), e.g. 0.870
- **Formula:** `corrected_time = elapsed_time × NHC_number`
- **Behaviour:** Rating is adjusted after every race based on performance.
  The adjustment algorithm is defined by the RYA NHC specification and
  implemented in Sailwave via the "SWHelper" program in "internal" mode.
  Every boat that races has its rating adjusted -- this is fundamental to
  the system.
- **Initial rating:** Boats start on their NHC Base Number (from the RYA
  base list). Boats from other clubs get an initial "special" HPH. The
  final rating at end of series becomes the starting rating for the next
  series ("Club Number").
- **Applies to:** All classes (Offshore Classes 1-5 and Inshore one-designs)
- **SI requirement:** "A boat's handicap will be adjusted after every race.
  An adjustment in handicap number is not grounds for redress. This
  changes RRS 62."

### Scratch (One-Design)

- **Type:** No handicap adjustment -- finishing order is the result
- **Applies to:** Inshore one-design classes (Puppeteer 22, Squib, Howth 17)

## Dual Scoring: The Key Concept

A single boat produces a single finish time per race. That finish time is
then used to calculate results under multiple handicap systems, each
producing its own series standings.

For example, a Cruiser Class 2 boat:
1. Finishes a race with elapsed time 1h 23m 45s
2. IRC result: `1:23:45 × 0.972 (TCC)` = corrected time → ranked among
   Class 2 IRC boats → IRC series points
3. HPH result: `1:23:45 × 0.865 (NHC#)` = corrected time → ranked among
   Class 2 HPH boats → HPH series points

Both IRC and HPH produce independent series standings for the same class.
There are separate trophies for each (e.g. Sleater Salver for Class 1 IRC,
Joliba Cup for Class 1 HPH).

For an inshore one-design boat (e.g. Puppeteer 22):
1. Finishes a race in 3rd position crossing the line
2. Scratch result: 3rd place → 3 points
3. HPH result: elapsed time × NHC# → corrected time → HPH ranking

The NOR explicitly states: "Boats taking first place in an individual race
prize on IRC or Scratch are not eligible for a handicap prize for that
race." This means the prize logic is aware of results across scoring
systems.

## Result Entry Workflow

1. Each class has a separate start with a recorded start time.
2. The finish boat records all finishers in a single chronological list --
   sail number + finish time (time of day) -- regardless of class. This
   is similar to the IODAI mixed-division finish: the finish boat doesn't
   separate boats by class.
3. The scorer receives the records (uploaded to SharePoint/OneDrive).
4. The scorer enters the combined list of sail numbers + finish times.
   The system identifies each boat's class from registration data and
   separates them for per-class scoring.
5. The system calculates elapsed time (finish time - class start time)
   for each boat.
6. The system applies each applicable handicap to produce corrected times.
7. Corrected times determine race positions; positions determine points.
8. For HPH, ratings are adjusted after each race is scored.
9. Results are published to the HYC website.

### Key Differences from IODAI Result Entry

| Aspect | IODAI | HYC Autumn League |
|--------|-------|-------------------|
| What's recorded | Finishing order (positions) | Finish times (time of day) |
| Start times | Not needed (scratch racing) | Per-class start times needed |
| Handicap | None | IRC TCC, HPH/NHC number |
| Position derivation | Directly from order | From corrected time ranking |
| Multiple results per boat | No | Yes (IRC + HPH from same time) |
| Mixed finish recording | Yes (Junior/Senior by position) | Yes (all offshore classes by time) |

## Competitor Data

| Attribute | Example | Notes |
|-----------|---------|-------|
| Sail number | IRL 3939 | Primary identifier; may change for a race with notice |
| Boat name | Harmony | Important identifier for keelboats |
| Fleet | Class 2 | Assigned by OA based on rating range; "Class 1", "Class 2", etc. are Fleet names in the data model, not boat classes |
| IRC TCC | 0.972 | From IRC certificate; fixed for series |
| HPH/NHC number | 0.865 | Progressive; adjusted after each race |
| Helm | John Smith | |
| Club | HYC | |

The class pennant number must be displayed on the backstay; failure
results in DNS scoring.

## Scoring Rules (from NOR/SI)

- Low Point scoring, Appendix A, with A5.3 (scores for boats that did not
  start, finish, or were penalised shall not be excluded -- i.e. bad
  scores from codes are not automatically discardable beyond the normal
  discard allowance)
- Discards: 0 when fewer than 4 races; 1 when 4-9 races completed
- 1 race constitutes a valid series
- Starting time limit: 5 minutes -- scored DNS if not started within
- Finishing time limit: 1700 (1600 on last day); extended by 20 minutes
  after the first finisher in the class. DNF if not finished in time.
- On two-race days, the time limit per race is 15 minutes from the first
  finisher in each class.

### Special Scoring Rules

- **Squib Inland Championships conflict (SI 1.3):** Boats absent for a
  specific race due to a conflicting event get average points for that
  race. This is a niche case but illustrates the need for variable-point
  scoring overrides.
- **Prize exclusion (NOR 18.2):** IRC/Scratch race winner not eligible for
  HPH prize for that race; IRC/Scratch series winner not eligible for
  HPH series prize. This is a presentation/prize concern, not a scoring
  concern.

## Trophies and Prizes

There are 20+ perpetual trophies, with separate trophies for IRC and HPH
(or Scratch and HPH) in each class. Notable special trophies:

- **Heineken Trophy:** Overall winner -- greatest margin of winning points
  over 2nd place, multiplied by 50% of average starters in the class.
  Based on IRC for offshore, Scratch for one-design.
- **Olympus Team Trophy:** Teams of 3 boats from different classes,
  combined series scores.

These special trophies are not MVP requirements but illustrate the kind of
cross-class, cross-system calculations that clubs value.

## HPH Progressive Handicap: Detail

The NHC system (used as HPH at HYC) is the most significant new complexity
this use case introduces.

### How It Works

1. Each boat starts the series with an initial NHC number (Base Number
   from RYA list, or a club-assigned number).
2. After each race is scored, the NHC adjustment algorithm recalculates
   every participating boat's rating based on their performance.
3. The adjusted rating is used for the next race.
4. The final rating at series end becomes the boat's "Club Number" for
   future series.

### Corrected Time Formula

```
corrected_time = elapsed_time × NHC_number
```

This is the same form as IRC (`elapsed_time × TCC`). The difference is
that for IRC the TCC is fixed, while for NHC the number changes after
each race.

### Adjustment Algorithm

The NHC adjustment algorithm is defined by the RYA specification. In
Sailwave, it is implemented by a helper program ("SWHelper") that runs
when the Score/Rescore button is clicked. The algorithm:

- Adjusts every boat that participated in the race
- Does not adjust boats that did not race (in 2014+ versions)
- The exact formula is proprietary to the RYA/Sailwave implementation

**For the MVP**, the NHC adjustment algorithm must be implemented. This is
core to the HPH system -- every boat's rating changes after every race,
and the scorer expects this to happen automatically. Implementing this
requires either obtaining the RYA NHC specification or reverse-engineering
the algorithm from the Sailwave/SWHelper implementation. The RYA NHC
Rules and Guidance document is available in `reference/`.

### Per-Race Ratings

Because HPH changes after each race, the system must store the rating
used for each race, not just a single current rating per competitor.
When a race is rescored, it should use the rating that was in effect for
that race, not the current rating.

This also applies to one-design HPH: even though Puppeteer 22s are
identical boats, they each develop an individual HPH rating reflecting
helm skill and consistency.

## MVP Feature Priorities (Additive to IODAI)

Features needed for the HYC use case that go beyond the IODAI MVP:

### Must Have

1. **Time-based result entry** -- enter finish times (time of day) per
   boat, plus a start time per fleet per race
2. **Elapsed time calculation** -- finish time minus start time
3. **Handicap correction** -- apply a TCF/TCC to elapsed time to produce
   corrected time; rank by corrected time
4. **IRC scoring** -- fixed TCC per competitor, corrected time ranking
   within Fleet
5. **Dual scoring** -- a single race produces results under multiple
   handicap systems; each system has its own series standings
6. **Per-race ratings** -- store the handicap number used for each
   race/competitor combination (essential for progressive handicaps)
7. **Scratch + handicap for one-design** -- one-design classes scored on
   both finishing order (scratch) and corrected time (HPH)
8. **Automatic NHC/HPH adjustment** -- implement the NHC progressive
   handicap algorithm to automatically adjust ratings after each race

### Should Have

9. **Start time per class** -- different classes start at different times
   on the same race day
10. **Boat name as identifier** -- keelboats are commonly known by name,
    not just sail number

### Won't Have (MVP)

- Heineken Trophy / Team Trophy calculations
- Prize exclusion logic (IRC winner excluded from HPH prize)
- Class boundary management (assigning boats to classes by rating range)
- Average points for absent competitors (Squib Inland conflict)

## Data Model Implications

The HYC use case adds these requirements to the data model:

- **Result** must store: finish_time (time of day), elapsed_time
  (calculated), corrected_time (calculated), and the rating used for that
  calculation. A single race entry for a competitor may produce multiple
  scored results (one per handicap system).
- **Race** must store: start_time per class (or per start, since classes
  have separate starts)
- **Competitor** needs: boat_name, and multiple rating fields (IRC TCC,
  HPH/NHC number). The HPH number is mutable across the series.
- **Series** needs to know which handicap system(s) it uses, so it can
  produce the right set of standings.
- The concept of **"one entry, multiple scored results"** is fundamental.
  A competitor enters a race once (one finish time), but appears in
  multiple series standings (IRC and HPH).

## Comparison with IODAI

| Dimension | IODAI | HYC Autumn League |
|-----------|-------|-------------------|
| Boat type | Dinghy (Optimist) | Keelboats + one-design dinghies |
| Fleet size | Up to 200 | ~80 across 8 classes |
| Handicap | None (scratch) | IRC, HPH (progressive), Scratch |
| Finish recording | Position order | Time of day |
| Multiple results per boat | No | Yes (IRC + HPH) |
| Rating changes mid-series | No | Yes (HPH after every race) |
| Mixed-class finish entry | Yes (Junior/Senior) | Yes (all offshore classes combined) |
| Divisions within Fleet | Yes (Gold/Silver/Bronze) | No |
| Result entry location | From finish boat | Ashore (from uploaded records) |
| Scorer count | 1 | ~4 (panel of volunteers) |
