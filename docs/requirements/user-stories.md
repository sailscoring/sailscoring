# User Stories

Requirements expressed as user needs. Format: "As a [role], I want [capability] so that [benefit]."

## User Roles

| Role | Description |
|------|-------------|
| Scorer | Creates and manages a series: sets up fleets, manages competitor registrations, enters race results, and publishes standings. In a team (e.g. a panel of club volunteers), each scorer works independently on their own device and shares the series file via JSON export/import. The app makes no distinction between team members. |
| Result Viewer | Reads published results. Requires no account or login. Covers any stakeholder — competitor, race officer, jury member, or interested observer — who wants to view standings without modifying anything. |

## Series Setup

| ID | Story |
|----|-------|
| SS-01 | As a scorer, I want to create a new series with a name and venue so that I have a container to work in |
| SS-02 | As a scorer, I want to define the fleets in a series so that competitors can be grouped and scored independently |
| SS-03 | As a scorer, I want to define prize divisions within a fleet so that I can identify the top finishers per division from the fleet standings |
| SS-04 | As a scorer, I want to configure the discard profile for a series so that the correct races are excluded from each competitor's total |
| SS-05 | As a scorer, I want to configure how result codes are scored so that the series reflects the scoring rules specified in the sailing instructions |
| SS-06 | As a scorer, I want to configure the rating system(s) for the series, and override them for individual fleets where needed, so that each fleet uses the correct method |
| SS-07 | As a scorer, I want to add races to a series during setup so that I can begin recording results, with the understanding that races can be added or changed at any time |

## Competitor Management

| ID | Story | Priority | MVP |
|----|-------|----------|-----|
| CM-01 | As a scorer, I want to register competitors so that they can participate in races | | |
| CM-02 | As a scorer, I want to assign handicaps to competitors so that results can be corrected | | |
| CM-03 | | | |

## Race Management

| ID | Story | Priority | MVP |
|----|-------|----------|-----|
| RM-01 | As a scorer, I want to record finish positions so that race results can be calculated | | |
| RM-02 | As a scorer, I want to record finish times so that corrected times can be calculated | | |
| RM-03 | As a scorer, I want to record result codes (DNS, DNF, etc.) so that non-finishers are scored correctly | | |
| RM-04 | | | |

## Results Calculation

| ID | Story | Priority | MVP |
|----|-------|----------|-----|
| RC-01 | As a scorer, I want results calculated automatically so that I don't make manual errors | | |
| RC-02 | As a scorer, I want to apply discards so that series results follow the sailing instructions | | |
| RC-03 | | | |

## Results Publication

| ID | Story | Priority | MVP |
|----|-------|----------|-----|
| RP-01 | As a competitor, I want to view results so that I know my standing | | |
| RP-02 | As a scorer, I want to print results so that they can be posted on the noticeboard | | |
| RP-03 | As a scorer, I want to export results so that they can be published on the club website | | |
| RP-04 | | | |

## Data Management

| ID | Story | Priority | MVP |
|----|-------|----------|-----|
| DM-01 | As a scorer, I want to save my work so that I don't lose data | | |
| DM-02 | As a club administrator, I want to maintain a competitor database so that registration is faster | | |
| DM-03 | | | |

## Error Handling and Corrections

| ID | Story | Priority | MVP |
|----|-------|----------|-----|
| EH-01 | As a scorer, I want to correct mistakes so that results are accurate | | |
| EH-02 | As a scorer, I want to apply redress so that protest decisions are reflected | | |
| EH-03 | | | |

## Acceptance Criteria Template

For each high-priority story, define acceptance criteria:

```
### [Story ID]: [Story Title]

**Given** [precondition]
**When** [action]
**Then** [expected result]

**Given** [another precondition]
**When** [action]
**Then** [expected result]
```
