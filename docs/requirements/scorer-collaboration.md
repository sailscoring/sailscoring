# Scorer Collaboration

How multiple scorers work together on a single event, and what the
application needs to support.

## How Scorers Work in Practice

Scoring work at an event follows a natural sequence of phases, each with
different collaboration characteristics.

### Setup (single scorer)

A single scorer creates the series by importing registered competitors
from an external system, configures scoring options (handicap system,
discard profile, etc.) per the Notice of Race and Sailing Instructions,
and looks up competitor handicaps from external sources. Other scorers
generally do not get involved until setup is complete.

### Pre-race corrections (low parallelism)

Before the first race, scorers may update competitor details -- fixing
spelling mistakes in helm or boat names, recording crew changes,
updating sail numbers. These edits are to different competitors and
rarely overlap.

### Race result entry (parallel by fleet, sequential within a fleet)

After each race, a scorer enters results from a recording sheet as a
single batch. One scorer typically handles all races for a given fleet.
If there are multiple fleets with separate recording sheets, different
scorers may enter those in parallel. Within a single fleet's race, entry
is done by one person.

### Post-entry corrections (moderate parallelism)

After initial entry, multiple scorers may process corrections in
parallel: resolving discrepancies in the recording sheet, handling a
separately-reported OCS list, applying protest jury decisions (penalties,
redress), or responding to scoring inquiries from competitors. These
corrections usually affect different competitors or different races, but
could occasionally touch the same result.

### Key observation

Scorers naturally coordinate their work -- they are at the same event
and communicate in person or via messaging. The application does not
need to replace this coordination, only avoid making it painful.

## Design Principles

**Optimistic concurrency, not locking.** Scorers should never be blocked
from viewing or editing any data. Conflicts are rare because scorers
work on different slices of the data (different competitors, different
races, different fleets). When a genuine conflict occurs -- two scorers
editing the same result at the same moment -- the application should
detect it and prompt the second scorer to review the change, rather than
silently overwriting.

**Autosave individual edits.** Changes should be persisted immediately
at the field level rather than requiring an explicit "save" action. This
keeps the conflict window extremely small and matches expected web
application behaviour.

**Audit trail over real-time presence.** Scorers do not need to see each
other's cursors or get live-updating cells. What they need is a clear
record of what changed, when, and by whom. For example: "Race 3 results
entered by Mark at 14:45", or "Competitor 42 Race 3 changed from DNF to
14:23:07 by Sarah at 15:10". This audit trail serves multiple purposes:

- Gives scorers confidence about the current state of the data
- Supports the correction workflow (what was changed and why)
- Provides accountability for protest committees and scoring inquiries
- Helps diagnose errors after the fact

**No series-level locking.** Locking an entire series while one scorer
works on it would unnecessarily block others and does not match how
scorers actually divide their work. The natural parallelism is at a
finer grain -- per race, per fleet, or per competitor.

## Conflict Handling

A conflict occurs when two scorers edit the same field (e.g. the same
competitor's result in the same race) between the time one of them
loaded the current value and submitted their change.

When this happens, the second scorer should see:

- The value they were trying to set
- The current value (set by the other scorer)
- Who made the other change and when
- The option to accept the current value or overwrite it

This should be a rare occurrence, not a routine part of the workflow.

## What Is Explicitly Out of Scope

- **Real-time collaborative editing** (Google Docs style with live
  cursors, operational transforms, or CRDTs). The data is structured
  and edits are discrete; this level of infrastructure is not justified.
- **Pessimistic locking** at any granularity. Scorers should not need to
  acquire locks before editing.
- **Automatic conflict resolution.** When conflicts occur, a human
  scorer should decide which value is correct.
