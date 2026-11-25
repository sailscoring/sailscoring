/**
 * Writes a series workbook (`series-workbook`) as an Excel `.xlsx`.
 *
 * Kept apart from the model so the writer, which pulls in a zip library, is
 * loaded only when a scorer actually exports.
 */

import type { CellFormat, SeriesWorkbook, WorkbookCell, WorkbookSheet } from './series-workbook';

export const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const SECONDS_PER_DAY = 86_400;
const MUTED = '#999999';

/** Excel's number formats for the model's. A duration runs past 24 hours
 *  (`[h]`); a recorded fraction of a second keeps its decimals. */
function numberFormat(format: CellFormat, value: number): string {
  const fraction = Number.isInteger(value) ? '' : '.00';
  switch (format) {
    case 'duration': return `[h]:mm:ss${fraction}`;
    case 'time': return `hh:mm:ss${fraction}`;
    case 'date': return 'yyyy-mm-dd';
    case 'decimal1': return '0.0';
    case 'decimal3': return '0.000';
    case 'decimal4': return '0.0000';
  }
}

type XlsxCell = Record<string, unknown> | null;

function xlsxCell(cell: WorkbookCell | null): XlsxCell {
  if (cell === null) return null;
  const style = {
    ...(cell.bold ? { fontWeight: 'bold' } : {}),
    ...(cell.muted ? { textColor: MUTED } : {}),
  };
  const { value, format } = cell;
  if (typeof value === 'boolean') return { type: Boolean, value, ...style };
  if (typeof value === 'string') {
    if (format === 'date') {
      const [y, m, d] = value.split('-').map(Number);
      return { type: Date, value: new Date(Date.UTC(y!, m! - 1, d!)), format: 'yyyy-mm-dd', ...style };
    }
    return { type: String, value, ...style };
  }
  if (format === 'duration' || format === 'time') {
    return { type: Number, value: value / SECONDS_PER_DAY, format: numberFormat(format, value), ...style };
  }
  return { type: Number, value, ...(format ? { format: numberFormat(format, value) } : {}), ...style };
}

/** Sheet names are limited to 31 characters and a few characters are
 *  reserved. */
function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
}

function xlsxSheet(sheet: WorkbookSheet) {
  const header = sheet.noHeader
    ? []
    : [sheet.columns.map((c) => ({ type: String, value: c.header, fontWeight: 'bold' }))];
  return {
    sheet: sheetName(sheet.name),
    data: [...header, ...sheet.rows.map((row) => row.map(xlsxCell))],
    columns: sheet.columns.map((c) => ({ width: c.width ?? Math.max(8, Math.min(30, c.header.length + 2)) })),
    ...(sheet.noHeader ? {} : { stickyRowsCount: 1 }),
    ...(sheet.frozenColumns ? { stickyColumnsCount: sheet.frozenColumns } : {}),
  };
}

export async function workbookToBlob(workbook: SeriesWorkbook): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/universal');
  const sheets = workbook.sheets.map(xlsxSheet);
  // The library's cell types are generic over the value constructor; the
  // cells built above are exactly its shapes.
  return writeXlsxFile(sheets as unknown as Parameters<typeof writeXlsxFile>[0] & unknown[]).toBlob();
}
