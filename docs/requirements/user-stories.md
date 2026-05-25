# User Stories

Requirements expressed as user needs. Format: "As a [role], I want [capability] so that [benefit]."

## User Roles

| Role | Description |
|------|-------------|
| Scorer | Creates and manages a series: sets up fleets, manages competitor registrations, enters race results, and publishes standings. Solo scorers (e.g. IODAI) work in a personal workspace. Club scoring panels share an organisation workspace; every panel member sees the same series, edits are autosaved per-row, conflicts surface clean 409s with actor attribution, and `.sailscoring` files become a backup / hand-off artefact rather than the collaboration channel. |
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

| ID | Story |
|----|-------|
| CM-01 | As a scorer, I want to add a competitor with their sail number, primary identifier (helm, owner, or a generic "competitor"/"entrant" — configurable per series), optional secondary role (helm when the primary is owner, and vice versa), club, and optionally boat name so that they can be identified in results in the convention their class expects |
| CM-02 | As a scorer, I want to assign a competitor to a fleet, and re-assign them later if needed, so that they are scored within the correct group |
| CM-03 | As a scorer, I want to assign a competitor to a prize division so that they appear in the correct prize category standings |
| CM-04 | As a scorer, I want to set a competitor's rating for each applicable rating system so that they appear in that rating system's standings |
| CM-05 | As a scorer, I want to edit competitor details at any time — including sail number — with affected results automatically re-scored, so that corrections and late changes are reflected in standings |
| CM-06 | As a scorer, I want to add a competitor mid-event so that latecomers can join, with their unrecorded races automatically scored as DNC |
| CM-07 | As a scorer, I want to delete a competitor entered in error so that they are removed from the series entirely |
| CM-08 | As a scorer, I want to exclude a competitor from results so that absent competitors don't appear in standings, while keeping them available to reinstate if they show up — with unrecorded races scored as DNC on reinstatement |
| CM-09 | As a scorer, I want to import competitors from a CSV file with a configurable column mapping so that bulk registration data can be loaded without manual entry |

## Race Setup

| ID | Story |
|----|-------|
| RS-01 | As a scorer, I want to add a race to a series so that I can record results for it |
| RS-02 | As a scorer, I want to record the start time per fleet for a race so that elapsed times can be calculated for rating-based fleets |
| RS-03 | As a scorer, I want to delete a race so that abandoned races or incorrectly added races can be removed |

## Finish Recording

_These stories describe a repetitive workflow, repeated for each competitor in the finish list._

| ID | Story |
|----|-------|
| FR-01 | As a scorer, I want to identify a competitor by sail number so that I can record their finish |
| FR-02 | As a scorer, I want to record a finish position for the identified competitor so that their race score can be calculated — offered when the competitor's fleet uses no rating system |
| FR-03 | As a scorer, I want to record a finish time for the identified competitor so that their corrected time and race score can be calculated — offered when the competitor's fleet uses a rating system |
| FR-04 | As a scorer, I want to record a result code for a competitor so that they are scored correctly for that race |
| FR-05 | As a scorer, I want to edit or remove a competitor's finish record, with the race automatically re-scored, so that mistakes can be corrected |

## Results Calculation

| ID | Story |
|----|-------|
| RC-01 | As a scorer, I want race scores calculated automatically as finishes are recorded so that standings are always current |
| RC-02 | As a scorer, I want series standings calculated automatically with discards applied per the configured profile so that the current series ranking is always available |
| RC-03 | As a scorer, I want ties in series standings broken per RRS Appendix A8 so that rankings are correct when competitors have equal net points |
| RC-04 | As a scorer, I want a single finish to produce standings under each of the fleet's rating systems independently so that dual-scored series produce separate results from one set of finish data |
| RC-05 | As a scorer, I want NHC ratings adjusted automatically after each race is scored so that each competitor's rating reflects their performance to date |
| RC-06 | As a scorer, I want the rating used for each race stored so that rescoring a past race uses the correct historical rating rather than the current one |
| RC-07 | As a scorer, I want corrections to a past race to cascade through subsequent races so that NHC adjustments and standings remain consistent |

## Results Publication

| ID | Story |
|----|-------|
| RP-01 | As a scorer, I want to view current standings for any race or for the series at any time so that I can review results as they develop |
| RP-02 | As a result viewer, I want to view a published results page so that I can see series standings and individual race results |
| RP-03 | As a scorer, I want to produce a static HTML results page combining series standings and individual race results, in a format matching Sailwave's presentation, so that it can be hosted and shared |
| RP-04 | As a scorer, I want to configure which fleets and rating systems appear on a results page so that I can produce separate pages for different audiences |
| RP-05 | As a scorer, I want to publish a results page to a public URL so that I can share it with sailors and result viewers without needing to host it myself — on first publish I verify my email address to claim the URL; subsequent publishes update the page immediately |

## Data Management

| ID | Story |
|----|-------|
| DM-01 | As a scorer, I want to export a series as a JSON file so that I can back it up, transfer it to another device, or share it with a co-scorer |
| DM-02 | As a scorer, I want to import a series from a JSON file so that I can restore from a backup or continue work started on another device |
| DM-03 | As a scorer, I want to see a list of all series on my device and delete ones I no longer need so that I can manage my data over time |

## Protests and Penalties

| ID | Story |
|----|-------|
| PP-01 | As a scorer, I want to apply redress (RDG) to a competitor's race result so that a protest committee's decision is reflected in the standings |
| PP-02 | As a scorer, I want to apply a scoring penalty (SCP) to a competitor's race result so that on-the-water penalties are reflected in the standings |

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
