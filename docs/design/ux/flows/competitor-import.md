# Competitor Import Flow

Detailed user flow for S-04: Competitor Import — bulk-loading competitors
from a CSV file.

---

## Overview

Competitor import is the primary way to populate a series. Scorers receive
a registration export from their club system, event registration tool, or a
spreadsheet they maintain themselves. Column names and ordering vary widely;
the importer must be flexible without requiring manual mapping every time.

**Design priorities, in order:**

1. **Auto-detect well.** The importer should correctly identify common column
   names without scorer intervention. The mapping it produces should be right
   (or nearly right) before the scorer touches anything.
2. **Make adjustment easy.** When auto-detection is wrong, fixing it is a
   quick dropdown change — not a re-upload.
3. **Show the result immediately.** The preview updates live as the scorer
   adjusts the mapping. There is no "apply" step between changing a mapping
   and seeing what it produces.
4. **Remember.** A saved mapping means the second import from the same source
   requires no adjustment at all.

---

## Import Behaviour

**Upsert on sail number.** Import is not append-only. If a competitor with
the same sail number already exists in the series, their record is updated
with the values from the CSV. New sail numbers are added. Competitors not
mentioned in the CSV are left untouched.

This makes re-import safe and useful:

- Corrected registration lists can be re-imported without manual cleanup.
- Rating updates (IRC TCC, NHC) can be applied in bulk by re-importing
  a registration sheet with revised numbers — a deliberate workflow, not
  a side effect.

**Partial import.** Rows with validation errors are skipped; valid rows are
imported. Skipped rows are listed so the scorer can fix the source and
re-import (the second import will upsert cleanly).

---

## Entry Points

- **Competitors card** on the series settings screen (S-01): "Import CSV"
  button, prominent on a new series.
- **Competitors list** (S-03): "Import" button in the toolbar.

Both navigate to the same import screen.

---

## Steps

```
  [1. Upload] ──▶ [2. Fleets] ──▶ [3. Map & Preview] ──▶ [4. Renames] ──▶ [5. Confirm]
```

Steps 2 and 3 are iterative — the scorer can adjust freely before
committing. Step 4 appears only when the file looks like it contains
sail-number changes. Steps 1 and 5 are one-time actions. The scorer can go
back from any step to the one before it, and from step 2 to upload a
different file.

**Fleets comes first.** It is the consequential step: it creates persistent
objects, decides who is scored against whom, and sets the series' scoring
mode. Everything on the mapping screen is lower-stakes by comparison — which
column holds the boat name, which optional fields to show. Leading with
fleets also puts the split-into-fleets offer where a scorer will actually
read it, rather than below a mapping table they have just finished working
through and consider settled.

