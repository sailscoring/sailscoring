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
| Follow-on series | A new series created by rolling a completed series into the next: its competitors are carried forward and each boat's progressive starting handicap is seeded from its end-of-series rating. Used so that HYC-style Club Numbers carry between successive series. |
| Tandem series | HalSail's term for a named scoring grouping of races within a class's season. A single class may be scored under several tandem series at once (e.g. Overall, Series A, Series B), each carrying its own subset of that class's races and its own standings. Sail Scoring's nearest analogue is a sub-series, but a HalSail tandem controls race membership per class/fleet, whereas a Sail Scoring sub-series shares one race set across fleets. See the `sailscoring/dbsc-archive` repo. |
| Logo library | A per-workspace collection of reusable logos and burgees (club, class, event, sponsor) plus a built-in canonical tier, selected when configuring a series for published results. |

### Competitors and Entries

| Term | Definition |
|------|------------|
| Competitor | A person who races or intends to race in the event (per RRS). The competitor record represents a single boat entry and holds all associated attributes (sail number, helm, rating, etc.). |
| Entrant | Synonym for competitor. Some events use "entrant" to refer to the person or entity who registers a boat. |
| Primary identifier | The per-series choice of what label to use for the required name column on every competitor — "Competitor", "Entrant", "Helm", or "Owner". Dinghy series typically use Helm; cruiser series typically use Owner; mixed events use a generic label. Controls column headings everywhere results appear. Does not change which storage slot holds the name (always `Competitor.name`). |
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
| Multi-fleet competitor | A boat entered in more than one fleet within the same series, scored separately in each. A single finish produces a rank in every fleet the boat belongs to, and penalty (DPI) or redress (RDG) points may differ per fleet. |
| Competitor identity | A workspace-scoped record of a recurring competitor that links their separate per-series Competitor entries. Enables a cross-series timeline and season-long ranking for the same boat or sailor across many series. |

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
| Time Correction Factor (TCF) | A multiplier applied to elapsed time to produce corrected time: corrected time = elapsed time × TCF. Expressed as a decimal (e.g. 0.965 for IRC) or as its reciprocal scaled by 1000 (e.g. 1050 for PY). Also called Time Correction Coefficient (TCC); TCC is the primary term in IRC source data and in much of the design documentation, but TCF is the canonical term in this glossary. |
| Scratch | Racing without any handicap adjustment. A scratch boat is the fastest-rated boat in a fleet, to which all time allowances are relative. Scratch results are the uncorrected finishing order. |
| One-design | A class where all boats are built to identical specifications, so handicap adjustment is optional rather than necessary. One-design fleets are usually scored scratch on finishing order alone, but may additionally be scored under a handicap system (e.g. HYC scores its Squib and Howth 17 fleets on both scratch and HPH). |
| Time on Time (ToT) | A handicap method that corrects elapsed time by a multiplier (TCF/TCC): corrected time = elapsed time × TCF. Independent of course length. Used by IRC's time-on-time option, ECHO, NHC, and PY. |
| Time on Distance (ToD) | A handicap method that allows each boat a time allowance per unit of course distance, subtracted from elapsed time. Requires a measured course length, unlike Time on Time. |
| Progressive handicap | A handicap system in which a boat's rating (TCF) is recalculated after each race based on performance, rather than staying fixed for the series. NHC, ECHO, and HPH are progressive; IRC, PY, and VPRS are static. Informally a "golf handicap". |
| Starting TCF | The initial rating that seeds a competitor in a progressive handicap system before any race is sailed. Taken from a base list (see Base Number) or carried forward from a prior series (see Club Number, Follow-on series). |
| Base Number | The starting rating a boat is seeded with in a progressive handicap system when it has no prior history, taken from a published base list (e.g. the RYA NHC base list). The seed for a boat's first series. |
| Club Number | In HYC's progressive handicap, the rating a boat carries at the end of a series, which becomes its starting handicap for the next series. The accumulated, club-maintained handicap, as distinct from the published Base Number. |
| Spinnaker / non-spinnaker TCC | IRC and VPRS certificates carry two time-correction coefficients — a standard (spinnaker) value and a lower non-spinnaker value for boats racing without a spinnaker. The scorer selects which applies to a fleet. |
| Line honours | First across the finishing line on elapsed (uncorrected) time, regardless of handicap. Sail Scoring can create a scratch "line honours" fleet alongside a handicap fleet so both the corrected result and the on-the-water order are published. |

### Handicap and Rating Systems

