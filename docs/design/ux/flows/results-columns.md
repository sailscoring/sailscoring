# Results Columns Flow

How a scorer sets the columns of a series' results tables. By default the
app chooses them from the competitor fields switched on in the series'
settings, as now. When the
organisers expect a layout of their own, the scorer can set the series'
columns: which ones, in what order, under what titles. That is the escape
hatch, and the design treats it as one, as the
[scoring codes flow](scoring-codes.md) does.

Context: [`results-columns.md`](../../results-columns.md), which records the
scope decided in October 2026: one ordered list per series, no layout the
scorer names or manages, a list that replaces the automatic choice rather
than sitting on top of it, custom fields, and a self-service
gate (`custom-columns`). This flow may change the design there.

---

## Design priorities, in order

1. **Automatic columns are the default, and they stay good.** A series that
   never needs this sees one extra line on the Competitor fields card and
   nothing else.
2. **Opening it is a deliberate act.** It takes one action and a screen
   saying what it is for and what it costs: from then on, the series'
   columns change only when the scorer changes them.
3. **The list is the whole truth.** What the dialog shows is what is
   published, in that order, under those titles. Nothing is worked out
   behind it, apart from leaving a column off a table where it means
   nothing.
4. **The detail stays in its own dialog.** The Competitor fields card keeps
   saying which fields are switched on, so which ones the competitor dialog
   and the importers ask for. Column order and titles are not added to the
   settings page.
5. **The arithmetic still reads left to right.** Competitor columns go
   where the organisers want them. The scoring columns keep their order.
6. **Race day doesn't change.** Finish entry, check-in and the competitors
   table look exactly as they do now.

---

## Where it starts

The Competitor fields card already decides what the results show.
Switching an optional field on there does two things today: the competitor
dialog, the competitors table and the importers ask for it, and the results
get a column for it. With automatic columns that stays true. Once a series
has its own columns, only the first part does: a field switched on is one
the series can show, and the list decides whether and where it does.
Expanded, the card ends with one line:

```
│  ☑ Club                                                              │
│  ☐ Nationality                                                       │
│  …                                                                   │
│                                                                      │
│  Results columns: chosen from these fields                           │
│  Do your results need other columns, in another order, or under      │
│  other titles?                                                       │
│  Change results columns…                                             │
│                                                                      │
│  [ Done ]                                                            │
```

Collapsed, the card's summary says nothing about columns while they are
automatic. Once the series has its own, the summary says so:

```
│ Competitor fields                                             Edit ▸  │
│ Sail, Helm, Crew, Club, Rig · Columns set for this series             │
```

and the expanded line becomes **Results columns: set for this series — Edit
results columns…**.

With the gate off, the line is absent. A series that already has its own
columns (one imported, or made in another workspace) says so instead:
*"This series sets its own results columns. Turn on **Custom results
columns** in Workspace settings to change them."* The columns still apply,
in the app and on every published page.

---

## Opening the dialog

The first time, the dialog opens on a screen that says what this is for:

```
┌─ Results columns ────────────────────────────────────────────────────┐
│                                                                      │
│  Sail Scoring chooses this series’ columns from the fields switched  │
│  on, and leaves out a column no boat has a value in. When you        │
│  turn a field on or a fleet changes, the columns follow.             │
│                                                                      │
│  Set your own when the organisers expect a particular layout:        │
│  another order, other titles, or a column only on some tables.       │
│  From then on the columns change only when you change them. You      │
│  can go back to automatic columns at any time.                       │
│                                                                      │
│                              [ Cancel ]  [ Set this series’ columns ]│
└──────────────────────────────────────────────────────────────────────┘
```

**Set this series' columns** shows the list, filled in with the automatic
columns as they are now. Nothing is saved yet. The series has its own
columns only once one is moved, retitled, hidden or added. A scorer who
looks around and closes the dialog has changed nothing, and next time sees
this screen again. Once the series has its own columns, the dialog opens
straight on the list.

---

## The list

