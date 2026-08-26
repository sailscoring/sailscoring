import { describe, it, expect } from 'vitest';
import type { WorkbookSheet } from '@/lib/import-table';
import {
  parseRaceSenseWorkbook,
  normalizeRaceSenseElapsed,
  normalizeRaceSenseTime,
  startStatusCode,
  VERIFIED_APP_VERSION,
} from '@/lib/racesense-workbook';

/**
 * Sheets are built the way `lib/import-table` hands them over: strings only,
 * fully-empty rows already dropped. The shapes below are traced from the
 * reference export described in docs/notes/racesense/import-format.md.
 */

const HEADER = (extra: Partial<{ version: string }> = {}) => [
  ['RaceSense Event Report', '', '', `App Version: ${extra.version ?? VERIFIED_APP_VERSION}`],
  ['Regatta', 'M15 SATURDAY SERIES'],
  ['Division', 'M15 NON COACHED'],
  ['Regatta Start Date', '2025-09-20'],
];

interface RaceSheetSpec {
  number: number;
  date?: string;
  startNumber?: string;
  signal?: string;
  startTime?: string;
  /** Omit to leave the line unrecorded, as RaceSense does when it has none. */
  line?: boolean;
  startsHeader?: string[];
  starters?: string[][];
  footnote?: string;
  /** Omit for a race nobody finished — RaceSense writes no block at all. */
  finishesHeader?: string[] | null;
  finishes?: string[][];
}

const DEFAULT_STARTS_HEADER = ['Sail Number', 'Boat Name', 'Bow Number', 'Status', 'DTL at Start (m)'];
const DEFAULT_FINISHES_HEADER = [
  '', 'Sail Number', 'Boat Name', 'Bow Number',
  'Total Time', 'Finishing Time', 'Max Speed (kts)', 'Distance Traveled (km)',
];

function raceSheet(spec: RaceSheetSpec): WorkbookSheet {
  const rows: string[][] = [
    ...HEADER(),
    [`Race ${spec.number}`],
    ['Starts'],
    ['Start #', spec.startNumber ?? '1'],
    ['Date', spec.date ?? '2025-11-01'],
    ['Preparatory Signal Used', spec.signal ?? 'P'],
    ['Start Time', spec.startTime ?? '11:31'],
  ];
  if (spec.line !== false) {
    rows.push(['Boat Location', '53.3016777, -6.1280121']);
    rows.push(['Pin Location', '53.3013895, -6.1277042']);
  }
  rows.push(spec.startsHeader ?? DEFAULT_STARTS_HEADER);
  rows.push(...(spec.starters ?? [['1021', '', '', '', '8.45']]));
  if (spec.footnote) rows.push([spec.footnote]);
  if (spec.finishesHeader !== null) {
    rows.push(['Finishes']);
    rows.push(spec.finishesHeader ?? DEFAULT_FINISHES_HEADER);
    rows.push(...(spec.finishes ?? [['1.', '1021', '', '', '14:20.450', '11:45:20.450', '14.6', '2.730']]));
  }
  return { name: `Race ${spec.number}`, rows };
}

/** The shape of a sheet the reference export actually contains. */
const RACE_13 = raceSheet({
  number: 13,
  date: '2025-11-01',
  startTime: '11:31',
  starters: [
    ['1022', '', '', 'OCS', '-326.16'],
    ['563', '', '', '', '--'],
    ['567', 'Ciao', '567', '', '--'],
    ['1021', '', '', '', '8.45'],
  ],
  finishes: [
    ['1.', '1021', '', '', '14:20.450', '11:45:20.450', '14.6', '2.730'],
    ['2.', '563', '', '', '15:20.987', '11:46:20.987', '11.1', '2.705'],
    ['DNF', '567', 'Ciao', '567', '---', '---', '---', ''],
    ['DNF', '1022', '', '', '---', '---', '---', ''],
  ],
});

const kinds = (w: ReturnType<typeof parseRaceSenseWorkbook>) => w.anomalies.map((a) => a.kind);

