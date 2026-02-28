# Data Model

Entities, relationships, and attributes for the sail scoring system.

## Design Principles

**Recorded vs calculated:** The data model separates what was observed on the
water (Finish) from what was calculated by the scoring system (Result). A
single Finish can produce multiple Results when a Fleet uses more than one
scoring system.

**Series as container:** Series is the top-level entity. All other entities
belong to a Series. Deleting a Series deletes everything within it.

**No competitor duplication:** Unlike Sailwave's "alias" approach to dual
scoring, a Competitor exists once regardless of how many scoring systems
apply. The Fleet's scoring system configuration determines what Results are
calculated from each Finish.

**Fleet, Class, and Division:** These three competitor attributes all relate
to grouping, but serve distinct purposes in the model. The separation was not
obvious from the domain terminology alone -- "class" in particular is
overloaded across different sailing contexts -- so it is worth explaining how
we arrived at the current design.

*Class* has a strong "type of boat" connotation: Optimist, ILCA 4, J/109,
Squib. In the IODAI Main Fleet series all competitors sail Optimists, so
class carries no useful scoring information -- it is uniform across the entire
series. In the HYC Autumn League Offshore series, the Notice of Race and
Sailing Instructions describe "Class 1", "Class 2", etc., but these are not
boat classes -- they are mixed-boat groups competing together. Using the Class
attribute for these groups would misrepresent what they are. We therefore
treat Class as descriptive, boat-type information that is not used in scoring.

*Fleet* is the primary scoring group: competitors who race and are scored
together. Fleet turns out to be the natural unit for four distinct
operational concerns:

- **Race starts** -- in a race with multiple starts from the same line,
  the Fleet is the subset that starts together at a given time. In both MVP
  use cases (IODAI Junior/Senior, HYC Class 1/2/3...) it is the Fleet that
  determines which start a competitor belongs to.
- **Rating systems** -- each Fleet has one or more scoring systems configured
  (scratch, IRC, NHC). This implicitly determines what rating data (TCC,
  NHC number) is required from each competitor in that Fleet.
- **Scoring** -- competitors are ranked within their Fleet per scoring system.
  Scoring Fleet-by-Fleet is the natural starting point, mirroring the common
  practice in tools like Sailwave.
- **Publishing** -- results pages and printed sheets are typically organised
  by Fleet. The Fleet is therefore also the natural publishing unit.

In the IODAI use case the Class → Fleet → Division hierarchy exists on paper
(all competitors are Optimists, Fleet is Junior or Senior, Division is
Gold/Silver/Bronze), but Class is redundant for scoring and Division is used
only for prize-giving subdivision within a Fleet, not for separate scoring.

In the HYC Autumn League Offshore use case, using Fleet for the groupings
described as "classes" in the NOR/SIs is semantically cleaner than shoehorning
them into the Class attribute.

*Division* is a subdivision within a Fleet used for prize-giving and result
filtering (e.g. Gold/Silver/Bronze within IODAI Junior), not for scoring.
Competitors in the same Fleet compete for the same rankings; Division only
determines which sub-trophy they are eligible for.

**Future flexibility -- class-based standalone results:** One known limitation
of this model is the HYC Dinghy PY Fleet pattern: a single Fleet uses the PY
rating system for all competitors, but where a critical mass of one boat class
exists (e.g. Melges 15), that class also receives standalone, one-design,
scratch results covering only boats of that class. In the current model a
Competitor has exactly one Fleet and their Fleet's scoring systems apply
uniformly. Supporting this pattern would require either assigning the Melges 15
boats to a second Fleet (duplicating competitors, which the model explicitly
avoids) or extending the model to allow per-class scoring overlays within a
Fleet. This is noted for future consideration but is explicitly out of scope
for the MVP.

## Entity Overview

```
Series
 ├── Fleet (1:N)
 │    └── Competitor (1:N)
 ├── Race (1:N)
 │    └── Start (1:N, one per Fleet per Race)
 └── Finish (per Competitor per Race)
      └── Result (per scoring system, calculated)
```

## Core Entities

### Series

