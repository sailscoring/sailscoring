# Glossary

Sailing and racing terminology relevant to a scoring application. Terms are
grouped into logical sections. Defined terms appear at the top; terms still to
be defined are collected at the bottom.

## Defined terms

### Event Structure

| Term | Definition |
|------|------------|
| Series | The top-level scoring container. A series holds all races, competitors, and scoring configuration for a single scored competition. A regatta or event may contain one or more series. |
| Event | A sailing competition, which may comprise one or more series. The terms series, event, and regatta are often used interchangeably, though an event can span multiple series (e.g. qualifying and final). |
| Venue | The location where an event takes place, typically a sailing club or waterfront facility. The venue name and burgee are stored separately from the event name. |
| Burgee | A graphic emblem (typically a club flag or event logo) displayed in published results. Both the event and venue may have separate burgees. |

### Competitors and Entries

| Term | Definition |
|------|------------|
| Competitor | A person who races or intends to race in the event (per RRS). The competitor record represents a single boat entry and holds all associated attributes (sail number, helm, rating, etc.). |
| Entrant | Synonym for competitor. Some events use "entrant" to refer to the person or entity who registers a boat. |
| Sail number | The primary identifier for a boat, displayed on its sails per class rules or national authority requirements. The default field used for looking up competitors during result entry. |
| Alternate sail number | A secondary sail number field, searched alongside the primary sail number during result entry. Useful when a boat carries a country-code prefix (e.g. GBR 1234) separate from the numeric-only sail number. |
| Bow number | A number affixed to the bow of a boat, typically assigned by the organizing authority for identification at a specific event. Sometimes used instead of sail number for result entry. |
| Tally number | A numbered token issued to competitors for on-water safety tracking (handed in before launching, collected on return). Also used as an additional competitor identifier field. |
| Boat name | The name of the vessel, stored as a competitor attribute. |
| Owner | The person who owns the boat. May differ from the helm. |
| Helm | The person who steers and is in charge of the boat during a race. Also known as skipper. |
| Crew | Any person on board other than the helm. Crew names are typically stored as a single string field. |
| Nationality | The country a competitor represents, stored as a World Sailing three-letter country code (e.g. GBR, AUS). Used for flag display in published results. |
| Club | The sailing club a competitor belongs to. A competitor attribute used for grouping and publishing. |

### Grouping

| Term | Definition |
|------|------------|
| Class | A type of boat, defined by all boats carrying the same class insignia (per RRS G1.1). Examples: Laser, 49er, Farr 40. In one-design racing, a class typically forms a fleet. |
| Fleet | A group of boats that sail and are scored together. May be a single class or a mixed group using a handicap system. Fleet is the primary grouping field for scoring. In yacht racing, often called a division or class. |
| Division | A subdivision within a fleet, used to further categorise competitors (e.g. Men/Women, Junior/Senior) who sail in the same races but may be scored or ranked separately. In yacht racing, often called a group or class. |
| Flight | A competitor/race attribute that can change on a per-race basis. Used to split large fleets into smaller starting groups in qualifying series (e.g. Yellow, Blue). Flights are reassigned between race days based on results. The term Fleet should be used in Final Series and Flight in Qualifying Series. |

### Handicap and Rating

| Term | Definition |
|------|------------|
| Rating | A numeric value assigned to a boat that represents its expected speed potential. Used as the normalization coefficient to convert elapsed time to corrected time. Also called a handicap number. |
| Handicap | A system for adjusting race results so boats of different types can compete fairly. The handicap value (rating) is applied to elapsed times to produce corrected times. Used interchangeably with "rating" when referring to the numeric value. |
| Time Correction Factor | A multiplier applied to elapsed time to produce corrected time. Expressed as a decimal (e.g. 0.965 for IRC) or as its reciprocal scaled by 1000 (e.g. 1050 for PY). Also called Time Correction Coefficient (TCC). The formula is: corrected time = elapsed time x TCF. |
| Scratch | Racing without any handicap adjustment. A scratch boat is the fastest-rated boat in a fleet, to which all time allowances are relative. Scratch results are the uncorrected finishing order. |
| One-design | A class where all boats are built to identical specifications, making handicap adjustment unnecessary. Boats race scratch and are scored on finishing order alone. |

### Race