describe('normalizeRaceSenseTime', () => {
  it('accepts the two shapes RaceSense writes, truncating fractions', () => {
    expect(normalizeRaceSenseTime('11:03')).toBe('11:03:00');          // Start Time
    expect(normalizeRaceSenseTime('11:11:20.830')).toBe('11:11:20');   // Finishing Time
    expect(normalizeRaceSenseTime('9:05:01')).toBe('09:05:01');
  });
  it('treats RaceSense’s placeholders as no time at all', () => {
    expect(normalizeRaceSenseTime('---')).toBeNull();
    expect(normalizeRaceSenseTime('--')).toBeNull();
    expect(normalizeRaceSenseTime('')).toBeNull();
  });
  it('rejects nonsense rather than guessing', () => {
    expect(normalizeRaceSenseTime('25:00:00')).toBeNull();
    expect(normalizeRaceSenseTime('11:61:00')).toBeNull();
    expect(normalizeRaceSenseTime('quarter past')).toBeNull();
  });
});

describe('startStatusCode', () => {
  it('codes an uncleared OCS by the preparatory signal', () => {
    expect(startStatusCode('ocs', 'P')).toBe('OCS');
    expect(startStatusCode('ocs', 'I')).toBe('OCS');
    expect(startStatusCode('ocs', 'U')).toBe('UFD');    // RRS 30.3
    expect(startStatusCode('ocs', 'Black')).toBe('BFD'); // RRS 30.4
  });
  it('derives nothing for a signal it has no mapping for', () => {
    expect(startStatusCode('ocs', 'Z')).toBeNull();
    expect(startStatusCode('ocs', null)).toBeNull();
  });
  it('leaves a cleared OCS, a clean start and a check-in note uncoded', () => {
    expect(startStatusCode('cleared', 'P')).toBeNull();
    expect(startStatusCode('started', 'P')).toBeNull();
    expect(startStatusCode('not-checked-in', 'P')).toBeNull();
  });
});

