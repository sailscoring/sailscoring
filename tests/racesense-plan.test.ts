import { describe, expect, it } from 'vitest';

import { finishRowsFromImport } from '@/lib/finish-entry';
import { planRaceSenseImport, type SeriesRace } from '@/lib/racesense-plan';
import type { Candidate } from '@/lib/finish-sheet-csv';
import type {
  RaceSenseFinish,
  RaceSenseRace,
  RaceSenseStarter,
  RaceSenseWorkbook,
} from '@/lib/racesense-workbook';
import type { Finish } from '@/lib/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const YELLOW = 'fleet-yellow';
const BLUE = 'fleet-blue';

const COMPETITORS: Candidate[] = [
  { id: 'c1', sailNumber: '1021', fleetIds: [YELLOW] },
  { id: 'c2', sailNumber: '1023', fleetIds: [YELLOW] },
  { id: 'c3', sailNumber: '1022', fleetIds: [YELLOW] },
  { id: 'c4', sailNumber: '563', fleetIds: [BLUE] },
];

function seriesRace(n: number, fleetIds: string[] = [YELLOW]): SeriesRace {
  return {
    id: `race-${n}-${fleetIds.join('-')}`,
    name: `Q${n} · ${fleetIds.includes(YELLOW) ? 'Yellow' : 'Blue'}`,
    raceNumber: n,
    starts: [{ fleetIds, stage: 'qualifying', stageRaceNumber: n }],
  };
}

function starter(
  sailNumber: string,
  status = '',
  meaning: RaceSenseStarter['meaning'] = 'started',
): RaceSenseStarter {
  return { sailNumber, boatName: '', bowNumber: '', status, meaning, protest: false };
}

function finisher(position: number, sailNumber: string, finishTime: string): RaceSenseFinish {
  return { position, code: null, sailNumber, boatName: '', bowNumber: '', finishTime };
}

function coded(code: string, sailNumber: string): RaceSenseFinish {
  return { position: null, code, sailNumber, boatName: '', bowNumber: '', finishTime: null };
}

function sourceRace(overrides: Partial<RaceSenseRace> & { number: number }): RaceSenseRace {
  return {
    sheetName: `Race ${overrides.number}`,
    startNumber: '1',
    date: '2026-08-24',
    preparatorySignal: 'P',
    startTime: '11:31:00',
    starters: [starter('1021'), starter('1023'), starter('1022')],
    finishes: [
      finisher(1, '1021', '11:45:20'),
      finisher(2, '1023', '11:46:20'),
      coded('DNF', '1022'),
    ],
    ...overrides,
  };
}

function workbook(races: RaceSenseRace[], anomalies: RaceSenseWorkbook['anomalies'] = []): RaceSenseWorkbook {
  return {
    regatta: 'ILCA 7 Worlds',
    division: 'Yellow',
    appVersion: '0.10.11 (1)',
    regattaStartDate: '2026-08-23',
    races,
    summary: null,
    anomalies,
  };
}

/** Commit a planned race exactly as the app does, so the next plan reads back
 *  what would actually have been stored. */
function commit(
  raceId: string,
  result: NonNullable<ReturnType<typeof planRaceSenseImport>['races'][number]['result']>,
): Finish[] {
  return finishRowsFromImport(raceId, result.finishes);
}

function plan(args: {
  races: RaceSenseRace[];
  seriesRaces?: SeriesRace[];
  finishes?: Finish[];
  fleetId?: string | null;
  offset?: number;
  overrides?: Record<string, string>;
  anomalies?: RaceSenseWorkbook['anomalies'];
}) {
  return planRaceSenseImport({
    workbook: workbook(args.races, args.anomalies),
    fleetId: args.fleetId === undefined ? YELLOW : args.fleetId,
    races: args.seriesRaces ?? [seriesRace(1), seriesRace(2)],
    competitors: COMPETITORS,
    finishes: args.finishes ?? [],
    offset: args.offset,
    overrides: args.overrides,
  });
}

const warnings = (notes: { severity: string; kind: string }[]) =>
  notes.filter((n) => n.severity === 'warning').map((n) => n.kind);

// ---------------------------------------------------------------------------

