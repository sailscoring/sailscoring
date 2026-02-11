# Data Model

Entities, relationships, and attributes for the sail scoring system.

## Entity Overview

_TODO: Add an entity relationship diagram._

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│                  [ER Diagram here]                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Core Entities

### Event

An event (regatta, series, or single race day).

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | | Yes | |
| name | | Yes | |
| start_date | | | |
| end_date | | | |
| venue | | | |
| | | | |

### Fleet / Division

A grouping of competitors racing together.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | | Yes | |
| name | | Yes | |
| handicap_system | | | Reference to handicap system used |
| | | | |

### Competitor

A person or team competing.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | | Yes | |
| name | | Yes | |
| sail_number | | | |
| boat_class | | | |
| handicap | | | PY number, rating, etc. |
| club | | | |
| | | | |

### Race

A single race within an event.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | | Yes | |
| event_id | | Yes | |
| race_number | | Yes | |
| date | | | |
| start_time | | | |
| wind_conditions | | | |
| | | | |

### Result

A competitor's result in a single race.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | | Yes | |
| race_id | | Yes | |
| competitor_id | | Yes | |
| finish_position | | | Position across finish line |
| finish_time | | | Elapsed time |
| corrected_time | | | Calculated from handicap |
| result_code | | | DNS, DNF, DSQ, etc. |
| points | | | Calculated score |
| | | | |

### Series Result

Aggregated results across a series.

| Attribute | Type | Required | Description |
|-----------|------|----------|-------------|
| id | | Yes | |
| event_id | | Yes | |
| competitor_id | | Yes | |
| total_points | | | Before discards |
| net_points | | | After discards |
| position | | | Overall standing |
| | | | |

## Relationships

| Relationship | Cardinality | Description |
|--------------|-------------|-------------|
| Event → Fleet | 1:N | An event has multiple fleets |
| Event → Race | 1:N | An event has multiple races |
| Fleet → Competitor | 1:N | A fleet has multiple competitors |
| Race → Result | 1:N | A race has results for each competitor |
| Competitor → Result | 1:N | A competitor has results in multiple races |

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
| RDG | Redress Given | _Variable_ |
| SCP | Scoring Penalty | _Variable_ |

### Handicap Systems

| System | Description |
|--------|-------------|
| PY | Portsmouth Yardstick |
| IRC | IRC Rating |
| PHRF | Performance Handicap Racing Fleet |
| NONE | One-design (no handicap) |

## Calculated Fields

| Entity | Field | Calculation |
|--------|-------|-------------|
| Result | corrected_time | elapsed_time × (1000 / handicap) |
| Result | points | _Per scoring system_ |
| Series Result | net_points | total_points − discards |

## Data Integrity Rules

| Rule | Description |
|------|-------------|
| | |
| | |

## Indexing Strategy

| Entity | Index | Purpose |
|--------|-------|---------|
| | | |

## Historical Data / Versioning

_TODO: Describe approach to tracking changes (audit trail, versioning, etc.)_