describe('parseRaceSenseWorkbook', () => {
  it('reads the regatta header and a race sheet whole', () => {
    const w = parseRaceSenseWorkbook([RACE_13]);
    expect(w.regatta).toBe('M15 SATURDAY SERIES');
    expect(w.division).toBe('M15 NON COACHED');
    expect(w.regattaStartDate).toBe('2025-09-20');
    expect(w.appVersion).toBe(VERIFIED_APP_VERSION);

    const race = w.races[0];
    expect(race.number).toBe(13);
    expect(race.date).toBe('2025-11-01');
    expect(race.startTime).toBe('11:31:00');
    expect(race.preparatorySignal).toBe('P');
    expect(race.startNumber).toBe('1');
    expect(race.starters.map((s) => s.sailNumber)).toEqual(['1022', '563', '567', '1021']);
    expect(race.finishes?.map((f) => [f.position, f.code, f.sailNumber, f.finishTime])).toEqual([
      [1, null, '1021', '11:45:20'],
      [2, null, '563', '11:46:20'],
      [null, 'DNF', '567', null],
      [null, 'DNF', '1022', null],
    ]);
    expect(w.anomalies).toEqual([]);
  });

  it('keeps the OCS that the Finishes block reports as a DNF', () => {
    const w = parseRaceSenseWorkbook([RACE_13]);
    const race = w.races[0];
    const ocs = race.starters.find((s) => s.sailNumber === '1022')!;
    expect(ocs.meaning).toBe('ocs');
    expect(startStatusCode(ocs.meaning, race.preparatorySignal)).toBe('OCS');
    // ...and she is in the DNF tail all the same, which is the whole point.
    expect(race.finishes?.find((f) => f.sailNumber === '1022')?.code).toBe('DNF');
  });

  it('treats both cleared-OCS spellings as no penalty at all', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [
        ['1016', '', '', 'OCS (Cleared)', '-1.18'],
        ['1015', '', '', 'OCS *', '-0.58'],
      ],
      footnote: '* cleared manually',
    })]);
    const race = w.races[0];
    expect(race.starters.map((s) => s.meaning)).toEqual(['cleared', 'cleared']);
    expect(race.starters.every((s) => startStatusCode(s.meaning, 'P') === null)).toBe(true);
    expect(w.anomalies).toEqual([]);
  });

  it('does not mistake the "* cleared manually" footnote for a boat', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1015', '', '', 'OCS *', '-0.58']],
      footnote: '* cleared manually',
    })]);
    expect(w.races[0].starters.map((s) => s.sailNumber)).toEqual(['1015']);
    expect(kinds(w)).toEqual([]);
  });

  it('reports any other asterisked row rather than scoring it', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1015', '', '', '', '1.0']],
      footnote: '* scored under protest',
    })]);
    expect(w.races[0].starters).toHaveLength(1);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'unexpected-row',
      value: '* scored under protest',
    }));
  });

  it('reads a sheet with no line recorded: no locations, a narrower header, no finishes', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 33,
      line: false,
      startsHeader: ['Sail Number', 'Boat Name', 'Bow Number', 'Status'],
      starters: [['563', '', '', ''], ['567', 'Ciao', '567', '']],
      finishesHeader: null,
    })]);
    const race = w.races[0];
    expect(race.starters.map((s) => s.sailNumber)).toEqual(['563', '567']);
    expect(race.finishes).toBeNull();
    expect(w.anomalies).toEqual([
      expect.objectContaining({ severity: 'info', kind: 'missing-finishes' }),
    ]);
  });

  it('reads the Protest column when it appears, and says it isn’t imported', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 11,
      startsHeader: [...DEFAULT_STARTS_HEADER, 'Protest'],
      starters: [
        ['1016', '', '', 'OCS (Cleared)', '-4.48', 'Yes'],
        ['1021', '', '', '', '6.57', ''],
      ],
    })]);
    expect(w.races[0].starters.map((s) => s.protest)).toEqual([true, false]);
    expect(w.anomalies).toEqual([
      expect.objectContaining({ severity: 'info', kind: 'protest', where: 'starter 1016' }),
    ]);
  });

  it('flags a status it doesn’t know instead of assuming it means nothing', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1021', '', '', 'ZFP (20%)', '-1.0']],
    })]);
    expect(w.races[0].starters[0].meaning).toBeNull();
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'unknown-status',
      value: 'ZFP (20%)',
      where: 'starter 1021',
    }));
  });

  it('flags a preparatory signal other than P or I, mapped or not', () => {
    const mapped = parseRaceSenseWorkbook([raceSheet({ number: 1, signal: 'Black' })]);
    expect(kinds(mapped)).toContain('preparatory-signal');
    expect(mapped.anomalies[0].message).toContain('BFD');

    const unmapped = parseRaceSenseWorkbook([raceSheet({ number: 1, signal: 'Z' })]);
    expect(kinds(unmapped)).toContain('preparatory-signal');
    expect(unmapped.anomalies[0].message).toContain('by hand');
  });

  it('flags a second start, whose meaning is unverified', () => {
    const w = parseRaceSenseWorkbook([raceSheet({ number: 1, startNumber: '2' })]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'start-number',
      value: '2',
    }));
  });

  it('flags an unrecognised finish marker and drops that row', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1021', '', '', '', '1.0'], ['563', '', '', '', '1.0']],
      finishes: [
        ['1.', '1021', '', '', '14:20.450', '11:45:20.450', '14.6', '2.730'],
        ['TLE', '563', '', '', '---', '---', '---', ''],
      ],
    })]);
    expect(w.races[0].finishes?.map((f) => f.sailNumber)).toEqual(['1021']);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'unknown-position',
      value: 'TLE',
    }));
  });

  it('flags finish times that run backwards', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1021', '', '', '', '1.0'], ['563', '', '', '', '1.0']],
      finishes: [
        ['1.', '1021', '', '', '14:20.450', '11:45:20.450', '14.6', '2.730'],
        ['2.', '563', '', '', '13:00.000', '11:44:00.000', '11.1', '2.705'],
      ],
    })]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'finish-order',
      where: 'finish row for 563',
    }));
  });

  it('flags a sail number listed twice', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1021', '', '', '', '1.0'], ['1021', '', '', '', '1.0']],
    })]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'duplicate-sail',
      value: '1021',
    }));
  });

  it('flags a column heading it has no name for', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      startsHeader: [...DEFAULT_STARTS_HEADER, 'Penalty Applied'],
      starters: [['1021', '', '', '', '1.0', '20%']],
    })]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'unknown-column',
      value: 'Penalty Applied',
    }));
  });

  it('does not mistake a sheet’s trailing padding for unnamed columns', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      startsHeader: [...DEFAULT_STARTS_HEADER, '', '', ''],
      starters: [['1021', '', '', '', '1.0', '', '', '']],
    })]);
    expect(kinds(w)).not.toContain('unknown-column');
  });

  it('skips a sheet that is neither a race nor the Summary, and says so', () => {
    const w = parseRaceSenseWorkbook([
      RACE_13,
      { name: 'Notes', rows: [['Committee notes'], ['Wind 12–15 kts']] },
    ]);
    expect(w.races).toHaveLength(1);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'unknown-sheet',
      value: 'Notes',
    }));
  });

  it('mentions an app version it hasn’t been checked against', () => {
    const sheet = raceSheet({ number: 1 });
    sheet.rows[0] = ['RaceSense Event Report', '', '', 'App Version: 0.11.0 (4)'];
    const w = parseRaceSenseWorkbook([sheet]);
    expect(w.appVersion).toBe('0.11.0 (4)');
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'app-version',
      value: '0.11.0 (4)',
    }));
  });

  it('sorts races by number, not by sheet order', () => {
    const w = parseRaceSenseWorkbook([
      raceSheet({ number: 10 }),
      raceSheet({ number: 2 }),
    ]);
    expect(w.races.map((r) => r.number)).toEqual([2, 10]);
  });

  it('flags two sheets claiming the same race number', () => {
    const w = parseRaceSenseWorkbook([raceSheet({ number: 3 }), raceSheet({ number: 3 })]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({ kind: 'duplicate-race' }));
  });
});

