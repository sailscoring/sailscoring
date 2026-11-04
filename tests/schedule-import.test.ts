import { describe, it, expect } from 'vitest';

import {
  detectScheduleField,
  findScheduleHeaderRow,
  fleetField,
  matchFleetHeading,
  parseSchedule,
  parseScheduleDate,
  scheduleMappingProblem,
  type ScheduleColumnMap,
} from '@/lib/schedule-import';
import type { Fleet } from '@/lib/types';

function fleet(id: string, name: string): Fleet {
  return { id, seriesId: 's', name } as Fleet;
}

const toppers = fleet('tf', 'Topper & Feva');
const ilca = fleet('il', 'ILCA & 420');
const fleets = [toppers, ilca];

describe('parseScheduleDate', () => {
  it('takes an Excel date cell as it arrives, with or without a time', () => {
    expect(parseScheduleDate('2025-11-08')).toBe('2025-11-08');
    expect(parseScheduleDate('2025-11-08 10:30:00')).toBe('2025-11-08');
  });

  it('reads typed dates day-first', () => {
    expect(parseScheduleDate('8/11/2025')).toBe('2025-11-08');
    expect(parseScheduleDate('08.11.25')).toBe('2025-11-08');
    expect(parseScheduleDate('8-11-2025')).toBe('2025-11-08');
  });

  it('reads word months, with a weekday or an ordinal', () => {
    expect(parseScheduleDate('Sat 8 Nov 2025')).toBe('2025-11-08');
    expect(parseScheduleDate('Saturday, 8th November 2025')).toBe('2025-11-08');
    expect(parseScheduleDate('November 8th, 2025')).toBe('2025-11-08');
    expect(parseScheduleDate('8 Sept 2025')).toBe('2025-09-08');
  });

  it('refuses a date without a year, an impossible date, and words', () => {
    expect(parseScheduleDate('8 Nov')).toBeNull();
    expect(parseScheduleDate('31/2/2026')).toBeNull();
    expect(parseScheduleDate('2026-02-30')).toBeNull();
    expect(parseScheduleDate('8 Nob 2025')).toBeNull();
    expect(parseScheduleDate('TBC')).toBeNull();
    expect(parseScheduleDate('')).toBeNull();
  });
});

describe('matching headings to fleets', () => {
  it('matches a fleet by its name, ignoring case and punctuation', () => {
    expect(matchFleetHeading('ILCA & 420', fleets)).toBe(ilca);
    expect(matchFleetHeading('ilca 420', fleets)).toBe(ilca);
  });

  it('reads past a Start prefix or suffix', () => {
    expect(matchFleetHeading('Start: Topper & Feva', fleets)).toBe(toppers);
    expect(matchFleetHeading('ILCA & 420 start', fleets)).toBe(ilca);
  });

  it('accepts a single loose match, but not two', () => {
    expect(matchFleetHeading('Topper', fleets)).toBe(toppers);
    const two = [fleet('a', 'Howth 17 (Scratch)'), fleet('b', 'Howth 17 (HPH)')];
    expect(matchFleetHeading('Howth 17', two)).toBeNull();
  });

  it('detects the other columns', () => {
    expect(detectScheduleField('Date', fleets)).toBe('date');
    expect(detectScheduleField('Race No', fleets)).toBe('race');
    expect(detectScheduleField('Race', fleets)).toBe('race');
    expect(detectScheduleField('Name', fleets)).toBe('name');
    expect(detectScheduleField('First start', fleets)).toBe('start');
    expect(detectScheduleField('Start time', fleets)).toBe('start');
    expect(detectScheduleField('ILCA & 420', fleets)).toBe(fleetField('il'));
    expect(detectScheduleField('Notes', fleets)).toBe('ignore');
  });
});

describe('findScheduleHeaderRow', () => {
  it('skips a title above the headings', () => {
    const rows = [['Frostbite Series 2025'], ['Race', 'Date', 'ILCA & 420'], ['1', '2025-11-08', '11:00']];
    expect(findScheduleHeaderRow(rows)).toBe(1);
  });

  it('falls back to the first row', () => {
    expect(findScheduleHeaderRow([['When', 'Gun'], ['2025-11-08', '11:00']])).toBe(0);
  });
});

describe('scheduleMappingProblem', () => {
  const ok = { hasStartSequence: true };
  it('needs a date column', () => {
    expect(scheduleMappingProblem({ 0: 'name' }, ok)).toMatch(/date/);
  });
  it('refuses a Start column alongside fleet columns', () => {
    expect(scheduleMappingProblem({ 0: 'date', 1: 'start', 2: fleetField('il') }, ok)).toMatch(/either/);
  });
  it('refuses a fleet pointed at twice', () => {
    expect(
      scheduleMappingProblem({ 0: 'date', 1: fleetField('il'), 2: fleetField('il') }, ok),
    ).toMatch(/same fleet/);
  });
  it('refuses a Start column without a default start sequence', () => {
    expect(scheduleMappingProblem({ 0: 'date', 1: 'start' }, { hasStartSequence: false })).toMatch(
      /start sequence/,
    );
  });
  it('accepts a date and fleets', () => {
    expect(scheduleMappingProblem({ 0: 'date', 1: fleetField('tf'), 2: fleetField('il') }, ok)).toBeNull();
  });
});

