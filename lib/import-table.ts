/**
 * Shared entry point for tabular import files (.csv and .xlsx).
 *
 * Both importers (competitor list, finish sheet) consume a plain
 * `string[][]` — header row first — and everything downstream (column
 * auto-detection, mapping dialog, planners) is format-agnostic. This module
 * turns a picked File into those rows:
 *
 *   - CSV     → papaparse, exactly as the importers did before .xlsx support
 *   - .xlsx   → read-excel-file (lazy-loaded), cells stringified to match
 *               what the spreadsheet displays (see `stringifyCell`)
 *
 * The format is decided by content sniffing, not file extension — a CSV
 * renamed `.xlsx` (or vice versa, common with email attachments) still
 * imports. `.xls` (OLE2) and password-protected workbooks (also OLE2
 * containers) are detected and rejected with a friendly message.
 *
 * A workbook with several non-empty sheets can't be reduced to one table
 * here; it comes back as `kind: 'workbook'` and the importer shows a sheet
 * picker.
 */

import Papa from 'papaparse';

export interface WorkbookSheet {
  name: string;
  rows: string[][];
}

export type TabularParse =
  | { kind: 'table'; rows: string[][] }
  | { kind: 'workbook'; sheets: WorkbookSheet[] }
  | { kind: 'error'; message: string };

/** `accept` attribute for the importers' file inputs. */
export const TABULAR_IMPORT_ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const OLD_EXCEL_MESSAGE =
  'This looks like an old Excel file (.xls) or a password-protected workbook. ' +
  'Save it as .xlsx or CSV and try again.';

export const UNREADABLE_WORKBOOK_MESSAGE =
  "Couldn't read this file as a spreadsheet. Save it as .xlsx or CSV and try again.";

export const EMPTY_WORKBOOK_MESSAGE = 'No data found in this spreadsheet.';

/**
 * Cheap content sniff. `.xlsx` is a ZIP archive; legacy `.xls` and
 * password-protected `.xlsx` are both OLE2 compound files; anything else is
 * treated as CSV text.
 */
export function sniffTabularKind(bytes: Uint8Array): 'xlsx' | 'ole2' | 'text' {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'xlsx';
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return 'ole2';
  }
  return 'text';
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Stringify one worksheet cell to its CSV-equivalent text.
 *
 * read-excel-file hands back typed values; the importers expect the strings
 * a CSV export of the same sheet would contain. The interesting case is
 * date/time cells: a finish time typed as "10:31:05" is stored as a
 * fraction-of-day anchored at the workbook epoch, and comes back as a UTC
 * Date on the epoch day — year < 1905 covers both the 1900-system
 * (1899-12-30) and 1904-system (1904-01-01) epochs, and no real sailing
 * date predates them.
 */
export function stringifyCell(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    // Round to the nearest second: fraction-of-day serials don't convert to
    // milliseconds exactly, and the truncation can land a written 11:55:09
    // on 11:55:08.999.
    const d = new Date(Math.round(value.getTime() / 1000) * 1000);
    const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
    if (d.getUTCFullYear() < 1905) return time; // time-of-day cell
    const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    return time === '00:00:00' ? date : `${date} ${time}`;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/** Stringify a sheet's cells and drop fully-empty rows (papaparse's
 *  `skipEmptyLines` equivalent). */
export function normalizeSheetRows(data: readonly unknown[][]): string[][] {
  return data
    .map((row) => row.map(stringifyCell))
    .filter((row) => row.some((cell) => cell.trim() !== ''));
}

/** Reduce a workbook's sheets to a TabularParse: sheets with no data rows
 *  are invisible; one real sheet behaves exactly like a CSV. */
export function tabularFromWorkbook(sheets: WorkbookSheet[]): TabularParse {
  const nonEmpty = sheets.filter((s) => s.rows.length > 0);
  if (nonEmpty.length === 0) return { kind: 'error', message: EMPTY_WORKBOOK_MESSAGE };
  if (nonEmpty.length === 1) return { kind: 'table', rows: nonEmpty[0].rows };
  return { kind: 'workbook', sheets: nonEmpty };
}

/** Parse already-read file bytes. Exposed for tests; components use
 *  `parseTabularFile`. */
export async function parseTabularBytes(bytes: ArrayBuffer): Promise<TabularParse> {
  const kind = sniffTabularKind(new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength)));

  if (kind === 'ole2') return { kind: 'error', message: OLD_EXCEL_MESSAGE };

  if (kind === 'xlsx') {
    // Lazy-load the xlsx reader so CSV-only users never download it.
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    try {
      const sheets = await readXlsxFile(bytes);
      return tabularFromWorkbook(
        sheets.map((s) => ({ name: s.sheet, rows: normalizeSheetRows(s.data) })),
      );
    } catch {
      return { kind: 'error', message: UNREADABLE_WORKBOOK_MESSAGE };
    }
  }

  // CSV. TextDecoder strips a UTF-8 BOM, matching the old
  // Papa.parse(File) path (FileReader.readAsText does the same).
  const text = new TextDecoder().decode(bytes);
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true });
  return { kind: 'table', rows: parsed.data };
}

/** Parse a picked import file into rows (or sheets, or an error). */
export async function parseTabularFile(file: Blob): Promise<TabularParse> {
  return parseTabularBytes(await file.arrayBuffer());
}