describe('the Summary sheet as a checksum', () => {
  const summarySheet = (grid: string[][]): WorkbookSheet => ({
    name: 'Summary',
    rows: [
      ...HEADER(),
      ['Summary'],
      ['Fastest Speed', '1016', '18.6 kts', 'Race 8'],
      ['', 'Race 13'],
      ...grid,
    ],
  });

  it('reads competitor labels with and without a boat name', () => {
    const w = parseRaceSenseWorkbook([
      RACE_13,
      summarySheet([['1021', '1.'], ['563 - Kittiwake', '2.']]),
    ]);
    expect(w.summary?.map((e) => [e.sailNumber, e.boatName])).toEqual([
      ['1021', ''],
      ['563', 'Kittiwake'],
    ]);
  });

  it('stays quiet when the grid agrees with the race sheets', () => {
    const w = parseRaceSenseWorkbook([
      RACE_13,
      summarySheet([['1021', '1.'], ['563', '2.'], ['567 - Ciao', 'DNF'], ['1022', 'DNF']]),
    ]);
    expect(kinds(w)).toEqual([]);
  });

  it('stays quiet about an uncleared OCS reading DNF, which is all the grid can say', () => {
    const w = parseRaceSenseWorkbook([RACE_13, summarySheet([['1022', 'DNF']])]);
    expect(kinds(w)).toEqual([]);
  });

  it('reports a position the race sheet disagrees with', () => {
    const w = parseRaceSenseWorkbook([RACE_13, summarySheet([['1021', '3.']])]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'summary-mismatch',
      where: '1021, Race 13',
      value: '3.',
    }));
  });

  it('reports a race the grid knows about and the workbook doesn’t', () => {
    const w = parseRaceSenseWorkbook([
      RACE_13,
      {
        name: 'Summary',
        rows: [...HEADER(), ['Summary'], ['', 'Race 14'], ['1021', '1.']],
      },
    ]);
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'summary-mismatch',
      where: 'Race 14',
    }));
  });
});

