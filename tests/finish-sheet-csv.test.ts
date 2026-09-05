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

  it('detects elapsed headers ahead of finishTime', () => {
    // "Elapsed time" would match the finish-time pattern on the bare word
    // "time", so the elapsed check has to come first.
    expect(autoDetectFinishSheetField('elapsed')).toBe('elapsed');
    expect(autoDetectFinishSheetField('Elapsed Time')).toBe('elapsed');
    expect(autoDetectFinishSheetField('ET')).toBe('elapsed');
    expect(autoDetectFinishSheetField('Total Time')).toBe('elapsed');
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
    expect(result.summary).toEqual({ finishers: 3, untimed: 0, coded: 0, unresolved: 0, matchedOnBow: 0 });
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
    expect(result.summary).toEqual({ finishers: 1, untimed: 0, coded: 1, unresolved: 0, matchedOnBow: 0 });
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

  it('accepts a fraction-of-day time (unformatted spreadsheet time cell)', () => {
    // 10:31:05 = 37865s = 0.4382523148… of a day; an .xlsx time cell whose
    // custom format import-table doesn't recognise arrives like this.
    const rows = [['15', '0.4382523148148148', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0].finishTime).toBe('10:31:05');
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

  it('imports a place-only sheet — rows with only a sail number are finishers in row order', () => {
    const rows = [
      ['6413', '', ''],
      ['15',   '', ''],
      ['22',   '', ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual({ finishers: 3, untimed: 3, coded: 0, unresolved: 0, matchedOnBow: 0 });
    expect(result.finishes[0]).toMatchObject({ competitorId: 'c4', sortOrder: 1, resultCode: null });
    expect(result.finishes[0].finishTime).toBeUndefined();
    expect(result.finishes[1]).toMatchObject({ competitorId: 'c1', sortOrder: 2 });
    expect(result.finishes[2]).toMatchObject({ competitorId: 'c2', sortOrder: 3 });
  });

  it('counts untimed finishers separately when the sheet mixes timed and untimed rows', () => {
    const rows = [
      ['15', '11:00:00', ''],
      ['22', '',         ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.summary).toEqual({ finishers: 2, untimed: 1, coded: 0, unresolved: 0, matchedOnBow: 0 });
  });

  it('skips entirely blank rows without an error', () => {
    const rows = [
      ['15', '11:00:00', ''],
      ['',   '',         ''],
      ['22', '11:01:00', ''],
      ['',   '',         ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.finishes).toHaveLength(2);
    expect(result.finishes[1]).toMatchObject({ competitorId: 'c2', sortOrder: 2 });
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
    expect(result.summary).toEqual({ finishers: 2, untimed: 0, coded: 0, unresolved: 1, matchedOnBow: 0 });
    expect(result.finishes[1]).toMatchObject({
      competitorId: null,
      unknownSailNumber: '9999',
      sortOrder: 2,
    });
  });

  it('resolves a bare number against a nationally prefixed registration, and back', () => {
    const prefixed: Candidate[] = [
      { id: 'c1', sailNumber: 'IRL4076', fleetIds: ['f1'] },
      { id: 'c2', sailNumber: '4077', fleetIds: ['f1'] },
    ];
    const rows = [
      ['4076', '11:00:00', ''],
      ['IRL 4077', '11:01:00', ''],
      ['GBR4076', '11:02:00', ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: prefixed });
    expect(result.errors).toEqual([]);
    expect(result.finishes.map((f) => f.competitorId)).toEqual(['c1', 'c2', null]);
    expect(result.summary.unresolved).toBe(1);
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

describe('parseFinishSheetCsv bow-number matching', () => {
  const withBows: Candidate[] = [
    { id: 'c1', sailNumber: '15', bowNumber: '3', fleetIds: ['f1'] },
    { id: 'c2', sailNumber: '22', bowNumber: '4', fleetIds: ['f1'] },
    // c3's bow number is another boat's sail number — the sail tier must win.
    { id: 'c3', sailNumber: '254', bowNumber: '22', fleetIds: ['f1'] },
    { id: 'c4', sailNumber: '6413', fleetIds: ['f1'] },
  ];

  it('resolves a row written in bow numbers, tagging how it matched', () => {
    const rows = [['3', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: withBows });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0]).toMatchObject({
      competitorId: 'c1',
      sortOrder: 1,
      matchedOn: 'bow',
      enteredSailNumber: '3',
    });
    expect(result.summary.matchedOnBow).toBe(1);
    expect(result.warnings).toEqual([
      { rowIndex: 2, reason: '3 matched the bow number of sail 15' },
    ]);
  });

  it('prefers a sail number over another boat’s bow number', () => {
    const rows = [['22', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: withBows });
    expect(result.finishes[0].competitorId).toBe('c2');
    expect(result.finishes[0].matchedOn).toBeUndefined();
    expect(result.summary.matchedOnBow).toBe(0);
  });

  it('assigns a result code to a boat identified by bow number', () => {
    const rows = [['4', '', 'DNF']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: withBows });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0]).toMatchObject({
      competitorId: 'c2',
      resultCode: 'DNF',
      matchedOn: 'bow',
      enteredSailNumber: '4',
    });
  });

  it('reports an ambiguous bow number as a bow, not a sail', () => {
    const shared: Candidate[] = [
      { id: 'a', sailNumber: '100', bowNumber: '9', fleetIds: ['f1'] },
      { id: 'b', sailNumber: '200', bowNumber: '9', fleetIds: ['f1'] },
    ];
    const result = parseFinishSheetCsv({
      rows: [['9', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: shared,
    });
    expect(result.errors).toEqual([
      { rowIndex: 2, reason: 'bow 9 is ambiguous — multiple competitors share this number' },
    ]);
  });

  it('does not match a bow number by prefix', () => {
    // The keyboard path would commit this; a bulk import will not guess.
    const rows = [['641', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: withBows });
    expect(result.finishes[0]).toMatchObject({
      competitorId: null,
      unknownSailNumber: '641',
    });
    expect(result.summary.unresolved).toBe(1);
  });

  it('ignores blank bow numbers when indexing', () => {
    const rows = [['', '11:00:00', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: defaultMap, candidates: withBows });
    expect(result.errors).toEqual([{ rowIndex: 2, reason: 'missing sail number' }]);
  });
});

describe('parseFinishSheetCsv alternative sail numbers', () => {
  const withAlts: Candidate[] = [
    { id: 'c1', sailNumber: '15', alternativeSailNumbers: ['IRL99', '7'], fleetIds: ['f1'] },
    { id: 'c2', sailNumber: '22', bowNumber: '7', fleetIds: ['f1'] },
    { id: 'c3', sailNumber: '254', fleetIds: ['f1'] },
  ];

  it('resolves a row written under an alternative number', () => {
    const result = parseFinishSheetCsv({
      rows: [['irl99', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: withAlts,
    });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0]).toMatchObject({
      competitorId: 'c1',
      matchedOn: 'alternative',
      enteredSailNumber: 'irl99',
    });
    expect(result.warnings).toEqual([
      { rowIndex: 2, reason: 'irl99 is an alternative sail number of 15' },
    ]);
    expect(result.summary.matchedOnBow).toBe(1);
  });

  it('prefers an alternative over another boat’s bow number', () => {
    const result = parseFinishSheetCsv({
      rows: [['7', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: withAlts,
    });
    expect(result.finishes[0]).toMatchObject({ competitorId: 'c1', matchedOn: 'alternative' });
  });

  it('still prefers a registered sail number over any alternative', () => {
    const shadowing: Candidate[] = [
      { id: 'a', sailNumber: '100', alternativeSailNumbers: ['200'], fleetIds: ['f1'] },
      { id: 'b', sailNumber: '200', fleetIds: ['f1'] },
    ];
    const result = parseFinishSheetCsv({
      rows: [['200', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: shadowing,
    });
    expect(result.finishes[0]).toMatchObject({ competitorId: 'b' });
    expect(result.finishes[0].matchedOn).toBeUndefined();
  });

  it('reports an alternative claimed by two boats as ambiguous', () => {
    const shared: Candidate[] = [
      { id: 'a', sailNumber: '100', alternativeSailNumbers: ['9'], fleetIds: ['f1'] },
      { id: 'b', sailNumber: '200', alternativeSailNumbers: ['9'], fleetIds: ['f1'] },
    ];
    const result = parseFinishSheetCsv({
      rows: [['9', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: shared,
    });
    expect(result.errors).toEqual([
      { rowIndex: 2, reason: 'sail 9 is ambiguous — multiple competitors share this number' },
    ]);
  });
});

describe('parseFinishSheetCsv nationality-qualified sail numbers', () => {
  const irish: Candidate[] = [
    { id: 'a', sailNumber: '224529', nationality: 'IRL', fleetIds: ['f1'] },
    { id: 'b', sailNumber: '215417', nationality: 'SEY', fleetIds: ['f1'] },
  ];

  it('resolves a qualified number silently, as the registered number', () => {
    const result = parseFinishSheetCsv({
      rows: [['IRL 224529', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: irish,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.finishes[0]).toMatchObject({ competitorId: 'a' });
    expect(result.finishes[0].matchedOn).toBeUndefined();
    expect(result.summary.matchedOnBow).toBe(0);
  });

  it('accepts the unspaced form, case-insensitively', () => {
    const result = parseFinishSheetCsv({
      rows: [['irl224529', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: irish,
    });
    expect(result.finishes[0]).toMatchObject({ competitorId: 'a' });
  });

  it('still matches the bare number', () => {
    const result = parseFinishSheetCsv({
      rows: [['224529', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: irish,
    });
    expect(result.finishes[0]).toMatchObject({ competitorId: 'a' });
  });

  it('keeps boats sharing a number under different letters distinct', () => {
    const shared: Candidate[] = [
      { id: 'a', sailNumber: '1234', nationality: 'IRL', fleetIds: ['f1'] },
      { id: 'b', sailNumber: '1234', nationality: 'GBR', fleetIds: ['f1'] },
    ];
    const result = parseFinishSheetCsv({
      rows: [
        ['IRL 1234', '11:00:00', ''],
        ['GBR 1234', '11:00:30', ''],
      ],
      columnMap: defaultMap,
      candidates: shared,
    });
    expect(result.errors).toEqual([]);
    expect(result.finishes.map((f) => f.competitorId)).toEqual(['a', 'b']);
  });

  it('reports the bare form of a shared number as ambiguous', () => {
    const shared: Candidate[] = [
      { id: 'a', sailNumber: '1234', nationality: 'IRL', fleetIds: ['f1'] },
      { id: 'b', sailNumber: '1234', nationality: 'GBR', fleetIds: ['f1'] },
    ];
    const result = parseFinishSheetCsv({
      rows: [['1234', '11:00:00', '']],
      columnMap: defaultMap,
      candidates: shared,
    });
    expect(result.errors).toEqual([
      { rowIndex: 2, reason: 'sail 1234 is ambiguous — multiple competitors share this number' },
    ]);
  });
});

describe('parseFinishSheetCsv elapsed times', () => {
  const elapsedMap = { 0: 'sailNumber', 1: 'elapsed', 2: 'resultCode' } as const;

  it('records an elapsed sheet on the finish rows, in row order', () => {
    const rows = [
      ['6413', '45:51', ''],
      ['15',   '46:50.4', ''],
      ['22',   '2810', ''],
    ];
    const result = parseFinishSheetCsv({ rows, columnMap: elapsedMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.summary.finishers).toBe(3);
    expect(result.summary.untimed).toBe(0);
    expect(result.finishes.map((f) => f.elapsedSecs)).toEqual([2751, 2810.4, 2810]);
    expect(result.finishes.every((f) => f.finishTime === undefined)).toBe(true);
  });

  it('rejects a row carrying both a finish time and an elapsed time', () => {
    const rows = [['6413', '11:55:09', '45:51', '']];
    const result = parseFinishSheetCsv({
      rows,
      columnMap: { 0: 'sailNumber', 1: 'finishTime', 2: 'elapsed', 3: 'resultCode' },
      candidates,
    });
    expect(result.finishes).toEqual([]);
    expect(result.errors[0].reason).toContain('one way or the other');
  });

  it('rejects an unreadable elapsed value', () => {
    const rows = [['6413', 'soon', '']];
    const result = parseFinishSheetCsv({ rows, columnMap: elapsedMap, candidates });
    expect(result.finishes).toEqual([]);
    expect(result.errors[0].reason).toBe('invalid elapsed time "soon"');
  });

  it('treats a coded row as coded even with an elapsed time beside it', () => {
    const rows = [['6413', '45:51', 'RET']];
    const result = parseFinishSheetCsv({ rows, columnMap: elapsedMap, candidates });
    expect(result.errors).toEqual([]);
    expect(result.finishes[0]).toMatchObject({ sortOrder: null, resultCode: 'RET' });
    expect(result.finishes[0].elapsedSecs).toBeUndefined();
  });
});