The top-level container for a scored competition. All other entities belong
to a Series.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| name | string | Yes | e.g. "Autumn League Offshore", "IODAI Main Fleet" |
| venue | string | No | Location or club name |
| start_date | date | No | First racing day |
| end_date | date | No | Last racing day |
| discard_profile | string | No | Discard rules, e.g. "0 discards < 4 races, 1 discard 4-9 races" |

### Fleet

A group of competitors who race and are scored together. A Fleet has one or
more scoring systems configured; each produces its own set of standings.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| series_id | uuid | Yes | Parent Series |
| name | string | Yes | e.g. "Class 1", "Junior", "Regatta Coached" |
| scoring_systems | list | Yes | One or more: scratch, IRC, NHC. Each produces independent standings |

A Fleet's scoring systems define what rating data is required from each
Competitor in the Fleet. For example, a Fleet with [IRC, NHC] requires
every Competitor to have both an IRC TCC and an NHC number.

### Competitor

A boat or person entered in the Series. Belongs to exactly one Fleet.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| fleet_id | uuid | Yes | Parent Fleet |
| sail_number | string | Yes | Primary identifier, e.g. "IRL 1234", "GBR 5678" |
| name | string | No | Helm name |
| boat_name | string | No | Vessel name (keelboats) |
| club | string | No | Sailing club |
| class | string | No | Boat class, e.g. "Optimist", "J/109" |
| division | string | No | Subdivision within Fleet, e.g. "Gold", "Silver", "Bronze" |
| irc_tcc | decimal | No | IRC Time Correction Coefficient, e.g. 0.972. Required if Fleet scores IRC |
| nhc_number | decimal | No | NHC/HPH rating, e.g. 0.865. Required if Fleet scores NHC. Progressive: adjusted after each race |

### Race

A single race within the Series. Shared across all Fleets in the Series
that race on the same day.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| series_id | uuid | Yes | Parent Series |
| race_number | integer | Yes | Sequential race number within the Series |
| date | date | No | Date the race was sailed |
| last_finish_time | time | No | Time of the last finisher, used for protest time limit calculation. Auto-populated from the latest finish_time in the race (time mode), or entered explicitly by the scorer (position mode). Can be overridden |

### Start

A start within a Race for a specific Fleet. Different Fleets may have
different start times in the same Race (e.g. Class 1 at 14:05, Class 2 at
14:10). Used to calculate elapsed time from finish time.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| race_id | uuid | Yes | Parent Race |
| fleet_id | uuid | Yes | Which Fleet this start is for |
| start_time | time | No | Time of day the starting signal was given. Not needed for scratch/position-based scoring |

### Finish

The recorded data for a Competitor in a Race -- what was observed on the
water. Entered once by the scorer. This is the raw input to the scoring
system.

A Finish records either a finishing position (for position-based recording)
or a finish time (for time-based recording), or a result code for boats
that did not finish normally. A Finish record may also be created during
start-line check-in (to record `start_present`) before any finish data is
available.