describe('normalizeRaceSenseElapsed', () => {
  it('reads the minutes:seconds shape the reference export writes, fraction kept', () => {
    expect(normalizeRaceSenseElapsed('14:20.450')).toBeCloseTo(860.45, 3);
    expect(normalizeRaceSenseElapsed('15:20.987')).toBeCloseTo(920.987, 3);
  });
  it('accepts an hours group for a longer race', () => {
    expect(normalizeRaceSenseElapsed('1:14:20.450')).toBeCloseTo(4460.45, 3);
    expect(normalizeRaceSenseElapsed('2:05:00')).toBe(7500);
  });
  it('treats placeholders as no value and rejects nonsense', () => {
    expect(normalizeRaceSenseElapsed('---')).toBeNull();
    expect(normalizeRaceSenseElapsed('')).toBeNull();
    expect(normalizeRaceSenseElapsed('14:61.0')).toBeNull();
    expect(normalizeRaceSenseElapsed('61:00')).toBeNull();
    expect(normalizeRaceSenseElapsed('fast')).toBeNull();
  });
});

describe('track data', () => {
  it('reads DTL, total time, max speed and distance from the reference sheet', () => {
    const w = parseRaceSenseWorkbook([RACE_13]);
    const race = w.races[0];
    expect(race.starters.map((s) => [s.sailNumber, s.dtlAtStartM])).toEqual([
      ['1022', -326.16],
      ['563', null],
      ['567', null],
      ['1021', 8.45],
    ]);
    const winner = race.finishes?.find((f) => f.sailNumber === '1021');
    expect(winner?.totalTimeSecs).toBeCloseTo(860.45, 3);
    expect(winner?.maxSpeedKts).toBe(14.6);
    expect(winner?.distanceKm).toBe(2.73);
    const dnf = race.finishes?.find((f) => f.sailNumber === '567');
    expect(dnf?.totalTimeSecs).toBeNull();
    expect(dnf?.maxSpeedKts).toBeNull();
    expect(dnf?.distanceKm).toBeNull();
    expect(w.anomalies).toEqual([]);
  });

  it('leaves DTL null when no line was recorded, without complaint', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 33,
      line: false,
      startsHeader: ['Sail Number', 'Boat Name', 'Bow Number', 'Status'],
      starters: [['563', '', '', '']],
      finishesHeader: null,
    })]);
    expect(w.races[0].starters[0].dtlAtStartM).toBeNull();
    expect(kinds(w)).toEqual(['missing-finishes']);
  });

  it('flags a metric it can’t read rather than guessing', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1021', '', '', '', 'n/a']],
      finishes: [['1.', '1021', '', '', '14:20.450', '11:45:20.450', 'fast', '2.730']],
    })]);
    const race = w.races[0];
    expect(race.starters[0].dtlAtStartM).toBeNull();
    expect(race.finishes?.[0].maxSpeedKts).toBeNull();
    expect(race.finishes?.[0].distanceKm).toBe(2.73);
    expect(kinds(w)).toEqual(['unreadable-number', 'unreadable-number']);
  });

  it('flags a total time it can’t read, keeping the finishing time', () => {
    const w = parseRaceSenseWorkbook([raceSheet({
      number: 1,
      starters: [['1021', '', '', '', '8.45']],
      finishes: [['1.', '1021', '', '', 'wat', '11:45:20.450', '14.6', '2.730']],
    })]);
    const finish = w.races[0].finishes?.[0];
    expect(finish?.totalTimeSecs).toBeNull();
    expect(finish?.finishTime).toBe('11:45:20');
    expect(w.anomalies).toContainEqual(expect.objectContaining({
      kind: 'unreadable-time',
      value: 'wat',
    }));
  });
});
