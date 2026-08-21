# .xlsx import fixtures

Binary workbooks exercised by `tests/import-table.test.ts` (and reused by the
import e2e specs).

| File | Exercises |
|---|---|
| `finish-sheet-times.xlsx` | real time-formatted cells (`hh:mm:ss` serials), numeric sail numbers, a result-code row, an unregistered sail |
| `competitors.xlsx` | text cell with leading zeros (`007`), a boat name containing a comma (the HalSail CSV silent-drop case), numeric PY |
| `multi-sheet.xlsx` | sheet picker: an Instructions sheet, an Entries sheet, and an empty sheet (which must not be offered) |
| `edge-cases.xlsx` | formula with cached result, rich text, boolean, real date, General-format fraction, merged cells, mid-sheet empty row, phantom used-range out to Z50 |
| `date1904.xlsx` | 1904-date-system workbook (legacy Mac Excel) with a time cell |
| `racesense-regatta.xlsx` | a RaceSense regatta export in miniature — see below |
| `racesense-sample-league.xlsx` | the same format at full size, over the sample club league's 45 boats; feeds the `racesense-import` feature shot, not a test |

## `racesense-regatta.xlsx`

Three `Race N` sheets and a `Summary`, laid out exactly as
`docs/notes/racesense/import-format.md` describes, for three boats (sails
15, 22, 254) of a "Spring Championship" / "Fleet A" on 2026-04-11. Every
cell is text, as RaceSense writes them.

| Sheet | What it exercises |
|---|---|
| `Race 1` | An ordinary race: two finishers with fractional-second times, one DNF |
| `Race 2` | 22 is `OCS` and appears in the DNF tail — the case where the Status column is the only record of the penalty; 15 is `OCS (Cleared)` and keeps her finish |
| `Race 3` | No line recorded (no `Boat Location` / `Pin Location`, a four-column Starts header) and no Finishes block at all |
| `Summary` | The results grid, agreeing with all three race sheets — so the parser's cross-check stays quiet |

`pnpm racesense:inspect tests/fixtures/xlsx/racesense-regatta.xlsx` prints
the whole thing, which is the quickest way to see what it contains.

## Regenerating

All but the RaceSense workbook were generated with exceljs (dev-only, not a
dependency of this repo): a throwaway script builds each and writes it here.
To regenerate, recreate the cells described above — the unit test assertions
document the expected cell-by-cell contents precisely.

`racesense-regatta.xlsx` holds nothing but text cells, so it was written
without a spreadsheet library at all: a stored-deflate ZIP of
`[Content_Types].xml`, the workbook and its rels, one `<worksheet>` per
sheet with `t="inlineStr"` cells, and empty `sharedStrings.xml` /
`styles.xml` parts (read-excel-file expects both to exist). The layout to
reproduce is the table above; `pnpm racesense:inspect` on the result
confirms it round-trips.