A competitor with no Finish record for a race is implicitly scored as DNC.
An explicit `result_code = DNC` can also be recorded but is not required
for absent competitors.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| race_id | uuid | Yes | Which Race |
| competitor_id | uuid | Yes | Which Competitor |
| finish_position | integer | No | Position across the finish line (position-based recording) |
| finish_time | time | No | Time of day the boat crossed the finish line (time-based recording) |
| result_code | string | No | DNS, DNF, DSQ, OCS, UFD, BFD, RET, DNC, RDG, SCP. If set, overrides position/time for scoring |
| start_present | boolean | No | True if the competitor was observed in the start area. Used to distinguish DNS (present but didn't start) from DNC (not present). Set during start-line check-in |

A Finish has either a finish_position, a finish_time, or a result_code.

### Result

The calculated outcome for a Competitor in a Race under a specific scoring
system. Derived from a Finish. There is one Result per Finish per scoring
system configured on the Competitor's Fleet.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | uuid | Yes | Unique identifier |
| finish_id | uuid | Yes | The Finish this was calculated from |
| scoring_system | string | Yes | Which scoring system: scratch, IRC, NHC |
| rating_used | decimal | No | The rating value applied for this calculation (snapshot, important for progressive handicaps) |
| elapsed_time | duration | No | finish_time − start_time. Calculated |
| corrected_time | duration | No | elapsed_time × rating. Calculated |
| place | integer | No | Position within the Fleet for this scoring system. Calculated from corrected_time ranking or finish_position |
| points | decimal | No | Score for this race. In low point: place = points. Codes scored per Appendix A |

## Relationships

| Relationship | Cardinality | Description |
|--------------|-------------|-------------|
| Series → Fleet | 1:N | A Series has one or more Fleets |
| Series → Race | 1:N | A Series has one or more Races |
| Fleet → Competitor | 1:N | A Fleet has one or more Competitors |
| Race → Start | 1:N | A Race has one Start per Fleet |
| Race → Finish | 1:N | A Race has Finishes for participating Competitors |
| Competitor → Finish | 1:N | A Competitor has one Finish per Race |
| Finish → Result | 1:N | A Finish produces one Result per scoring system |

## Enumerations

### Result Codes

| Code | Description | Default Points |
|------|-------------|----------------|
| DNS | Did Not Start | Entries + 1 |
| DNF | Did Not Finish | Entries + 1 |
| DSQ | Disqualified | Entries + 1 |
| OCS | On Course Side | Entries + 1 |
| UFD | U Flag Disqualification | Entries + 1 |
| BFD | Black Flag Disqualification | Entries + 1 |
| RET | Retired | Entries + 1 |
| DNC | Did Not Compete | Entries + 1 |
| RDG | Redress Given | Variable |
| SCP | Scoring Penalty | Variable |

### Scoring Systems

| System | Description | Rating Required |
|--------|-------------|-----------------|
| scratch | No handicap, position-based | None |
| IRC | Fixed TCC per series | irc_tcc |
| NHC | Progressive handicap, adjusted after each race | nhc_number |

## Calculated Fields

| Entity | Field | Calculation |
|--------|-------|-------------|
| Result | elapsed_time | Finish.finish_time − Start.start_time |
| Result | corrected_time | elapsed_time × rating_used |
| Result | place | Rank by corrected_time within Fleet (handicap) or by Finish.finish_position within Fleet (scratch) |
| Result | points | place value, or code points per Appendix A |

## Series Standings (Derived)

Series standings are calculated from Results, not stored as a separate
entity. For each Fleet and scoring system combination:

| Field | Calculation |
|-------|-------------|
| total_points | Sum of points across all Races |
| net_points | total_points minus worst N scores per discard profile |
| rank | Order by net_points (lowest first), tie-break per Appendix A8 |

Standings can be further filtered by division (e.g. show only Gold
competitors within a Fleet) for prize-giving purposes.

## Data Integrity Rules

| Rule | Description |
|------|-------------|
| Sail number unique within Series | A sail number must be unique across all Competitors in a Series, regardless of Fleet. Sail number is the primary lookup key during finish recording; a duplicate would make identification ambiguous in a mixed-Fleet finish. |
| At most one Finish per Competitor per Race | A Competitor can have at most one Finish record for a given Race |
| One Start per Fleet per Race | Each Fleet has exactly one Start per Race it participates in |
| Scoring system ratings required | A Competitor must have the rating fields required by their Fleet's scoring systems |
| Result code exclusivity | A Finish has either a finish_position, a finish_time, or a result_code -- not a combination |

## Use Case Examples

### IODAI Main Fleet (position-based, scratch)

- **Series:** "IODAI Leinsters 2025"
- **Fleets:** "Junior" (scratch), "Senior" (scratch)
- **Competitors:** sail number, name, club, division (Gold/Silver/Bronze)
- **Finish entry:** Sail numbers in crossing order → system assigns
  finish_position per Fleet
- **Results:** place = position within Fleet, points = place value

### HYC Autumn League Offshore (time-based, dual scoring)

- **Series:** "Autumn League Offshore 2025"
- **Fleets:** "Class 1" (IRC + NHC), "Class 2" (IRC + NHC), etc.
- **Competitors:** sail number, boat name, irc_tcc, nhc_number
- **Starts:** Each Fleet has its own start_time per Race
- **Finish entry:** Sail number + finish time → system identifies Fleet
- **Results:** Two Results per Finish -- one for IRC (using irc_tcc), one
  for NHC (using nhc_number). Each produces independent standings