describe('parseSchedule', () => {
  const sequence = [
    { fleetIds: ['tf'], intervalMinutes: 0 },
    { fleetIds: ['il'], intervalMinutes: 5 },
  ];
  const base = {
    fleets,
    startSequence: sequence,
    untimedSequenceWhenNoStarts: false,
  };

  it('reads a column per fleet, a blank fleet sitting the race out', () => {
    const columnMap: ScheduleColumnMap = { 0: 'race', 1: 'date', 2: fleetField('tf'), 3: fleetField('il') };
    const result = parseSchedule({
      ...base,
      columnMap,
      rows: [
        ['1', '2025-11-08', '11:00', '11:05'],
        ['2', '2025-11-08', 'ASAP', 'ASAP'],
        ['12', '2025-12-06', '', '11:00'],
        ['13', '2025-12-06', '—', 'asap'],
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.races.map((r) => r.starts)).toEqual([
      [
        { fleetIds: ['tf'], startTime: '11:00:00' },
        { fleetIds: ['il'], startTime: '11:05:00' },
      ],
      // Separate guns in the default sequence, so separate starts.
      [{ fleetIds: ['tf'] }, { fleetIds: ['il'] }],
      [{ fleetIds: ['il'], startTime: '11:00:00' }],
      [{ fleetIds: ['il'] }],
    ]);
  });

  it('puts fleets on the same gun in one start, in gun order', () => {
    const result = parseSchedule({
      ...base,
      columnMap: { 0: 'date', 1: fleetField('tf'), 2: fleetField('il') },
      rows: [['2025-11-08', '11:10', '11:00']],
    });
    expect(result.races[0].starts).toEqual([
      { fleetIds: ['il'], startTime: '11:00:00' },
      { fleetIds: ['tf'], startTime: '11:10:00' },
    ]);
    const shared = parseSchedule({
      ...base,
      columnMap: { 0: 'date', 1: fleetField('tf'), 2: fleetField('il') },
      rows: [['2025-11-08', '11:00', '1100']],
    });
    expect(shared.races[0].starts).toEqual([{ fleetIds: ['tf', 'il'], startTime: '11:00:00' }]);
  });

  it('runs a Start column through the default sequence, untimed when ASAP or blank', () => {
    const result = parseSchedule({
      ...base,
      columnMap: { 0: 'date', 1: 'start', 2: 'name' },
      rows: [
        ['2025-11-08', '11:00', 'Race one'],
        ['2025-11-08', 'ASAP', ''],
        ['2025-11-15', '', ''],
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.races[0]).toMatchObject({
      date: '2025-11-08',
      name: 'Race one',
      starts: [
        { fleetIds: ['tf'], startTime: '11:00:00' },
        { fleetIds: ['il'], startTime: '11:05:00' },
      ],
    });
    expect(result.races[1].name).toBeNull();
    expect(result.races[1].starts).toEqual([{ fleetIds: ['tf'] }, { fleetIds: ['il'] }]);
    expect(result.races[2].starts).toEqual([{ fleetIds: ['tf'] }, { fleetIds: ['il'] }]);
  });

  it('starts untimed fleets together where the default sequence does', () => {
    const three = [...fleets, fleet('op', 'Optimist')];
    const result = parseSchedule({
      ...base,
      fleets: three,
      startSequence: [
        { fleetIds: ['tf', 'il'], intervalMinutes: 0 },
        { fleetIds: ['op'], intervalMinutes: 5 },
      ],
      columnMap: { 0: 'date', 1: fleetField('tf'), 2: fleetField('il'), 3: fleetField('op') },
      rows: [['2025-11-08', 'ASAP', 'ASAP', 'ASAP']],
    });
    expect(result.races[0].starts).toEqual([{ fleetIds: ['tf', 'il'] }, { fleetIds: ['op'] }]);
  });

  it('with no start columns, gives races the sequence untimed only when asked', () => {
    const rows = [['2025-11-08']];
    expect(parseSchedule({ ...base, columnMap: { 0: 'date' }, rows }).races[0].starts).toEqual([]);
    expect(
      parseSchedule({ ...base, untimedSequenceWhenNoStarts: true, columnMap: { 0: 'date' }, rows })
        .races[0].starts,
    ).toEqual([{ fleetIds: ['tf'] }, { fleetIds: ['il'] }]);
  });

  it('reports bad rows by spreadsheet row number and keeps the good ones', () => {
    const result = parseSchedule({
      ...base,
      columnMap: { 0: 'date', 1: fleetField('tf'), 2: fleetField('il') },
      firstRowNumber: 3,
      rows: [
        ['2025-11-08', '11:00', '11:05'],
        ['', '11:00', '11:05'],
        ['8 Nov', '11:00', '11:05'],
        ['2025-11-15', '11:00', 'half one'],
        ['2025-11-22', '', '—'],
        ['2025-11-29', '25:00', '11:05'],
      ],
    });
    expect(result.races.map((r) => r.rowNumber)).toEqual([3]);
    expect(result.errors).toEqual([
      { rowNumber: 4, reason: 'no date' },
      { rowNumber: 5, reason: '"8 Nov" isn\'t a date with a year' },
      { rowNumber: 6, reason: '"half one" under ILCA & 420 isn\'t a start time' },
      { rowNumber: 7, reason: 'no fleet has a start in this race' },
      { rowNumber: 8, reason: '"25:00" under Topper & Feva isn\'t a start time' },
    ]);
  });

  it('orders races by the race column, unnumbered rows after', () => {
    const result = parseSchedule({
      ...base,
      columnMap: { 0: 'race', 1: 'date' },
      rows: [
        ['R2', '2025-11-08'],
        ['', '2025-11-29'],
        ['R1', '2025-11-08'],
        ['R10', '2025-11-22'],
      ],
    });
    expect(result.races.map((r) => r.rowNumber)).toEqual([4, 2, 5, 3]);
  });

  it('imports nothing past the cap, and says how many there were', () => {
    const rows = Array.from({ length: 5 }, () => ['2025-11-08']);
    const result = parseSchedule({ ...base, columnMap: { 0: 'date' }, rows, maxRaces: 4 });
    expect(result.races).toEqual([]);
    expect(result.tooMany).toBe(5);
  });
});