| Term | Definition |
|------|------------|
| IRC | A measurement-based handicap rating system for keelboats and yachts, administered by the RORC and UNCL. Boats hold an IRC certificate carrying a Time Correction Coefficient (TCC), applied time-on-time. A static (non-progressive) system. |
| NHC | National Handicap for Cruisers — the RYA's progressive handicap system for cruiser fleets. Boats start from a published base number, and ratings adjust after each race based on performance. Sail Scoring implements the Sailwave SWNHC2015 variant. |
| ECHO | A progressive, performance-based handicap system administered by Irish Sailing, widely used for cruiser racing in Ireland. Like NHC, ratings adjust race-by-race; often scored alongside IRC (see Dual scoring). |
| VPRS | Velocity Performance Rating System (Stoneways) — a measurement-based handicap rating system for cruisers. Like IRC it is static, and certificates carry spinnaker and non-spinnaker coefficients; ratings are sourced from per-club listings. |
| HPH | Howth Performance Handicap — Howth Yacht Club's progressive, performance-based handicap system applied to its keelboat and one-design fleets. An HYC-specific cousin of NHC. |

### Race

| Term | Definition |
|------|------------|
| Race | A single competitive contest within a series, from the starting signal to the last boat finishing (or retiring). Each race produces a set of results (places or times) for the competitors who participated. |
| Sailed race | A race that has actually taken place. Per RRS 90.3(a), a race shall be scored if it is not abandoned and at least one boat sails the course within the time limit. |
| Valid race | A race that counts toward the series — it was sailed (at least one boat completed the course within the time limit) and has not been excluded. An invalid race (e.g. one in which nobody finished, or one removed under the sailing instructions) does not contribute to standings or the discard count. See Star (a race) and Flick (a race). |
| Time limit | The maximum time, set in the sailing instructions, within which boats must start, sail the course, or finish for a race to count. Boats outside the limit are typically scored DNF or TLE. Per RRS 90.3(a), a race is valid if at least one boat sails the course within the time limit. |
| TLE | Time Limit Expired — a result code for a boat that was still racing when the time limit ran out. Unlike DNF, TLE is often scored more leniently (e.g. finishers plus a fixed number of points, or finishers + 1), as set by the event's scoring rules. |
| Lap | One complete circuit of the course. Some races consist of multiple laps. Results are typically recorded for the whole race rather than per lap, though lap times can be combined. |
| Start | The moment a boat begins racing, defined in the RRS as when her hull has been entirely on the pre-start side and then crosses the starting line after the starting signal. Each race has one or more starts, each with its own start time and set of competitors. |
| Start time | The time of day (clock time) at which the starting signal is given for a particular start. Used together with finish time to calculate elapsed time. |
| Finish time | The time of day (clock time) at which a boat crosses the finishing line. Used together with start time to calculate elapsed time. |
| Elapsed time | The actual duration a boat took to complete a race: finish time minus start time. This is the raw time before any handicap correction is applied. |
| Corrected time | Elapsed time adjusted by the boat's rating/handicap. The value used to determine finishing order in handicap racing. Calculated as elapsed time multiplied by the time correction factor. |
| Crossing order | The order in which boats crossed the finishing line, as observed on the water and transcribed by the scorer into the finish entry list. Row order in the finish entry list is crossing order. For scratch fleets, crossing order directly determines within-fleet rank. For handicap fleets, crossing order is still recorded but within-fleet rank is determined by corrected time, not crossing order. |
| Rank (per race) | A boat's finishing position within its fleet, determining the race score in low point scoring: rank 1 = 1 point, rank 2 = 2 points, etc. For scratch fleets, rank is derived from crossing order among the fleet's finishers. For handicap fleets, rank is derived from corrected time among the fleet's finishers. When two or more boats in the same fleet tie (equal crossing position or equal corrected time), they share the averaged consecutive ranks (RRS A8.1), and the next boat receives the rank after all tied boats. |
| Code | A standardized abbreviation assigned instead of (or in addition to) a finishing place, indicating that a boat did not finish normally. Examples: DNS, DNF, OCS, DSQ, RET. Codes defined in RRS Appendix A determine how the boat is scored. |
| Tie-break | The procedure for determining rank when two or more boats have equal series points. Resolved per RRS Appendix A8 by comparing individual race results. |
| Star (a race) | Informal term for marking a race as held but excluded from the results. The race took place, but its scores are not counted in the series. Used when a class wishes to support or prioritise an away event — they want to avoid penalising competitors who travel to it, while still allowing competitors who stay behind to race. Distinct from a discard (which excludes a competitor's worst score) and from deleting a race (which removes it entirely); a starred race is retained but does not contribute to standings. May be DBSC-specific terminology. |
| Flick (a race) | Informal term for deleting a race from a series because it is invalid — for example, a race that does not count under the sailing instructions. The race is removed entirely, as if it had never been scored. Distinct from starring a race (which retains the race but excludes its scores). Colloquial; see also Flick (a competitor). |
| Flick (a competitor) | Informal term for disqualifying a competitor. Colloquial usage of the same verb applied to a competitor rather than a race; the formal outcome is a disqualification (DSQ/DNE). |

### Results and Scoring

| Term | Definition |
|------|------------|
| Finish | The act of crossing the finishing line per the RRS definition. A boat finishes when, after her starting signal, any part of her hull crosses the finishing line from the course side. |
| Result | A competitor's outcome for a single race: either a place (finishing position or corrected-time position) or a code (DNS, DNF, etc.). Each result is converted to points for series scoring. |
| Scoring | The process of calculating race points and series standings from recorded results, according to the configured scoring system and rules. |
| Score | The numeric points value assigned to a competitor for a single race. In low point scoring, the score equals the per-race rank (rank 1 = 1.0, rank 2 = 2.0) unless modified by a code or penalty. When two boats tie they share averaged consecutive ranks (e.g. 2.5 for ranks 2 and 3). |
| Points | The numeric values assigned to race results. In standard low point scoring: place points equal the finishing position; code points are typically entries + 1 (for DNC) or starters in the race + 1 (for DNS, DNF, etc.), depending on the scoring system configuration. |
| Total | The sum of a competitor's points across all races in a series, before any discards are applied. Also called gross points. |
| Net | The competitor's series score after discards are subtracted from the total. Net points determine the final series ranking. Also called nett points. |
| Discard | The exclusion of a competitor's worst race score(s) from their series total. The number of discards allowed depends on the discard profile and the number of races completed. Also called a drop or exclusion. |
| Discard profile | The schedule that determines how many of a competitor's worst race scores are discarded as the number of completed races grows — a list of (races-completed threshold, number of discards) steps. Configured per series. |
| Non-discardable race | A race whose score cannot be excluded by the discard rules. Applies to non-excludable codes (DNE, and the restart-after-black-flag BFD case) and to any race the sailing instructions designate as a must-count. |
| Dual scoring | Producing two or more independent sets of standings from a single set of finishes, by scoring the same races under more than one handicap system or fleet (e.g. scratch and HPH, or IRC and ECHO). Each scoring runs on its own ratings, ranks, and discards; the scorer enters finishes once. Central to the HYC and DBSC use cases. |
| Average points | A score assigned by averaging a competitor's other race results rather than from a finishing position — used for redress (RDG, per RRS A9) and for some race-day allowances. The averaging method varies (all other races, races before the incident, etc.). |
| Provisional results | Published results carrying a generation timestamp and marked as not yet final, pending corrections or protest outcomes. In practice results rarely move to a formal "final" state — and since errors are corrected whenever they are found, "final" is better read as "ready for prize-giving" than as immutable. |
| Penalty | Additional points or a scoring code applied to a competitor's result, either as a post-race sanction (e.g. SCP, ZFP, DPI) or as directed by the protest committee. May be percentage-based or fixed. |
| Rank (series) | A competitor's position in the series standings, determined by net points (lowest is best in low point scoring). Distinct from per-race rank, which is the within-fleet finishing position for a single race. |
| Retirement | A boat voluntarily withdrawing from a race after starting. Recorded with the code RET and scored per the scoring system (typically as entries/starters + 1). |
| Disqualification | The removal of a competitor's result for a race due to a rule breach, as decided by the protest committee. Recorded as DSQ (excludable) or DNE (not excludable from discards). |
| Protest | A formal allegation under RRS rule 60 by a boat or committee that another boat or committee has broken a rule. Decided by the protest committee in a hearing, and may result in scoring changes. |
| Redress | Compensation given to a boat whose score has been made significantly worse through no fault of her own (e.g. by a race committee error or giving help). Granted by the protest committee, typically as average points. Recorded as code RDG. |
| Jury | The protest committee, especially at major events where an independent (international) jury is appointed. Decisions of the jury on scoring matters are implemented by the scorer. |

### Scoring Codes — Position-Replacing

RRS Appendix A calls these *scoring abbreviations*; this application uses
*scoring codes*, which is the convention in most scoring software. The terms
are interchangeable.

These codes replace a finish position entirely. The boat receives a penalty
score instead of a place-based score.

| Term | Definition |
|------|------------|
| DNC | Did Not Come to starting area. The boat did not appear in the starting area for this race. Always scored at series entries + 1 regardless of how other penalty codes are scored. A boat with no finish record is implicitly scored DNC. |
| DNS | Did Not Start. The boat came to the starting area but did not start (for any reason other than OCS). Scored at starters + 1 or entries + 1 depending on the series A5 configuration. |
| OCS | On Course Side. The boat was on the course side of the starting line at her starting signal and failed to return to start correctly, or broke rule 30.1. Scored the same as DNS. |
| NSC | Did Not Sail the Course. The boat finished but is deemed not to have sailed the course (e.g. missed a mark). Not to be confused with DNF; scored the same as DNS/DNF. |
| DNF | Did Not Finish. The boat started but did not finish within the time limit or retired before finishing. Scored at starters + 1 or entries + 1. |
| RET | Retired. The boat voluntarily withdrew from the race after starting, typically after acknowledging a rules infringement under rule 44.1. Scored the same as DNF. |
| DSQ | Disqualified. The boat's result was removed by the protest committee following a hearing. Scored at entries + 1 (or starters + 1); discardable. |
| DNE | Disqualification Not Excludable. A disqualification whose score cannot be excluded from the series total regardless of the discard rules. Applied when the protest committee determines the breach was serious enough to preclude discard (e.g. breaking rule 2). |
| UFD | U Flag Disqualification. Disqualification imposed without a hearing under rule 30.3 (U Flag Rule) for being in the triangle zone in the last minute before the start. Discardable. |
| BFD | Black Flag Disqualification. Disqualification imposed without a hearing under rule 30.4 (Black Flag Rule). Like UFD, a plain BFD is an ordinary disqualification and can be excluded (discarded) from series scoring; only the niche case of a boat that sailed a restart after being black-flagged is non-excludable (scored DNE). |

### Scoring Codes — Additive Penalties

These codes amend a recorded finish position by adding penalty points. The
boat retains its finishing place for ranking purposes; only its own score
changes (per RRS A6.2, other boats' scores are not recalculated).

| Term | Definition |
|------|------------|
| ZFP | Z Flag Penalty. Applied without a hearing under rule 30.2 (Z Flag Rule) for a boat in the triangle zone during the last minute before the start. The penalty is 20% of the DNF score for that race (per rule 44.3(c)), added to the boat's finishing-place score. The boat's score cannot exceed the DNF score. Can be applied again if identified on a subsequent re-start attempt. |
| SCP | Scoring Penalty. An additive penalty imposed by the protest committee per rule 44.3. The penalty amount is stated in the notice of race or sailing instructions; if not stated, it defaults to 20% of the DNF score. The boat's score cannot exceed the DNF score. |
| DPI | Discretionary Penalty Imposed. An additive penalty where the protest committee specifies the points to add. Similar to SCP but with a committee-determined points value rather than a percentage. |

### Scoring Codes — Redress

| Term | Definition |
|------|------------|
| RDG | Redress Given. Applied by the protest committee when a boat's score has been made significantly worse through no fault of her own (rule 62). The boat's score for the affected race is replaced by an average calculated from her other races (see RRS A9 for recommended averaging methods). Three methods are used in practice: average of all other races (A9a), average of races before the incident (A9b), or points based on position at time of incident (A9c). |

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
| 4 | Polar Curve Scoring (PCS) | |
| 5 | Weather Routing Scoring (WRS) | |

### Handicap and Rating Systems

| # | Term | Also known as |
|---|------|---------------|
| 1 | Portsmouth Yardstick (PY) | |
| 2 | PHRF | |
| 3 | ORC | |
| 4 | CYCA | |
| 5 | YTC | |
| 6 | ASY | Australian Sailing Yardstick |
| 7 | SCHRS | Small Craft Handicap Rating System |
| 8 | Texel Rating | |

### Rating Concepts

| # | Term | Also known as |
|---|------|---------------|
| 1 | Rating certificate | |
| 2 | All Purpose Handicap (APH) | |
| 3 | Class Division Length (CDL) | |
| 4 | Performance curve | speed polar |
| 5 | Velocity Prediction Program (VPP) | |
| 6 | Time allowance | |
| 7 | Dynamic Allowance (DA) | |
| 8 | Rating file | |

### Time and Finishing

| # | Term | Also known as |
|---|------|---------------|
| 1 | Finishing window | |
| 2 | Sailed time | |
| 3 | Scoring Wind | |
| 4 | True Wind Speed (TWS) | |
| 5 | True Wind Angle (TWA) | |

### Series Scoring

| # | Term | Also known as |
|---|------|---------------|
| 1 | Scoring penalty | |

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
