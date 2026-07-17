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

Generated with exceljs (dev-only, not a dependency of this repo): a
throwaway script builds each workbook and writes it here. To regenerate,
recreate the cells described above — the unit test assertions document the
expected cell-by-cell contents precisely.