| Term | Definition |
|------|------------|
| Race | A single competitive contest within a series, from the starting signal to the last boat finishing (or retiring). Each race produces a set of results (places or times) for the competitors who participated. |
| Sailed race | A race that has actually taken place. Per RRS 90.3(a), a race shall be scored if it is not abandoned and at least one boat sails the course within the time limit. |
| Lap | One complete circuit of the course. Some races consist of multiple laps. Results are typically recorded for the whole race rather than per lap, though lap times can be combined. |
| Start | The moment a boat begins racing, defined in the RRS as when her hull has been entirely on the pre-start side and then crosses the starting line after the starting signal. Each race has one or more starts, each with its own start time and set of competitors. |
| Start time | The time of day (clock time) at which the starting signal is given for a particular start. Used together with finish time to calculate elapsed time. |
| Finish time | The time of day (clock time) at which a boat crosses the finishing line. Used together with start time to calculate elapsed time. |
| Elapsed time | The actual duration a boat took to complete a race: finish time minus start time. This is the raw time before any handicap correction is applied. |
| Corrected time | Elapsed time adjusted by the boat's rating/handicap. The value used to determine finishing order in handicap racing. Calculated as elapsed time multiplied by the time correction factor. |
| Place | A boat's finishing position in a race, either by crossing the finish line (in position-based recording) or derived from corrected times (in handicap racing). Place determines the race score in low point scoring: 1st place = 1 point, 2nd = 2, etc. |
| Code | A standardized abbreviation assigned instead of (or in addition to) a finishing place, indicating that a boat did not finish normally. Examples: DNS, DNF, OCS, DSQ, RET. Codes defined in RRS Appendix A determine how the boat is scored. |
| Tie-break | The procedure for determining rank when two or more boats have equal series points. Resolved per RRS Appendix A8 by comparing individual race results. |

### Results and Scoring

| Term | Definition |
|------|------------|
| Finish | The act of crossing the finishing line per the RRS definition. A boat finishes when, after her starting signal, any part of her hull crosses the finishing line from the course side. |
| Result | A competitor's outcome for a single race: either a place (finishing position or corrected-time position) or a code (DNS, DNF, etc.). Each result is converted to points for series scoring. |
| Scoring | The process of calculating race points and series standings from recorded results, according to the configured scoring system and rules. |
| Score | The numeric points value assigned to a competitor for a single race. In low point scoring, the score equals the place (1st = 1.0, 2nd = 2.0) unless modified by a code or penalty. |
| Points | The numeric values assigned to race results. In standard low point scoring: place points equal the finishing position; code points are typically entries + 1 (for DNC) or starters in the race + 1 (for DNS, DNF, etc.), depending on the scoring system configuration. |
| Total | The sum of a competitor's points across all races in a series, before any discards are applied. Also called gross points. |
| Net | The competitor's series score after discards are subtracted from the total. Net points determine the final series ranking. Also called nett points. |
| Discard | The exclusion of a competitor's worst race score(s) from their series total. The number of discards allowed depends on the discard profile and the number of races completed. Also called a drop or exclusion. |
| Penalty | Additional points or a scoring code applied to a competitor's result, either as a post-race sanction (e.g. SCP, ZFP, DPI) or as directed by the protest committee. May be percentage-based or fixed. |
| Rank | A competitor's position in the series standings, determined by net points (lowest is best in low point scoring). Also called place or position. |
| Retirement | A boat voluntarily withdrawing from a race after starting. Recorded with the code RET and scored per the scoring system (typically as entries/starters + 1). |
| Disqualification | The removal of a competitor's result for a race due to a rule breach, as decided by the protest committee. Recorded as DSQ (excludable) or DNE (not excludable from discards). |
| Protest | A formal allegation under RRS rule 60 by a boat or committee that another boat or committee has broken a rule. Decided by the protest committee in a hearing, and may result in scoring changes. |
| Redress | Compensation given to a boat whose score has been made significantly worse through no fault of her own (e.g. by a race committee error or giving help). Granted by the protest committee, typically as average points. Recorded as code RDG. |
| Jury | The protest committee, especially at major events where an independent (international) jury is appointed. Decisions of the jury on scoring matters are implemented by the scorer. |

### Rules and Governance

| Term | Definition |
|------|------------|
| RRS | Racing Rules of Sailing. The rule book published by World Sailing every four years (current edition: 2025-2028) that governs the conduct and scoring of sailing races. |
| Appendix A | The section of the RRS that defines scoring rules for fleet racing. Covers race scoring, series scoring, scoring codes, and tie-breaking. Most scoring software defaults to Appendix A compliance. |
| WS | World Sailing. The international governing body for the sport of sailing (formerly ISAF). Publishes the RRS and associated regulations. |

---

## Terms to be defined

### Scoring Systems and Methods