describe('planRaceSenseImport', () => {
  it('reads a race into a race with nothing in it yet, and recommends it', () => {
    const { races } = plan({ races: [sourceRace({ number: 1 })] });
    expect(races).toHaveLength(1);
    const [planned] = races;
    expect(planned.state).toBe('new');
    expect(planned.recommended).toBe(true);
    expect(planned.race?.id).toBe(seriesRace(1).id);
    expect(planned.result?.finishes.map((f) => [f.competitorId, f.sortOrder, f.finishTime ?? null, f.resultCode])).toEqual([
      ['c1', 1, '11:45:20', null],
      ['c2', 2, '11:46:20', null],
      ['c3', null, null, 'DNF'],
    ]);
  });

  it('scores an uncleared OCS as OCS, not as the DNF the Finishes block shows', () => {
    const { races } = plan({
      races: [sourceRace({
        number: 1,
        starters: [starter('1021'), starter('1023'), starter('1022', 'OCS', 'ocs')],
        finishes: [
          finisher(1, '1021', '11:45:20'),
          finisher(2, '1023', '11:46:20'),
          coded('DNF', '1022'),   // ← what RaceSense writes for her
        ],
      })],
    });
    const ocs = races[0].result!.finishes.find((f) => f.competitorId === 'c3');
    expect(ocs?.resultCode).toBe('OCS');
    expect(races[0].recommended).toBe(true);
  });

  it('leaves a cleared OCS her finish', () => {
    const { races } = plan({
      races: [sourceRace({
        number: 1,
        starters: [starter('1021', 'OCS (Cleared)', 'cleared'), starter('1023'), starter('1022')],
      })],
    });
    const boat = races[0].result!.finishes.find((f) => f.competitorId === 'c1');
    expect(boat?.resultCode).toBeNull();
    expect(boat?.finishTime).toBe('11:45:20');
  });

  it('codes a boat who crossed the line but never cleared her OCS', () => {
    const { races } = plan({
      races: [sourceRace({
        number: 1,
        starters: [starter('1021', 'OCS', 'ocs'), starter('1023'), starter('1022')],
      })],
    });
    const boat = races[0].result!.finishes.find((f) => f.competitorId === 'c1');
    expect(boat?.resultCode).toBe('OCS');
    expect(boat?.sortOrder).toBeNull();
    expect(races[0].notes.map((n) => n.kind)).toContain('ocs-over-finish');
  });

  it('will not guess the code when the preparatory signal is one it doesn’t know', () => {
    const { races } = plan({
      races: [sourceRace({
        number: 1,
        preparatorySignal: 'Z',
        starters: [starter('1021'), starter('1023'), starter('1022', 'OCS', 'ocs')],
      })],
    });
    // The Finishes block's own DNF stands, and the scorer is told to fix it.
    expect(races[0].result!.finishes.find((f) => f.competitorId === 'c3')?.resultCode).toBe('DNF');
    expect(warnings(races[0].notes)).toContain('uncoded-ocs');
    expect(races[0].recommended).toBe(false);
  });

  it('ignores a check-in note entirely', () => {
    const { races } = plan({
      races: [sourceRace({
        number: 1,
        starters: [starter('1021', 'Not Checked-In', 'not-checked-in'), starter('1023'), starter('1022')],
      })],
    });
    const boat = races[0].result!.finishes.find((f) => f.competitorId === 'c1');
    expect(boat?.resultCode).toBeNull();
    expect(boat?.finishTime).toBe('11:45:20');
    expect(warnings(races[0].notes)).toEqual([]);
  });

  describe('the same workbook, uploaded again', () => {
    it('reads back unchanged once its races have been committed', () => {
      const first = plan({ races: [sourceRace({ number: 1 })] });
      const stored = commit(first.races[0].race!.id, first.races[0].result!);

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('unchanged');
      expect(second.races[0].changes).toEqual([]);
      expect(second.races[0].recommended).toBe(false);
    });

    it('shows what a hand-entered correction would lose, and does not recommend it', () => {
      const first = plan({ races: [sourceRace({ number: 1 })] });
      const raceId = first.races[0].race!.id;
      // The race committee's note said 1023 retired; the scorer entered RET.
      const stored = commit(raceId, first.races[0].result!)
        .map((f) => (f.competitorId === 'c2'
          ? { ...f, sortOrder: null, finishTime: undefined, resultCode: 'RET' as const }
          : f));

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('differs');
      expect(second.races[0].recommended).toBe(false);
      expect(second.races[0].changes).toEqual([
        { sailNumber: '1023', stored: 'RET', incoming: '2nd at 11:46:20' },
      ]);
    });
  });

  it('reports a sheet with no race to put it in', () => {
    const { races } = plan({
      races: [sourceRace({ number: 1 }), sourceRace({ number: 5 })],
    });
    expect(races[1].state).toBe('unmatched');
    expect(races[1].race).toBeNull();
    expect(races[1].result).toBeNull();
    expect(warnings(races[1].notes)).toEqual(['no-race']);
  });

  it('shifts every sheet by the offset, for when a resail desynchronises the numbering', () => {
    const { races } = plan({
      races: [sourceRace({ number: 1 })],
      seriesRaces: [seriesRace(1), seriesRace(2)],
      offset: 1,
    });
    expect(races[0].race?.raceNumber).toBe(2);
  });

  it('lets one sheet be pointed at a race by hand', () => {
    const target = seriesRace(2);
    const { races } = plan({
      races: [sourceRace({ number: 1 })],
      overrides: { 'Race 1': target.id },
    });
    expect(races[0].race?.id).toBe(target.id);
  });

  it('counts only the races this fleet sailed when matching by position', () => {
    // Blue's Q1 sits between Yellow's two races in series order; it must not
    // shift Yellow's sheets along by one.
    const seriesRaces = [seriesRace(1, [YELLOW]), seriesRace(2, [BLUE]), seriesRace(3, [YELLOW])];
    const { races } = plan({
      races: [sourceRace({ number: 1 }), sourceRace({ number: 2 })],
      seriesRaces,
    });
    expect(races.map((r) => r.race?.raceNumber)).toEqual([1, 3]);
  });

  describe('boats the sheet does not account for', () => {
    it('warns when a race holds a fleet the workbook does not cover', () => {
      const shared: SeriesRace = {
        id: 'shared-q1',
        name: 'Q1',
        raceNumber: 1,
        starts: [
          { fleetIds: [YELLOW], stage: 'qualifying', stageRaceNumber: 1 },
          { fleetIds: [BLUE], stage: 'qualifying', stageRaceNumber: 1 },
        ],
      };
      const { races } = plan({
        races: [sourceRace({ number: 1 })],
        seriesRaces: [shared],
        fleetId: null,
      });
      expect(warnings(races[0].notes)).toContain('roster');
      expect(races[0].notes.find((n) => n.kind === 'roster')?.message)
        .toContain('replaces every fleet');
      expect(races[0].recommended).toBe(false);
    });

    it('warns about a boat who started and then vanished from the sheet', () => {
      const { races } = plan({
        races: [sourceRace({
          number: 1,
          starters: [starter('1021'), starter('1023'), starter('1022')],
          finishes: [finisher(1, '1021', '11:45:20'), finisher(2, '1023', '11:46:20')],
        })],
      });
      expect(warnings(races[0].notes)).toContain('started-but-unlisted');
      expect(races[0].result!.finishes.map((f) => f.competitorId)).toEqual(['c1', 'c2']);
    });
  });

  it('reads a race nobody finished as all-DNF, and says abandonment is not its call', () => {
    const { races } = plan({
      races: [sourceRace({ number: 1, finishes: null })],
    });
    expect(races[0].result!.finishes.map((f) => [f.competitorId, f.resultCode])).toEqual([
      ['c1', 'DNF'], ['c2', 'DNF'], ['c3', 'DNF'],
    ]);
    expect(warnings(races[0].notes)).toContain('nobody-finished');
    expect(races[0].recommended).toBe(false);
  });

  it('keeps the parser’s per-sheet anomalies with their race, and the rest apart', () => {
    const { races, workbookNotes } = plan({
      races: [sourceRace({ number: 1 })],
      anomalies: [
        { severity: 'info', kind: 'app-version', sheet: 'Race 1', message: 'newer build' },
        { severity: 'warning', kind: 'unknown-status', sheet: 'Race 1', message: 'odd status' },
        { severity: 'warning', kind: 'summary-mismatch', sheet: 'Summary', message: 'disagrees' },
      ],
    });
    expect(races[0].notes.map((n) => n.kind)).toContain('unknown-status');
    expect(races[0].recommended).toBe(false);
    expect(workbookNotes.map((n) => n.kind)).toEqual(['app-version', 'summary-mismatch']);
  });
});