```
┌─ Results columns ────────────────────────────────────────────────────────┐
│                                                                          │
│  COMPETITOR COLUMNS                       Standings  Races  Entry list   │
│  ⠿ Class                                      ✓        ✓        ✓        │
│  ⠿ Rank                                       ✓        ✓                 │
│  ⠿ Sail Number                                ✓        ✓        ✓        │
│  ⠿ Helm Club        Club                      ✓        ✓        ✓        │
│  ⠿ Helm                                       ✓        ✓        ✓        │
│  ⠿ Crew             one per line              ✓        ✓        ✓        │
│  ⠿ Rig              custom field              ✓                 ✓        │
│                                                                          │
│  [ Add a column ▾ ]                                                      │
│                                                                          │
│  STANDINGS                       in this order, after the competitor     │
│                                  columns                                 │
│  R1 … R6     the races                                                   │
│  Total                                                         Shown     │
│  Nett                                                          Shown     │
│                                                                          │
│  RACE RESULTS                                                            │
│  Finish                                                        Shown     │
│  ET          Elapsed time                                      Shown     │
│  TCC                                                           Shown     │
│  CT          Corrected time                                    Shown     │
│  Delta       Corrected time behind the winner                  Hidden    │
│  Points                                                        Shown     │
│                                                                          │
│  Use automatic columns                                         [ Done ]  │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Competitor columns are one list for every table.** The ticks say which
  tables each one appears on. Most of them are on all three, which is why
  there is one list rather than three. Rank has no tick under Entry list,
  because an entry list has no rank.
- **Moving a column**: drag it by its handle, use its small up and down
  arrows, or focus it and press **Alt+↑** / **Alt+↓**.
- **A retitled column shows its own title**, with the field it shows beside
  it in grey ("Helm Club — Club"). A column under its default title shows
  only that.
- **The scoring sections list only what the series' fleets use.** A
  scratch-only series' Race results section has Finish and Points. An NHC
  fleet adds New TCF and *Rating calculations* (the Q, S, α, Z and
  Adjustment columns, as one row). An ORC fleet adds IW. Their order is
  fixed and each row opens to hide or retitle it. The race columns can't
  be hidden: a standings table is its races.
- **Sail number and the primary name** can be moved and retitled but not
  removed. Every row has to say whose it is. Their editors have no *Remove*.
- **Use automatic columns** lists what it will undo (order, titles, hidden
  columns) and asks first. Custom fields keep their values, and
  automatic columns show them after the others.

---

## Editing a column

Selecting a row opens its editor in place of the list, with **← All
columns** to return:

```
┌─ Results columns ─────────────────────────────── ← All columns ──┐
│                                                                  │
│  Club                                                            │
│                                                                  │
│  Title         [ Helm Club            ]                          │
│                Leave blank to use “Club”. Press Enter for a      │
│                second line, e.g. for a title in two languages.   │
│                                                                  │
│  Shown on      ☑ Standings  ☑ Race results  ☑ Entry list         │
│                                                                  │
│                ☑ Leave it off a table where no boat has one      │
│                                                                  │
│  Remove column                              [ Cancel ] [ Save ]  │
└──────────────────────────────────────────────────────────────────┘
```

- **The title is plain text**, up to two lines. No HTML: the page's own
  styling sets how it looks.
- **Leave it off a table where no boat has one** is today's rule, on by
  default for every column it applies to. Turned off, the column is printed
  even when it is empty: an organiser's page template, kept the same from
  day one.
- **Remove column** takes it off the list. The field stays switched on,
  its values are kept, and *Add a column* offers it again.

A person column has one more block (see *Person columns*). A scoring row's
editor has only Title and a single *Shown* tick.

**Messages** (per [conventions](../conventions.md)):

- Title too long: "Keep the title to 40 characters or fewer."
- Title over two lines: "A title can have at most two lines."
- No table ticked: "Tick at least one table, or remove the column."

---

## Adding a column

**Add a column** opens a menu of everything the series could show and
doesn't:

```
│  [ Add a column ▾ ]                                              │
│  ┌────────────────────────────────────────────┐                  │
│  │ Boat name                                  │                  │
│  │ Nationality                                │                  │
│  │ Country           nationality, as a name   │                  │
│  │ Bow number                                 │                  │
│  │ ──────────────────────────────────────     │                  │
│  │ Sponsor           custom field             │                  │
│  │ ──────────────────────────────────────     │                  │
│  │ A new custom field…                        │                  │
│  └────────────────────────────────────────────┘                  │
```

- **Fields switched on** come first: any optional field switched on in the
  Competitor fields card whose column isn't in the list.
- **A field can have more than one column** where it can be shown more than
  one way. *Country* shows the nationality as the country's name, from the
  national-letters dataset. The WASZP Games 2025 publishes both. Every
  other field has one column.
- **A field that is switched off** isn't offered. To show one, the scorer
  switches it on in the Competitor fields card. Switching a field on
  while the series has its own columns adds its column to the end of the
  competitor columns, on every table. Switching one off removes its column.
  Without this, turning a field on would appear to do nothing. Custom
  fields work the same way.
- **A new custom field…** asks for a name and adds the field and its
  column in one step (see the next section).

A column added to Sail Scoring after a series set its own columns isn't
added to that series. It appears in this menu.

---

## Custom fields

Some organisers publish what no built-in field holds: a WASZP rig size, a
sponsor, a hull colour. In Sailwave, scorers put these in a field meant for
something else. Here the scorer adds a custom field: a text field they name
themselves, which the series' competitors each have one value for.

The Competitor fields card lists them after the optional fields, each with a
name that can be changed in place:

```
│  Custom fields                                                   │
│  [ Rig                ]  Delete                                  │
│  [ Sponsor            ]  Delete                                  │
│  [ Add a field ]                                                 │
│  Text the organisers publish that no field above holds. Not used │
│  for scoring, prizes or grouping. A Division or Category goes in │
│  a subdivision instead.                                          │
```

- **One line of text per competitor.** The competitor dialog shows each
  field after the built-in ones. The competitors table has a column for
  each, and search covers them.
- **Automatic columns show them** after the other competitor columns,
  left off a table where no boat has a value. A series doesn't need its
  own columns to publish a custom field.
- **CSV import** offers *A new custom field* for a spreadsheet
  column it can't map, named after the column's header. An entry list
  with a Rig column becomes a series with a custom field called Rig, in one
  step.
- **Deleting a field** that competitors hold values in says how many and
  asks first: "Rig holds values for 34 competitors. Deleting it removes
  them." The revision history can restore them. Nothing scores on a custom
  field, so nothing is refused.
- **They are published only as columns.** The public JSON export and the
  published results API carry a field's values only while it is a column on
  the page they describe. The `.sailscoring` file carries everything.

**Messages:**

- Name empty: "Name is required."
- Clash: "This series already has a field called Rig."
- Clash with a built-in: "Class is already a field. To publish it under
  another title, retitle its column."

---

## Person columns

The primary name, Helm, Owner and Crew columns say how they show more than
one person. This is where we go further than Sailwave, whose single
CrewName field scorers fill with "A, B, C".

```
│  Crew                                                            │
│                                                                  │
│  Title         [                      ]                          │
│                                                                  │
│  Show crew     ● In a column of their own                        │
│                ○ In the Helm column, after the helm (Helm / Crew)│
│                                                                  │
│  Several names ● One per line                                    │
│                ○ On one line, joined with “&”                    │
│  …                                                               │
```

- **Crew in the primary column** is today's "Helm / Crew" layout, which
  automatic columns choose when there is no separate Helm column. Here it is
  the scorer's choice. Chosen, the Crew row in the list reads *in the Helm
  column* and its ticks follow the primary column's.
- **Several names** appears only for a field that allows several names.
  One per line is today's table form. On one line is how one-line contexts
  already write them ("J. Murphy & M. Murphy"), and suits a two-handed
  crew in a wide table.

---

## What follows the columns

- **The in-app Standings tab** shows the series' own columns when it has
  them, so the app shows what will be published. Under automatic columns it
  keeps its own working layout (every field switched on, "Sail no.", "Nat"),
  with a column for each custom field. Its column sorting works as now.
- **Every published table**: standings, race results, the entry list and
  combined pages. The split-fleet championship pages show a fixed set of
  competitor columns (Nat, Sail, Class, Helm, Club, WS ID); the list orders
  and titles them, and leaves off any it removes.
- **The published results API** names the competitor fields that are
  columns on the page it describes, as it now names the fields switched on.
  Custom fields appear as data under their names. It doesn't
  describe the columns' order or titles.
- **Not the competitors table, finish entry or check-in.** The competitors
  table is where the data is edited, so it shows every field switched on.
  A finish-sheet row's label is built for the finish line, not for
  the results.
- **Not the prize-giving sheet or the starters checklist.** They are working
  documents with their own short layouts.

### The publishing toggles

The Publishing card's *Publish rating calculations* and *Show per-race
ratings in the summary* decide columns, so while a series has its own
columns they are rows in the list (*Rating calculations* under Race
results, and *Ratings beneath each score* with the seed rating under
Standings). The card says where they went: *"Rating calculations: set in
Results columns."* Setting the series' own columns starts each row from the
toggle's value. When the gate goes general, both toggles leave the
Publishing card and live only here.

*Publish track data* stays on the Publishing card. Publishing a boat's
speeds and distances is a choice about what the series publishes, as
publishing the officials is, and it isn't a layout question. While it is
on, the track-data columns are rows under Race results, which can be hidden
and retitled.

---

## Importing from Sailwave

With the gate on, the Sailwave import wizard reads the file's column
definitions: which fields it publishes, in what order, under what titles.
A file that publishes what Sailwave's own template publishes gets automatic
columns. Most club files do. Any other file gets its own columns, and the
wizard says so:

```
  This file publishes its own columns. They’ll be the series’ columns:
    Class · Rank · SailNo · Helm Club (Club) · HelmName · CrewName ·
    Rig (a new custom field) · races · Total · Nett
  Not carried:
    Fleet — Sail Scoring publishes each fleet on its own page.
    HelmEmail — personal data isn’t published as a custom field.
