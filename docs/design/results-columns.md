# Results Columns

Which columns a series' results tables show, in what order, and under what
titles. By default the app chooses them from the competitor fields switched
on in the series' settings, as it does now. A series whose organisers expect a particular layout can set
its own columns. The UX is in
[`ux/flows/results-columns.md`](ux/flows/results-columns.md), and it may
change what follows.

## Context

Scorers coming from Sailwave are used to choosing every column. Sailwave has
about 200 fixed fields. Each can be shown in its grid and published
separately, retitled (HTML allowed, which is how two-language headers are
made), and moved up or down. Rank, Total and Nett are columns like any
other. Its manual tells scorers that "you can use any field to store the
data you want", and they do. Published championship pages in
`reference-docs:events/` show what that produces:

- **Order.** Class before Rank (Irish Champions Cup 2025), Helm before Sail
  (ILCA 7 Worlds 2022), Nationality first (Formula Kite Worlds 2026).
- **Titles.** "Bib Number", "Helm Club", "MNA", "ISAF ID".
- **Repurposed fields.** Boat holding gender (29er Worlds 2023), and Rig and
  Country (the WASZP Games 2025, which also shows Nat).

Here, a series switches optional competitor fields on and off
(`enabledCompetitorFields`). The order is fixed in code, and so are the titles,
except for the primary person's label, the subdivision axes' labels and the
plurals of multi-person fields. A few publishing toggles decide whether
handicap columns are shown (`publishRatingCalculations`,
`showPerRaceRatingsInSummary`, `publishTrackData`). Columns no boat has a
value in are left out. There are no custom fields. Subdivision axes come
closest, but they carry meaning for prizes and filtering.

## Decided

Scoped October 2026.

- **Automatic columns stay the default**, chosen exactly as now. A series
  that never needs this sees one extra line in its settings.
- **A series can set its own columns** behind a self-service feature gate,
  `custom-columns`. It is one ordered list per series, used by every fleet
  and every page. There are no workspace layouts, templates, or per-fleet or
  per-page lists. A layout is not something the scorer names or manages.
- **The list replaces the automatic choice. It doesn't sit on top of it.**
  Setting columns writes the whole list, starting from the automatic
  columns of that moment. Going back to automatic columns discards the
  list. A column added to the app later isn't added to a series that has
  its own columns, but it is offered under *Add a column*. That is the
  price of a model the scorer can read straight off the screen.
- **Competitor columns can be moved, retitled, hidden, and limited to some
  tables**: standings, race results, entry list. Rank moves among them,
  which is how Class comes before Rank. Sail number and the primary name can
  be moved and retitled but not removed.
- **The scoring columns stay in order and can't be moved, only hidden or
  retitled**: a fixed-handicap fleet's Rating, races, Total and Nett in the standings, and the
  elapsed/rating/corrected sequence in race results. The arithmetic
  reads left to right. The race columns themselves can't be hidden.
- **A column shows only where it means something.** A CT column stays off a
  scratch fleet's table, and a column that hides when empty stays off a
  table where no boat has a value. That decides which tables a column
  appears on. It doesn't change the list.
- **Custom fields.** A custom field is a text field the scorer adds to a
  series and names ("Rig", "Sponsor"), holding one value per competitor. They aren't used for
  scoring, prizes or grouping (subdivision axes do that). They are published
  only when they are columns.
- **Person columns choose how they show several names**: one per line, or
  on one line joined with " & ". Crew can have a column of its own or sit
  in the primary column ("Helm / Crew"). This is a choice where today it is
  a rule.
- **In-app standings follow the columns**, so the app shows what will be
  published. The competitors table and finish entry don't change.
- **Out of scope:** attributes per person (an ID, gender or age for each
  crew member, as Sailwave's CrewId and CrewSex give one crew); HTML in
  titles; column widths; formats per column; computed columns.

## Model sketch

```ts
Series.columns?: ResultsColumn[];        // absent = automatic
Series.customFields?: { id: string; label: string }[];
Competitor.customFields?: Record<string, string>;   // keyed by field id; sparse

interface ResultsColumn {
  key: string;            // 'sailNumber' | 'club' | 'rank' | 'total' | 'ct' |
                          // 'subdivision:<axisId>' | 'field:<fieldId>' | …
  title?: string;         // absent = the default title
  tables?: ('standings' | 'races' | 'entries')[];  // competitor columns only
  hideWhenEmpty?: boolean;
  names?: 'lines' | 'joined';   // person columns
}
```

The list holds every column the app knows when it is written, shown or
hidden, so a fleet added later still gets its handicap columns.

## Work

1. **A column registry, with no visible change.** Every table (the published
   standings, race, entry-list and split-fleet tables, the in-app Standings
   tab, the published results API's competitor fields) renders from one list
   of column definitions. The automatic columns are computed by today's
   rules. Published HTML must come out byte-identical.
2. **The series model.** `columns`, `customFields` and the competitors'
   values, carried through storage (a migration), validation, the
   `.sailscoring` file, the public export, `copySeries` and revision
   history.
3. **Custom fields**: the Competitor fields card, the competitor
   dialog, CSV import, the competitors table and search.
4. **The gate, the settings line and the Columns dialog.** The publishing
   toggles move into the dialog while a series has its own columns, and
   leave the Publishing card when the gate goes general.
5. **Published pages and the API** follow the list. The API carries custom
   fields as data.
6. **Sailwave import and export** carry a file's published columns, order
   and titles. Sailwave fields we don't model become custom fields, except personal data (email, phone, address, medical).
7. Help, the feature inventory and screenshot, the gating docs, and a check
   of the privacy policy: custom fields may hold personal data.

## Settled since

- **One title per column**, used on every table it appears on.
- **The publishing toggles leave the Publishing card** for good once the
  gate is general. *Publish rating calculations* and *Show per-race ratings
  in the summary* become rows in the Results columns dialog only, and the
  automatic columns keep their present defaults. Until then, they move into
  the dialog only while a series has its own columns.
- **The published results API keeps naming fields.** Describing the
  columns' order and titles is deferred (see `horizon.md`).
