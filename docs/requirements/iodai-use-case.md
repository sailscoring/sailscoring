# IODAI Use Case

Target use case for the MVP: scoring events for the International Optimist
Dinghy Association in Ireland (IODAI).

## Why IODAI?

IODAI is an ideal MVP target because it combines real-world complexity with
important simplifications:

**Simplifications (reduce MVP scope):**

- One-design class: no handicap calculations, all boats race scratch
- Position-based recording: only finishing order matters, no times needed
- Standard Low Point scoring per RRS Appendix A
- Single scorer responsible for the entire event
- Active, accessible user base with clear pain points

**Real complexity (ensures the MVP is genuinely useful):**

- Large fleets: up to 200 competitors at nationals
- Multi-level competitor grouping (fleet, division, prize category)
- Shared finish line across divisions requiring careful result entry
- Late registration and changes during the event
- Results published live from the finish boat

## About IODAI

IODAI is the national body for the Optimist dinghy class in Ireland --
the country's biggest one-design class, with active racing fleets in 18+
venues. IODAI runs approximately 7 events per year. A single scorer manages
competitor data, result entry, and publication for each event.

IODAI currently uses Sailwave for scoring.

## Event Types

| Event type | Duration | Competitors | Frequency |
|------------|----------|-------------|-----------|
| Regional championship (Leinsters, Ulsters, Connachts, Munsters) | 2 days | 60-180 | 4/year |
| National championship | 4 days | ~200 | 1/year |
| Training week (1 day of racing) | 4 days | 60-100 | 1/year |
| Trials (invitation) | 4 days | ~40 | 1/year |

## Fleet Structure

Each event has three fleets, each racing on its own course with its own
start/finish. Each fleet is an independent series.

### Regatta Coached

- **Purpose:** Introduction to travelling events. Balance of coaching and
  racing. Shorter sessions. Coach support provided.
- **Competitors:** Youngest/least experienced sailors, typically first year
  of travelling events.
- **Races:** Up to ~12 across the event.
- **Discards:** Typically 2.
- **Subdivisions:** None.
- **Scoring:** Low Point, Appendix A. All competitors scored together.

### Regatta Racing

- **Purpose:** Full competitive racing for developing sailors, without the
  physical demands of Main Fleet.
- **Competitors:** Intermediate sailors progressing toward Main Fleet.
- **Races:** Up to ~10 across the event.
- **Discards:** Typically 2.
- **Subdivisions:** None.
- **Scoring:** Low Point, Appendix A. All competitors scored together.

### Main Fleet

- **Purpose:** The primary competitive fleet.
- **Competitors:** Most experienced sailors. 80-200 entries at major events.
  Often includes international (mainly GBR) competitors at nationals.
- **Races:** 8-11 across the event.
- **Discards:** 1-2 depending on races sailed.
- **Subdivisions:** Two levels of grouping (see below).

#### Divisions: Junior and Senior

Main Fleet is divided into **Junior** and **Senior** divisions. A sailor
moves to Senior in the calendar year they turn 13.

Both divisions share the same race area and finish boat. They typically have
separate starts (Junior first, then Senior immediately after) and sail
different course configurations (e.g. Junior sails the left side,
Senior sails the right side of a split course). Finishers from both
divisions are intermixed at the finish line.

**Scoring is by division.** Each division produces its own series standings.
The finish position used for scoring is the position within the division,
not the overall finish order.

However, the finish boat records all boats in crossing order, regardless of
division. The scorer enters results as a single mixed finishing order, and
the system must separate them by division for scoring.

#### Prize Categories: Gold, Silver, Bronze

Within each division, competitors are further classified into Gold, Silver,
and Bronze prize categories. All sailors start in Bronze and are upgraded
after winning two prizes. The category persists across events and across
the Junior-to-Senior transition.

**Scoring is by division, not by prize category.** All Junior sailors
(Gold, Silver, Bronze) are scored together in one Junior series. Prizes are
then awarded to the top 5 within each prize category based on their ranking
in the division standings.

Prize category is a **competitor attribute** maintained by the scorer
outside of any single event.

## Result Entry Workflow

1. Finish boat records all finishers on paper, in crossing order, by sail
   number. No division or fleet markings -- just sail numbers in order.