```

- **A published Sailwave field we model** becomes that field's column, with
  the file's title if it has one.
- **A published field we don't model** that holds values becomes a custom
  field, named after the column's title. Personal data never does:
  email, phone, address, photos, member numbers, medical details, notes and
  payments. The wizard lists them as not carried, with Fleet and Rating
  (each race's results show the ratings).
- **The order** is each definition's position field: Sailwave writes the
  definitions alphabetically, and sorting on it reproduces the published
  page. A Sailwave `<br>` in a title becomes its second line.
- **An update from a Sailwave file** keeps the series' own settings, so it
  carries no columns or custom fields.
- **Sailwave export** writes the series' columns back: order, published or
  not, and titles. A series with automatic columns writes them as they would
  be published.

With the gate off, the import gives automatic columns and lists the file's
own as a warning, as it does today for scoring codes.

---

## Use cases

**Irish Champions Cup 2025**: Class, Rank, SailNo, "Helm Club", HelmName,
CrewName. The scorer moves Class above Rank, retitles Club "Helm Club", and
gives Crew a column of its own. The Sailwave import does all three.

**Formula Kite Worlds 2026**: Rank, Nationality, "Bib Number", HelmName.
Nationality moves above the sail number, which is retitled "Bib Number".

**WASZP Games 2025**: Nat and Country side by side, then Gender, Division and
Rig. Nationality has two columns (the code with its flag, and *Country*).
Division is a subdivision axis. Rig is a custom field, from the
entry list's spreadsheet.

**ILCA 7 Worlds 2022**: HelmName before Sail, Nat retitled "MNA", the World
Sailing ID retitled "ISAF ID". One move and two titles. No new data.

**A keelboat series** with owner as the primary name and an eight-name
crew, published on standings only: Crew's ticks leave it off the race tables,
which stay narrow enough to read on a phone.

---

## What this asks of the renderer

- **One list of column definitions** behind every table that follows the
  columns, in place of the present `show*` flags. Each definition has a
  key, a default title, the tables it can appear on, how to render a cell,
  and whether it can be left off when empty. Automatic columns are a
  function from the series to a list, so the two modes render the same way.
- **The list holds every column the app knows when it is written**, shown
  or hidden, so a fleet added later gets its handicap columns. "Only where
  it means something" is decided per table, from the fleet's scoring.
- **A column appears on a table only when it means something there.** CT on
  a scratch fleet's table means nothing. Neither does Rank on an entry list.
  This is how the one list serves every table and every fleet.
- **Published HTML is unchanged for a series with automatic columns**, byte
  for byte. The refactor is checked against that before any of the UI lands.

---

## Open questions

Settled:

- **One title per column**, on every table it appears on. There are no
  titles per table.
- **The publishing toggles leave the Publishing card** when the gate goes
  general. They are then rows in this dialog only. Until then they move here
  only while a series has its own columns (see *The publishing toggles*).
- **The published results API keeps naming fields**, not columns.
  Describing the columns' order and titles, so an app can draw a page as
  published, is deferred to `horizon.md`.