| # | Term | Also known as |
|---|------|---------------|
| 1 | Low Point scoring | Appendix A scoring |
| 2 | High Point scoring | |
| 3 | Bonus Point scoring | |
| 4 | Time on Time (ToT) | |
| 5 | Time on Distance (ToD) | |
| 6 | Polar Curve Scoring (PCS) | |
| 7 | Weather Routing Scoring (WRS) | |

### Handicap and Rating Systems

| # | Term | Also known as |
|---|------|---------------|
| 1 | Portsmouth Yardstick (PY) | |
| 2 | IRC | |
| 3 | PHRF | |
| 4 | ORC | |
| 5 | NHC | National Handicap for Cruisers |
| 6 | ECHO | |
| 7 | CYCA | |
| 8 | YTC | |
| 9 | ASY | Australian Sailing Yardstick |
| 10 | SCHRS | Small Craft Handicap Rating System |
| 11 | Texel Rating | |

### Rating Concepts

| # | Term | Also known as |
|---|------|---------------|
| 1 | Rating certificate | |
| 2 | All Purpose Handicap (APH) | |
| 3 | Class Division Length (CDL) | |
| 4 | Performance curve | speed polar |
| 5 | Velocity Prediction Program (VPP) | |
| 6 | Progressive handicap | golf handicap |
| 7 | Time allowance | |
| 8 | Dynamic Allowance (DA) | |
| 9 | Rating file | |

### Time and Finishing

| # | Term | Also known as |
|---|------|---------------|
| 1 | Time limit | |
| 2 | Finishing window | |
| 3 | Sailed time | |
| 4 | Scoring Wind | |
| 5 | True Wind Speed (TWS) | |
| 6 | True Wind Angle (TWA) | |

### Result Codes

| # | Term | Also known as |
|---|------|---------------|
| 1 | DNC | Did Not Compete |
| 2 | DNS | Did Not Start |
| 3 | OCS | On Course Side |
| 4 | DNF | Did Not Finish |
| 5 | DSQ | Disqualified |
| 6 | UFD | U Flag Disqualification |
| 7 | BFD | Black Flag Disqualification |
| 8 | RET | Retired |
| 9 | RDG | Redress Given |
| 10 | SCP | Scoring Penalty |
| 11 | TLE | Time Limit Expired |
| 12 | ZFP | Z Flag Penalty |
| 13 | DPI | Discretionary Penalty Imposed |
| 14 | NSC | Did Not Sail the Course |
| 15 | DNE | Disqualification Not Excludable |

### Series Scoring

| # | Term | Also known as |
|---|------|---------------|
| 1 | Discard profile | |
| 2 | Non-discardable race | |
| 3 | Valid race | |
| 4 | Average points | |
| 5 | Scoring penalty | |

### Race Formats

| # | Term | Also known as |
|---|------|---------------|
| 1 | Fleet racing | |
| 2 | Pursuit racing | |
| 3 | Match racing | |
| 4 | Team racing | |
| 5 | Level racing | |
| 6 | Handicap racing | |

### Event Structure

| # | Term | Also known as |
|---|------|---------------|
| 1 | Race day | |
| 2 | Qualifying series | |
| 3 | Final series | |
| 4 | Gold fleet / Silver fleet | |
| 5 | Medal race | |
| 6 | Course | circle of competition |

### Competitors and Entries

| # | Term | Also known as |
|---|------|---------------|
| 1 | Corinthian | |
| 2 | Double-handed | |

### Roles and Committees

| # | Term | Also known as |
|---|------|---------------|
| 1 | Race Officer | Principal Race Officer (PRO) |
| 2 | Race Committee | |
| 3 | Protest Committee | jury |
| 4 | Technical Committee | measurement, scrutineering |
| 5 | Scorer | |
| 6 | Chief Scorer | |

### Race Management Documents

| # | Term | Also known as |
|---|------|---------------|
| 1 | Notice of Race (NoR) | |
| 2 | Sailing Instructions (SI) | |
| 3 | Scratch sheet | |
| 4 | Results | |
| 5 | Provisional results | |
| 6 | Scoring inquiry | |

### Courses and Conditions

| # | Term | Also known as |
|---|------|---------------|
| 1 | Constructed course | |
| 2 | Windward/leeward course | |
| 3 | All-purpose course | |
| 4 | Course distance | |

### Publishing and Output

| # | Term | Also known as |
|---|------|---------------|
| 1 | Publishing | |
| 2 | Sail number wizard | |

---

_Terms will be defined in priority order and moved to the top of this document._