2. Written records are sent digitally (photo/message) from the finish boat
   to the scorer.
3. Scorer enters the finishing order into the system. The system must
   identify each competitor by sail number and knows their division from
   registration data.
4. For non-finishers, the scorer enters result codes (DNS, DNF, DSQ, RET,
   OCS, UFD, BFD, etc.).
5. The system calculates race scores and updates series standings.
6. Results are published and shared (currently via WhatsApp notification).

### Sail Number Lookup

- Most sailors have IRL sail numbers, but GBR and other nationalities
  appear at nationals.
- The sail number is the primary lookup key during result entry.
- The system must handle country-prefixed sail numbers (e.g. GBR 1234)
  alongside numeric-only entries.

## Registration

- Nominally closed one week before the event.
- In practice, additions and changes happen right up to the morning of the
  first race, and even during the event.
- The system must support adding and modifying competitors at any point.

## Publication and Communication

- Results for each series are published separately (e.g. Junior Main,
  Senior Main, Regatta Racing, Regatta Coached).
- Publication happens as soon as each race is scored, from the finish boat.
- Notification is sent via WhatsApp when results are available.
- Prize tables are published after the final race.
- IODAI currently publishes via Sailwave's results hosting.

## Edge Cases and Complexities

### Held Ashore (out of scope for MVP)

In difficult conditions, the Race Officer may keep a subset of competitors
ashore for specific races -- most commonly Junior Bronze, or the entire
Junior division.

This creates a scoring challenge: Bronze sailors who were present in some
races but absent in others affect the finishing positions of Gold/Silver
sailors inconsistently. Two parallel views of the series standings are
prepared to handle this. The exact mechanism needs further research and
verification.

**This is a niche scenario that should not be a requirement for the MVP.**

### National Ranking (out of scope for MVP)

IODAI maintains a season-long national ranking across the regional
championships (best 3 of 5 events). This is a series-of-series concept
and is deferred to a later iteration.

## MVP Feature Priorities

Based on this use case, the MVP must support:

### Must Have

1. **Event setup** -- create an event with multiple independent series
2. **Competitor management** -- add/edit competitors with: sail number
   (with optional country prefix), name, club, division, prize category
3. **Series configuration** -- number of races, discard profile, scoring
   system (Low Point / Appendix A)
4. **Position-based result entry** -- enter a list of sail numbers in
   finishing order; system looks up competitors and assigns positions
5. **Mixed-fleet result entry** -- enter one finishing order containing
   sailors from multiple divisions; system splits by division and scores
   each division separately
6. **Result codes** -- support DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC
   with standard Appendix A point values (entries + 1 or as defined)
7. **Series scoring** -- automatic calculation of total points, discards,
   net points, and series rankings per division
8. **Tie-breaking** -- per RRS Appendix A8
9. **Results publication** -- publishable results per series/division
10. **Corrections** -- ability to edit results, add/remove competitors, and
    recalculate at any point

### Should Have

11. **Late competitor addition** -- add a competitor mid-event; earlier
    races automatically scored as DNC
12. **Redress (RDG)** -- variable-point result code for protest decisions
13. **Scoring Penalty (SCP)** -- variable-point result code
14. **Prize category display** -- filter/group standings by Gold/Silver/
    Bronze within a division for prize-giving

### Won't Have (MVP)

- Handicap calculations (not needed for one-design)
- Time-based result entry
- National ranking / series-of-series
- Held-ashore split-series scoring
- Automatic prize category upgrades
- Registration integration
- WhatsApp integration
- Historical competitor database across events

## Data Model Implications

The IODAI use case validates and refines the existing data model with these
observations:

- **Event** contains multiple **Series** (not Fleets directly). Each of the
  3 IODAI fleets maps to a Series, not to a Fleet entity.
- **Fleet** and **Division** are competitor attributes within a Series that
  control how scoring is partitioned. In Main Fleet, all Junior+Senior
  competitors are in one Series, but scored by Division.
- **Prize category** (Gold/Silver/Bronze) is a competitor attribute used
  for filtering standings, not for scoring.
- **Result entry** needs a workflow concept: enter raw finish order
  (sail numbers), then the system resolves competitors and assigns
  per-division positions.
- **Finish position** (the order the boat crossed the line) is distinct
  from **race score** (the position within the scored group/division).