The two questions the fleet plan needs — which column groups the boats, and
which columns are ratings — are answerable from the *values* in the file, not
from its headers, so neither needs the mapping screen to have happened first.
Both are asked on the Fleets step and **only** there; see
[Columns the Fleets step owns](#columns-the-fleets-step-owns).

---

## Step 1: Upload

A drop zone with a "Choose file" fallback. Accepts `.csv` files.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Import Competitors                                                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │          Drop a CSV file here, or  [Choose file]               │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [Cancel]                                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

On upload:
1. The CSV is parsed client-side (no server round-trip).
2. Column headers are extracted.
3. Auto-detection runs against the headers (see [Auto-detection](#auto-detection)).
4. If a saved mapping exists for this set of headers, it is applied.
5. The scorer is taken to step 2, Fleets — which opens on the grouping and
   rating columns auto-detection has just proposed.

---

## Step 2: Fleets

The importer is the only place in the app that can create fleets *and* fill
them in one action — the Fleets card can make an empty fleet, and Competitors
→ bulk edit can move boats into an existing one, but only the import has both
the groups and the rows in front of it. That makes this step the natural home
for every fleet decision the file implies.

### What this step owns, and what the Fleets card keeps

| Decision | Owned by |
|----------|----------|
| Which fleets exist | This step, for fleets the file implies; the Fleets card for any others |
| Which boats are in them | This step; afterwards, Competitors → bulk edit |
| Scoring system per fleet | This step; changeable later on the Fleets card |
| Display order, start groups, ECHO α, custom NHC profile | Fleets card only |

This is the answer to "why is there still a Fleets step after the import
planned my fleets": the import settles existence, membership and system;
the Fleets card settles ordering and race mechanics. Series setup's Fleets
step should open by naming what the import just created — *"3 fleets created
by the import"* — so it reads as review rather than a second pass at the same
question.

### Columns the Fleets step owns

Two column decisions belong to this step, and are made nowhere else:

- **Grouping** — which column splits the boats into fleets.
- **Ratings** — which column holds each rating system's numbers.

Auto-detection proposes both from the headers, so the step usually opens with
them already right.

The two are owned differently, because they are different kinds of thing.
**Ratings are competitor fields**, so they occupy a column's mapping — and
the mapping screen does not offer any rating role in its dropdowns; it shows
those columns as already assigned, with a link back here. Releasing one
happens here too: setting a system's column to "— none —" returns it to the
mapping screen as unmapped. **Grouping is not a competitor field** — there is
no `Competitor.fleet`, only `fleetIds` — so it is state this step holds,
naming a column, leaving that column's own mapping alone.

Either way the plan cannot change after this step. The alternative — a rating
role editable on both screens — means a scorer can settle the fleet plan and
then, a screen later, set the NHC column to "ignore", silently invalidating
the plan they just approved. Re-deriving the plan behind their back is worse,
and warning them about it at the end is worse still. The columns that
determine the plan are editable in exactly one place, and that place is where
the consequences are on screen.

For the same reason the step is never skipped, only collapsed. A re-import
that proposes no new fleets shows a summary line and a Next button — but it
is still the only place a mis-detected rating column can be fixed, so it
stays in the sequence.

### One column groups the boats, and the scorer picks it

Only a `Fleet` header is auto-detected as the grouping column. A `Class`
header auto-detects to boat class and `Division` to subdivision
(`lib/csv-import.ts`), and neither is a fallback for grouping: a file with a
`Class` column and no `Fleet` column proposes one fleet for everybody. That
is deliberate — boat class and fleet are different things, and a scorer whose
classes happen to be their fleets should say so once rather than have the
importer guess.

Saying so once is this step's job, and it asks as an offer rather than a
warning:

> **One fleet — all 43 boats.**
> Split them by [Class ▾]?  ·  Columns with a small number of repeated
> values are offered here.

Declining is a normal outcome — single-fleet series are common — and the step
then collapses to that one line.

**Grouping is not a column role.** It is a choice this step records, naming a
column; it does not consume that column's mapping. So a `Class` column used
for grouping stays mapped to Class as well, and a boat in "Cruisers 2" keeps
that as its boat class through the ordinary path — visible in the mapping
table, and enabling the Class field by the same rule as any other mapped
column.

This replaces a derived fallback that wrote the fleet name into `boatClass`
whenever the file had no Class column and no competitor carried a class. That
rule existed only because a column could hold one role at a time, so a column
used for grouping could not also be a Class column. It was invisible to the
scorer, it did not enable the field it wrote to, and with no fleet column at
all it wrote the literal string "Default" as every boat's class. Making
grouping a separate choice removes the need for it.

### The proposal

Fleets are proposed per fleet-name group, from the rating columns identified
above (the rules live in `lib/competitor-import-plan.ts`):

- **No rating columns** → one scratch fleet, bare group name.
- **One rating system** → one fleet of that system, bare group name.
- **Two or more** → one fleet per system, named `<group> (IRC)`, `<group> (NHC)`.

Existing fleets are reused by case-insensitive name match; the plan never
changes an existing fleet's scoring system, it suffixes instead.

### The proposal is a starting point, not the answer

Every proposed fleet is editable before import, and a group can be given
fleets the file says nothing about. This replaces the single hard-coded
"also score on scratch" checkbox, which solved one club's line-honours case
and left every other combination to a three-screen workaround.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Import Competitors  ◀ Upload different file                            │
│                                                                         │
│  Fleets                                                                 │
│                                                                         │
│  Group boats by  [Class ▾]         4 groups · 43 of 43 rows grouped     │
│  Ratings         NHC ← [NHC ▾]     IRC ← [— none — ▾]       [+ Add ▾]   │
│                                                                         │
│  ┌─ Cruisers 1 ─────────────────────────────────── 24 rows ─────────┐  │
│  │  Cruisers 1        [NHC ▾]  [All boats     ▾]  24 boats      ✕   │  │
│  │  Cruisers 1 (IRC)  [IRC ▾]  [All boats     ▾]  24 boats      ✕   │  │
│  │    ⚠ No IRC column in this file — every boat joins for now.      │  │
│  │  [+ Also score on ▾]                                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ Cruisers 2 ─────────────────────────────────── 19 rows ─────────┐  │
│  │  Cruisers 2        [NHC ▾]  [All boats     ▾]  19 boats      ✕   │  │
│  │  [+ Also score on ▾]                                             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  [Cancel]                                  [Next: Map columns →]       │
└─────────────────────────────────────────────────────────────────────────┘
```

Per proposed fleet the scorer can change the **name**, change the **scoring
system**, choose **membership**, or remove the fleet from the plan. Per group
they can add a fleet for any system the workspace has enabled. A fleet that
reuses an existing one is marked as such and its system is fixed — the plan
still never mutates a fleet that already has races behind it.

The system picker honours the same feature gates as the Fleets card
(`irc-rating`, `rya-py`, `vprs`, `echo`; NHC and scratch ungated), and — as
there — offers a system a reused fleet already uses even when the workspace
has opted out of it.

### Membership: the subset problem

A second fleet over the same group is usually **not** the same boats. At HYC
every boat in Cruisers 1 carries an NHC rating, but only some of them buy an
IRC certificate; the IRC fleet is a strict subset. Scratch is the exception —
everyone crosses the line — which is exactly why the old hard-coded scratch
sibling could copy the whole group without anyone noticing the assumption.

So membership is an explicit choice per fleet, with two options:

- **All boats** — every row that named this group.
- **Rated boats only** — rows with a value in this system's rating column.
  Rows with no rating in *any* identified column count as unrated everywhere
  and join every fleet in the group, so a placeholder rating gets the DNC
  pressure it deserves rather than quietly vanishing. Disabled, with a hint,
  when the file has no column for that system.

Defaults preserve today's behaviour: a single inferred system takes all boats,
a multi-system split takes rated boats only, and an added scratch fleet takes
all boats.

An added **rating** fleet with no column in the file — the case this step
exists to serve — can only default to all boats, because the file does not
say who holds a certificate. The scorer prunes afterwards. The moment that
truth actually arrives is the Update handicaps wizard: the boats the IRC
listing matches are precisely the certificated ones, so that wizard is where
the fleet gets trimmed to them. Specified in
[update-handicaps.md](update-handicaps.md#fleet-membership-planned); not part
of this step.

### Series scoring mode

The importer flips the series to handicap scoring when the plan contains any
rating fleet. That flip keys off the **plan**, not off which columns were
detected — a scorer who adds an IRC fleet to a file with no rating columns at
all still gets a handicap series. Because the plan is settled here and no
later step can change it, the flip is known from this point on and is
restated on the confirm screen.

### Rejected: one fleet scored several ways

Modelling a fleet as a set of boats with several scorings hung off it would
remove the suffixed clones and the membership question in one move, and it
matches how results are published (Class 1 IRC and Class 1 ECHO as two tables
over one class). It is wrong for the domain: the groups genuinely differ, as
the Cruisers 1 subset above shows. A fleet stays a set of boats scored one
way.

---

## Step 3: Map & Preview

The remaining columns: who each row is, and which optional fields to show.
The screen is split: column mapping on the left, live competitor preview on
the right. Every change to the mapping updates the preview instantly.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Import Competitors  ◀ Fleets                                           │
│                                                                         │
│  ┌─ Column mapping ──────────────────┐  ┌─ Preview (203 rows) ───────┐ │
│  │                                   │  │                            │ │
│  │  CSV column     Maps to           │  │  ⚠ 3 rows have errors      │ │
│  │  ───────────    ──────────────    │  │                            │ │
│  │  Sail No      → Sail number   ✓  │  │  Sail      Name     Fleet  │ │
│  │  Helm         → Helm name     ✓  │  │  IRL 1234  J Murphy Cruis 1│ │
│  │  Boat         → Boat name     ✓  │  │  IRL 5678  B Larsen Cruis 1│ │
│  │  Club         → Club          ✓  │  │  GBR 999   S Smith  Cruis 2│ │
│  │  Class        → Class         ✓  │  │  IRL 0001  A Brennan Cruis 2│ │
│  │  Nat          → Nationality   ✓  │  │  ·                         │ │
│  │  Notes        → — (ignored)      │  │  ·                         │ │
│  │                                   │  │                            │ │
│  │  Set on the Fleets step:          │  │  ⚠ Row 47: no sail number  │ │
│  │    NHC        → NHC rating        │  │  ⚠ Row 112: no sail number │ │
│  │    [◀ Change in Fleets]           │  │  ⚠ Row 198: duplicate      │ │
│  │                                   │  │    IRL 1234 (will update)  │ │
│  └───────────────────────────────────┘  └────────────────────────────┘ │
│                                                                         │
│  [Cancel]                                     [Review import →]        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Column mapping table

Each row shows one CSV column and the competitor field it maps to. The
scorer can change any mapping via a dropdown. The dropdown lists **roles**,
not storage slots — the role that matches the series' primary label is
marked `(primary — required)` and becomes the only mandatory non-sail
column. The other role remains available as an optional field.

Example dropdown for a series with primary = Owner:

- Sail number *(required — at least one column must map here)*
- Alt sail number *(secondary identifier, used as fallback during finish lookup)*
- Owner name *(primary — required)*
- Boat name
- Helm name
- Crew name
- Club
- Subdivision / Class / Nationality / Gender / Age
- — ignore —

**The rating roles are absent from this dropdown.** They are set on the
Fleets step and shown here as already assigned, below the editable rows, with
a link back. Leaving them selectable would reintroduce by the back door
exactly what [Columns the Fleets step owns](#columns-the-fleets-step-owns)
rules out — a plan the scorer approved, quietly invalidated one screen later.

Fleet is absent for a different reason: it is not a role. The column that
groups the boats is named on the Fleets step and keeps whatever mapping it
has here, which is how a Class column can group the fleets *and* record each
boat's class.

If primary is Helm, the Helm row becomes `(primary — required)` and Owner
is the optional role. If primary is the generic "Competitor" or "Entrant",
the primary row is labelled accordingly and both Helm and Owner are
available as optional roles.

Under the hood: the primary role maps to `Competitor.name`; other roles
map to their respective optional fields (`Competitor.owner`, `Competitor.helm`).
The scorer never sees this — they just see role labels.

Unmapped columns default to "— ignore —".

### Series-level proposals

This step surfaces two series-level proposals alongside column mapping:

- **Primary identifier** — a radio group: Competitor / Entrant / Helm /
  Owner. Auto-proposed from the detected column roles:
  - Both Owner and Helm columns present → **Owner** (cruiser pattern).
  - Owner only → Owner.
  - Helm only → Helm.
  - Neither → fall back to the current series primary, defaulting to
    Competitor on a new series.
- **Optional fields to enable** — a checklist of all optional competitor
  fields. Auto-proposed: any mapped column whose target is an optional
  field is enabled.

Both proposals are editable before import. Changes are only written to the
series when the scorer clicks Import.

**Subsequent imports** (when the series already has competitors) respect
existing field config and only propose *additive* changes — new fields are
offered for enablement, but the primary label is not flipped away from the
one already configured. Scorers can still override both manually before
importing.

### No fleet column

The importer never falls back to Class or Division for grouping, and this
screen says nothing about a missing Fleet column — the Fleets step has
already raised it, where the scorer could see what a split would produce.
See [One column groups the boats](#one-column-groups-the-boats-and-the-scorer-picks-it).

### Preview panel

The preview shows all rows parsed under the current mapping. Columns shown
match the mapped fields (unmapped columns are hidden). Errors appear inline
at the bottom of the list and as a count at the top.

**Error types shown in preview:**

| Error | Display |
|-------|---------|
| Missing sail number | Row highlighted; shown in error list |
| Duplicate sail number within the CSV | Flagged as a warning — last occurrence wins |
| Duplicate sail number vs existing competitor | Shown as "will update" — not an error |

The preview scrolls independently of the mapping panel. The scorer can
check specific rows while keeping the mapping visible.

### Saved mapping

After a successful import, the column mapping is saved, keyed on the set of
CSV column headers. On the next import with the same headers (regardless of
column order), the saved mapping is pre-applied and a note appears:

> *Column mapping from your previous import applied. Adjust if needed.*

Saved mappings are stored at the application level, not per-series, since
the same registration source is likely used across multiple series.

---

## Auto-detection

Auto-detection matches CSV column headers (case-insensitive, ignoring spaces
and punctuation) against known field names and common aliases.

| Competitor field | Recognised header variants |
|-----------------|---------------------------|
| Sail number | sail, sail no, sail number, sail #, sail_no, sailno |
| Alt sail number | alt sail, alt sail no, alt sail number, alt_sail_no, alternative sail, alternate sail |
| Helm name | helm, helmsman, helms, skipper |
| Owner name | owner, boat owner, entrant |
| Primary name | name, sailor, first name + last name (combined) |
| Boat name | boat, boat name, vessel, yacht |
| Club | club, sailing club, home club |
| Fleet | fleet |
| Subdivision | division, category, age category / group / band |
| IRC TCC | tcc, irc tcc, irc tcc, irc, irc rating, time correction, tcf |
| NHC number | nhc, nhc number, nhc rating, handicap |
| Class | class, boat class, boat type, dinghy class |
| Nationality | nat, nationality, country |
| Gender | gender, sex |
| Age | age |

**No fleet fallback.** Only a Fleet-matching header is auto-detected as the
grouping column. Class maps to boat class and Division to subdivision — both
are their own fields, not stand-ins for fleet. When no Fleet column is found,
all competitors go to one fleet and the Fleets step offers to split them by
any column the scorer picks.

---

## Step 4: Renames

Shown only when the file looks like it contains sail-number changes.

Import upserts on sail number, so a boat that changed its number between
imports would otherwise arrive as a brand-new competitor while the old
record lingers holding all the results — the same boat twice, with the
finishes on the wrong one.

A candidate pairs a CSV row whose sail number matches no existing
competitor with an existing competitor whose sail number appears nowhere in
the file, where the two share a fleet set *and* a matching boat name or
person name (`detectSailNumberChanges` in `components/competitor-import.tsx`,
matching in `lib/competitor-matching.ts`). Both halves are required: something
appeared, something disappeared, and a name agrees.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Sail number changes?                                                   │
│                                                                         │
│  ☑  IRL 1234 → IRL 5678   Aurelia — J Murphy      matched on boat name  │
│  ☐  IRL 4321 → IRL 8765   Kestrel — B Larsen      matched on helm       │
│                                                                         │
│  [◀ Back]                          [Apply 1 change & import]           │
└─────────────────────────────────────────────────────────────────────────┘
```

Ticked updates the existing competitor to the new number, keeping its
results. Unticked imports it as a new competitor.

This step needs both the fleet plan (fleet identity for a CSV row comes from
it — reused fleets contribute their real id, planned fleets a placeholder
key) and the full column mapping (sail, boat name, primary, helm). That is
why it sits after both. A row destined only for a fleet that doesn't exist
yet can never pair with an existing competitor, which is correct and costs
nothing.

---

## Step 5: Confirm

A summary screen before the import runs. Fleet creation is reported
explicitly — the scorer sees exactly what structural changes the import
will make, not just how many rows are affected.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Import Competitors  ◀ Back                                             │
│                                                                         │
│  Ready to import                                                        │
│                                                                         │
│  147  competitors will be added                                         │
│   23  existing competitors will be updated                              │
│    3  new fleets will be created: Class 1, Class 2, Class 3            │
│                                                                         │
│  Series settings changes:                                               │
│    • Primary identifier:    Competitor  →  Owner                        │
│    • Optional fields on:    Boat name, Helm name, Crew name             │
│                                                                         │
│    3  rows skipped (errors)                                             │
│                                                                         │
│  Skipped rows:                                                          │
│    Row 47   — missing sail number                                       │
│    Row 112  — missing sail number                                       │
│    Row 198  — duplicate sail number IRL 9999 (row 12 takes precedence)  │
│                                                                         │
│  [◀ Back]                              [Import 170 competitors]        │
└─────────────────────────────────────────────────────────────────────────┘
```

The "Series settings changes" block appears when the wizard's proposed
primary label or enabled-field list differs from what's currently saved on
the series. On a first import it is the norm; on subsequent imports it
typically only appears when the new CSV introduces a field that wasn't
enabled before.

The fleet creation line is prominent — **"3 new fleets will be created:
Junior, Senior, Class 1"**. If all fleet values in the CSV match existing
fleets, this line does not appear (no new fleets). If some values match
and others are new, only the new ones are listed.

Each new fleet is listed with the scoring system and membership settled in
step 2, so the confirm screen restates the plan rather than announcing
defaults the scorer has not seen. A switch to handicap scoring is restated
here too. Start group assignment is not part of the import; that is set on
the Fleets card afterwards.

The import button label states the number of competitors that will actually
be written, not the total row count.

On confirmation, the import runs immediately (client-side, no server round-
trip) and the scorer is returned to the Competitors list with a success
banner:

> *170 competitors imported. 3 new fleets created. 3 rows skipped —
> see details.*

The banner reports fleet creation alongside the competitor count so the
result is never a surprise.

---

## After Import

Returning to the series settings screen:

- The **Competitors card** updates to show the count and fleet names.
- The **Fleets card** reflects the new fleets created by the import, already
  carrying the scoring system chosen in step 2. What is left to set is
  display order, start groups, and any per-system parameters (ECHO α, a
  custom NHC profile). In series setup this card is the Fleets step, and it
  leads with a line naming what the import created.
- The **Scoring card** surfaces detected rating columns as suggestions if
  scoring has not yet been configured.

The scorer can import again at any time — to add late entries, apply bulk
rating updates, or correct registration data. Each import upserts cleanly.
Subsequent imports that introduce new fleet values will again report fleet
creation explicitly in the confirmation step.

---

## Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | When "first name" and "last name" are separate CSV columns, should the importer combine them into helm name automatically, or map them to separate fields? | Low — most exports provide a single name column; handle combined names as a known special case |
