import { describe, it, expect } from 'vitest';
import {
  parseFinishSheetCsv,
  autoDetectFinishSheetField,
  type Candidate,
  type FinishSheetColumnMap,
} from '@/lib/finish-sheet-csv';

const candidates: Candidate[] = [
  { id: 'c1', sailNumber: '15',   fleetIds: ['f1'] },
  { id: 'c2', sailNumber: '22',   fleetIds: ['f1'] },
  { id: 'c3', sailNumber: '254',  fleetIds: ['f1'] },
  { id: 'c4', sailNumber: '6413', fleetIds: ['f1'] },
];

const defaultMap: FinishSheetColumnMap = {
  0: 'sailNumber',
  1: 'finishTime',
  2: 'resultCode',
};

describe('autoDetectFinishSheetField', () => {
  it('detects sailNumber headers', () => {
    expect(autoDetectFinishSheetField('sailNumber')).toBe('sailNumber');
    expect(autoDetectFinishSheetField('Sail Number')).toBe('sailNumber');
    expect(autoDetectFinishSheetField('Sail')).toBe('sailNumber');
    expect(autoDetectFinishSheetField('sail no')).toBe('sailNumber');
  });

  it('detects finishTime headers', () => {
    expect(autoDetectFinishSheetField('finishTime')).toBe('finishTime');
    expect(autoDetectFinishSheetField('Finish Time')).toBe('finishTime');
    expect(autoDetectFinishSheetField('Time')).toBe('finishTime');
  });

  it('detects resultCode headers', () => {
    expect(autoDetectFinishSheetField('resultCode')).toBe('resultCode');
    expect(autoDetectFinishSheetField('Result Code')).toBe('resultCode');
    expect(autoDetectFinishSheetField('Code')).toBe('resultCode');
  });

  it('falls back to ignore for unknown headers', () => {
    expect(autoDetectFinishSheetField('boat name')).toBe('ignore');
    expect(autoDetectFinishSheetField('')).toBe('ignore');
  });
});

describe('parseFinishSheetCsv', () => {
  it('parses three finishers in row order, assigning sortOrder 1..3', () => {
    const rows = [
      ['6413', '11:55:09', ''],
      ['15',   '11:57:37', ''],
      ['22',   '11:57:15', ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual({ finishers: 3, coded: 0, unresolved: 0 });
    expect(result.finishes).toHaveLength(3);
    expect(result.finishes[0]).toMatchObject({
      competitorId: 'c4',
      sortOrder: 1,
      resultCode: null,
      finishTime: '11:55:09',
    });
    expect(result.finishes[1]).toMatchObject({ competitorId: 'c1', sortOrder: 2, finishTime: '11:57:37' });
    expect(result.finishes[2]).toMatchObject({ competitorId: 'c2', sortOrder: 3, finishTime: '11:57:15' });
  });

  it('treats a coded row as a non-finisher with sortOrder null', () => {
    const rows = [
      ['15', '11:57:37', ''],
      ['22', '',         'DNF'],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual({ finishers: 1, coded: 1, unresolved: 0 });
    expect(result.finishes[1]).toMatchObject({
      competitorId: 'c2',
      sortOrder: null,
      resultCode: 'DNF',
    });
    expect(result.finishes[1].finishTime).toBeUndefined();
  });

  it('normalises times via the shared parser (HHMMSS → HH:MM:SS)', () => {
    const rows = [['15', '115737', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0].finishTime).toBe('11:57:37');
  });

  it('rejects invalid finish times', () => {
    const rows = [['15', '25:99:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([{ rowIndex: 2, reason: 'invalid finish time "25:99:00"' }]);
    expect(result.finishes).toEqual([]);
  });

  it('rejects unknown result codes', () => {
    const rows = [['15', '', 'ZZZ']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([{ rowIndex: 2, reason: 'unknown result code "ZZZ"' }]);
  });

  it('rejects rows with neither time nor code', () => {
    const rows = [['15', '', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([
      { rowIndex: 2, reason: 'row has neither finish time nor result code' },
    ]);
  });

  it('rejects rows with missing sail number', () => {
    const rows = [['', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([{ rowIndex: 2, reason: 'missing sail number' }]);
  });

  it('records unregistered sail numbers as unresolved finishers with a warning', () => {
    const rows = [
      ['15',   '11:00:00', ''],
      ['9999', '11:05:00', ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      { rowIndex: 3, reason: 'sail 9999 not registered — imported as unresolved crossing' },
    ]);
    expect(result.summary).toEqual({ finishers: 2, coded: 0, unresolved: 1 });
    expect(result.finishes[1]).toMatchObject({
      competitorId: null,
      unknownSailNumber: '9999',
      sortOrder: 2,
    });
  });

  it('rejects a coded row for an unregistered sail number', () => {
    const rows = [['9999', '', 'DNF']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([
      { rowIndex: 2, reason: 'sail 9999 not registered — cannot assign code DNF' },
    ]);
  });

  it('rejects a row that reuses a sail number already used earlier', () => {
    const rows = [
      ['15', '11:00:00', ''],
      ['15', '11:05:00', ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([
      { rowIndex: 3, reason: 'sail 15 already used earlier in this sheet' },
    ]);
    expect(result.finishes).toHaveLength(1);
  });

  it('flags ambiguous sail numbers (multiple candidates share the number)', () => {
    const dupCandidates: Candidate[] = [
      { id: 'c1', sailNumber: '15', fleetIds: ['f1'] },
      { id: 'c2', sailNumber: '15', fleetIds: ['f2'] },
    ];
    const rows = [['15', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: dupCandidates });
    expect(result.errors).toEqual([
      {
        rowIndex: 2,
        reason: 'sail 15 is ambiguous — multiple competitors share this number',
      },
    ]);
  });

  it('uppercases sail numbers for case-insensitive matching', () => {
    const letterCandidates: Candidate[] = [{ id: 'c1', sailNumber: 'IRL15', fleetIds: ['f1'] }];
    const rows = [['irl15', '11:00:00', '']];
    const result = parseFinishSheetCsv({
      rows,
      columnMap: defaultMap,
      candidates: letterCandidates,
    });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0].competitorId).toBe('c1');
  });

  it('ignores columns mapped to "ignore"', () => {
    const rows = [['boatname-ignored', '15', '11:00:00', '']];
    const columnMap: FinishSheetColumnMap = {
      0: 'ignore',
      1: 'sailNumber',
      2: 'finishTime',
      3: 'resultCode',
    };
    const result = parseFinishSheetCsv({ rows, columnMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0].competitorId).toBe('c1');
  });

  it('assigns sortOrder only among finishers — interleaved coded rows do not advance it', () => {
    const rows = [
      ['15',   '11:00:00', ''],    // finisher #1
      ['22',   '',         'DNF'], // coded — sortOrder null
      ['254',  '11:05:00', ''],    // finisher #2
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0].sortOrder).toBe(1);
    expect(result.finishes[1].sortOrder).toBeNull();
    expect(result.finishes[2].sortOrder).toBe(2);
  });

  it('leaves penalty/redress fields blank (out of scope for v1 import)', () => {
    const rows = [['15', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    const f = result.finishes[0];
    expect(f.penaltyCode).toBeNull();
    expect(f.penaltyOverride).toBeNull();
    expect(f.redressMethod).toBeNull();
    expect(f.redressIncludeAllLater).toBe(false);
    expect(f.startPresent).toBeNull();
  });
});
