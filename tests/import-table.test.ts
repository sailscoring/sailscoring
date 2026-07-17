import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  parseTabularBytes,
  sniffTabularKind,
  stringifyCell,
  tabularFromWorkbook,
  OLD_EXCEL_MESSAGE,
  UNREADABLE_WORKBOOK_MESSAGE,
  EMPTY_WORKBOOK_MESSAGE,
} from '@/lib/import-table';

function fixtureBytes(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, 'fixtures/xlsx', name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function textBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

describe('sniffTabularKind', () => {
  it('recognises the xlsx (ZIP) signature', () => {
    expect(sniffTabularKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe('xlsx');
  });
  it('recognises the OLE2 signature (.xls / password-protected)', () => {
    expect(sniffTabularKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe('ole2');
  });
  it('treats anything else as text', () => {
    expect(sniffTabularKind(new Uint8Array([0x53, 0x61, 0x69, 0x6c]))).toBe('text');
    expect(sniffTabularKind(new Uint8Array([]))).toBe('text');
  });
});

describe('stringifyCell', () => {
  it('passes strings through untouched', () => {
    expect(stringifyCell('PY|M15')).toBe('PY|M15');
    expect(stringifyCell('007')).toBe('007');
  });
  it('stringifies numbers without decoration', () => {
    expect(stringifyCell(1234)).toBe('1234');
    expect(stringifyCell(0.95)).toBe('0.95');
  });
  it('renders epoch-day dates as time of day (both workbook epochs)', () => {
    expect(stringifyCell(new Date(Date.UTC(1899, 11, 30, 10, 31, 5)))).toBe('10:31:05');
    expect(stringifyCell(new Date(Date.UTC(1904, 0, 1, 11, 55, 9)))).toBe('11:55:09');
  });
  it('renders real dates as ISO dates, with time only when set', () => {
    expect(stringifyCell(new Date(Date.UTC(2026, 2, 14)))).toBe('2026-03-14');
    expect(stringifyCell(new Date(Date.UTC(2026, 2, 14, 9, 30, 0)))).toBe('2026-03-14 09:30:00');
  });
  it('renders booleans and empties', () => {
    expect(stringifyCell(true)).toBe('TRUE');
    expect(stringifyCell(false)).toBe('FALSE');
    expect(stringifyCell(null)).toBe('');
    expect(stringifyCell(undefined)).toBe('');
  });
});

describe('tabularFromWorkbook', () => {
  const sheet = (name: string, rows: string[][]) => ({ name, rows });
  it('errors when no sheet has data', () => {
    expect(tabularFromWorkbook([sheet('A', [])])).toEqual({
      kind: 'error',
      message: EMPTY_WORKBOOK_MESSAGE,
    });
  });
  it('collapses a single non-empty sheet to a plain table', () => {
    expect(tabularFromWorkbook([sheet('A', []), sheet('B', [['x']])])).toEqual({
      kind: 'table',
      rows: [['x']],
    });
  });
  it('keeps several non-empty sheets for the picker', () => {
    const result = tabularFromWorkbook([sheet('A', [['x']]), sheet('B', [['y']])]);
    expect(result.kind).toBe('workbook');
  });
});

describe('parseTabularBytes: CSV', () => {
  it('parses CSV text with quoting, matching the old Papa path', async () => {
    const result = await parseTabularBytes(
      textBytes('Sail Number,Boat\n1234,"Comma, The Boat"\n'),
    );
    expect(result).toEqual({
      kind: 'table',
      rows: [
        ['Sail Number', 'Boat'],
        ['1234', 'Comma, The Boat'],
      ],
    });
  });

  it('strips a UTF-8 BOM', async () => {
    const result = await parseTabularBytes(textBytes('﻿Sail,Time\n15,10:00:00\n'));
    expect(result.kind).toBe('table');
    if (result.kind === 'table') expect(result.rows[0][0]).toBe('Sail');
  });
});

describe('parseTabularBytes: xlsx', () => {
  it('reads time-formatted cells as HH:MM:SS strings', async () => {
    const result = await parseTabularBytes(fixtureBytes('finish-sheet-times.xlsx'));
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') return;
    expect(result.rows[0]).toEqual(['Sail Number', 'Finish Time', 'Code']);
    expect(result.rows[1][0]).toBe('6413');
    expect(result.rows[1][1]).toBe('11:55:09');
    expect(result.rows[4]).toEqual(['254', '', 'DNF']);
    expect(result.rows[5][1]).toBe('12:01:00');
  });

  it('handles 1904-date-system workbooks', async () => {
    const result = await parseTabularBytes(fixtureBytes('date1904.xlsx'));
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') return;
    expect(result.rows[1]).toEqual(['15', '11:55:09']);
  });

  it('preserves leading zeros and commas in text cells', async () => {
    const result = await parseTabularBytes(fixtureBytes('competitors.xlsx'));
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') return;
    expect(result.rows[2][0]).toBe('007');
    expect(result.rows[2][1]).toBe('Comma, The Boat');
    expect(result.rows[1][4]).toBe('1100');
  });

  it('returns non-empty sheets of a multi-sheet workbook for the picker', async () => {
    const result = await parseTabularBytes(fixtureBytes('multi-sheet.xlsx'));
    expect(result.kind).toBe('workbook');
    if (result.kind !== 'workbook') return;
    expect(result.sheets.map((s) => s.name)).toEqual(['Instructions', 'Entries']);
    expect(result.sheets[1].rows).toEqual([
      ['Sail Number', 'Helm'],
      ['101', 'Alice Aa'],
      ['102', 'Bob Bb'],
    ]);
  });

  it('flattens edge-case cells: formulas, rich text, booleans, dates, merges', async () => {
    const result = await parseTabularBytes(fixtureBytes('edge-cases.xlsx'));
    expect(result.kind).toBe('table');
    if (result.kind !== 'table') return;
    const [header, row2, row3] = result.rows;
    expect(header.slice(0, 6)).toEqual(['Formula', 'Rich', 'Bool', 'RealDate', 'Fraction', 'Merged']);
    expect(row2[0]).toBe('0.8'); // formula → cached result
    expect(row2[1]).toBe('Rich Text'); // rich text flattened
    expect(row2[2]).toBe('TRUE');
    expect(row2[3]).toBe('2026-03-14');
    expect(row2[4]).toBe('0.4382523148148148'); // General-format fraction stays numeric text
    expect(row2[5]).toBe('merged'); // merged range → value once, in the anchor cell
    // Mid-sheet empty row dropped; phantom used-range (Z50) trimmed.
    expect(row3[0]).toBe('after gap');
    expect(result.rows).toHaveLength(3);
  });

  it('rejects a ZIP that is not a workbook', async () => {
    // Minimal valid-signature garbage: PK\x03\x04 followed by junk.
    const junk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]);
    const result = await parseTabularBytes(junk.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'error', message: UNREADABLE_WORKBOOK_MESSAGE });
  });
});

describe('parseTabularBytes: legacy formats', () => {
  it('rejects OLE2 files (.xls or password-protected) with guidance', async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const result = await parseTabularBytes(ole.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'error', message: OLD_EXCEL_MESSAGE });
  });
});
