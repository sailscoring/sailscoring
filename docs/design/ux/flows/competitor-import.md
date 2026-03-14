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

The import screen has three steps. Step 2 (Map & Preview) is iterative —
the scorer can adjust freely before committing. Steps 1 and 3 are
one-time actions.

```
  [1. Upload]  ──▶  [2. Map & Preview]  ──▶  [3. Confirm]
```

The scorer can go back from step 2 to upload a different file, and back
from step 3 to adjust the mapping.

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
5. The scorer is taken to step 2.

---

## Step 2: Map & Preview

The core of the import flow. The screen is split: column mapping on the
left, live competitor preview on the right. Every change to the mapping
updates the preview instantly.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Import Competitors  ◀ Upload different file                            │
│                                                                         │
│  ┌─ Column mapping ──────────────────┐  ┌─ Preview (203 rows) ───────┐ │
│  │                                   │  │                            │ │
│  │  CSV column     Maps to           │  │  ⚠ 3 rows have errors      │ │
│  │  ───────────    ──────────────    │  │                            │ │
│  │  Sail No      → Sail number   ✓  │  │  Sail      Name     Fleet  │ │
│  │  Helm         → Helm name     ✓  │  │  IRL 1234  J Murphy Junior │ │
│  │  Boat         → Boat name     ✓  │  │  IRL 5678  B Larsen Senior │ │
│  │  Club         → Club          ✓  │  │  GBR 999   S Smith  Class 1│ │
│  │  Class        → Fleet      ⚠ *  │  │  IRL 0001  A Brennan Junior│ │
│  │  Div          → Division      ✓  │  │  ·                         │ │
│  │  TCC          → IRC TCC       ✓  │  │  ·                         │ │
│  │  NHC          → NHC number    ✓  │  │                            │ │
│  │  Notes        → — (ignored)      │  │  ⚠ Row 47: no sail number  │ │
│  │                                   │  │  ⚠ Row 112: no sail number │ │
│  │  * No 'Fleet' column found.       │  │  ⚠ Row 198: duplicate      │ │
│  │    Using 'Class' as fleet.        │  │    IRL 1234 (will update)  │ │
│  │    [Change ▾]                     │  │                            │ │
│  │                                   │  │                            │ │
│  └───────────────────────────────────┘  └────────────────────────────┘ │
│                                                                         │
│  [Cancel]                              [Review import →]               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Column mapping table

Each row shows one CSV column and the competitor field it maps to. The
scorer can change any mapping via a dropdown. Options in the dropdown:

- Sail number *(required — at least one column must map here)*
- Helm name
- Boat name
- Club
- Fleet
- Division
- IRC TCC
- NHC number
- Class *(descriptive boat type, not used for scoring)*
- — ignore —

Unmapped columns default to "— ignore —".

### Fleet column warning

If no "Fleet" column is found and the importer falls back to "Class" or
"Division", a warning note appears below the mapping table:

> *No 'Fleet' column found. Using 'Class' as fleet. [Change ▾]*

The scorer can accept this or use the dropdown to map a different column,
or select "— ignore —" to send all competitors to the default fleet.

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
| Helm name | helm, helmsman, helms, name, sailor, skipper, first name + last name (combined) |
| Boat name | boat, boat name, vessel, yacht |
| Club | club, sailing club, home club |
| Fleet | fleet |
| Division | division, div, group |
| IRC TCC | tcc, irc tcc, irc, time correction, tcf |
| NHC number | nhc, hph, nhc number, handicap |
| Class | class, boat class, boat type, dinghy class |

**Fleet fallback priority:** if no Fleet-matching header is found, the
importer looks for a Class header, then a Division header, and offers to
use whichever it finds first. If none are found, all competitors go to the
default fleet and no warning is shown (single-fleet series are common).

---

## Step 3: Confirm

A summary screen before the import runs.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Import Competitors  ◀ Adjust mapping                                   │
│                                                                         │
│  Ready to import                                                        │
│                                                                         │
│  177  competitors will be added                                         │
│   23  existing competitors will be updated                              │
│    3  rows skipped (errors)                                             │
│                                                                         │
│  Skipped rows:                                                          │
│    Row 47   — missing sail number                                       │
│    Row 112  — missing sail number                                       │
│    Row 198  — duplicate sail number IRL 9999 (row 12 takes precedence)  │
│                                                                         │
│  [◀ Adjust mapping]                    [Import 200 competitors]        │
└─────────────────────────────────────────────────────────────────────────┘
```

The import button label states the number of competitors that will actually
be written, not the total row count.

On confirmation, the import runs immediately (client-side, no server round-
trip) and the scorer is returned to the Competitors list with a success
banner: *"200 competitors imported. 3 rows skipped — see details."*

---

## After Import

Returning to the series settings screen:

- The **Competitors card** updates to show the count and fleet names.
- The **Fleets card** reflects any new fleets that emerged from the import.
- The **Scoring card** surfaces detected rating columns as suggestions if
  scoring has not yet been configured.

The scorer can import again at any time — to add late entries, apply bulk
rating updates, or correct registration data. Each import upserts cleanly.

---

## Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | When "first name" and "last name" are separate CSV columns, should the importer combine them into helm name automatically, or map them to separate fields? | Low — most exports provide a single name column; handle combined names as a known special case |
