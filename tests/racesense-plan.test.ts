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
  return { sailNumber, boatName: '', bowNumber: '', status, meaning, protest: false, dtlAtStartM: null };
}

/** The gun every `sourceRace` below starts on, so a finisher's elapsed time
 *  can be derived from her finishing time and the two agree. */
const FIXTURE_START = '11:31:00';

const secsOf = (time: string): number => {
  const [h, m, sec] = time.split(':').map(Number);
  return h * 3600 + m * 60 + sec;
};

/** A finisher as RaceSense writes one: a timestamp and the elapsed time it is
 *  rendered from. The import reads the elapsed time; the timestamp is here
 *  because a real sheet carries it and the parser cross-checks it. */
function finisher(position: number, sailNumber: string, finishTime: string): RaceSenseFinish {
  return {
    position, code: null, sailNumber, boatName: '', bowNumber: '', finishTime,
    totalTimeSecs: secsOf(finishTime) - secsOf(FIXTURE_START),
    maxSpeedKts: null, distanceKm: null,
  };
}

function coded(code: string, sailNumber: string): RaceSenseFinish {
  return {
    position: null, code, sailNumber, boatName: '', bowNumber: '', finishTime: null,
    totalTimeSecs: null, maxSpeedKts: null, distanceKm: null,
  };
}

function sourceRace(overrides: Partial<RaceSenseRace> & { number: number }): RaceSenseRace {
  return {
    sheetName: `Race ${overrides.number}`,
    startNumber: '1',
    date: '2026-08-24',
    preparatorySignal: 'P',
    startTime: FIXTURE_START,
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
    // Elapsed times, not timestamps: the sheet's `Finishing Time` is read for
    // the parser's cross-check and never imported.
    expect(planned.result?.finishes.map((f) => [f.competitorId, f.sortOrder, f.elapsedSecs ?? null, f.resultCode])).toEqual([
      ['c1', 1, 860, null],
      ['c2', 2, 920, null],
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
    expect(boat?.elapsedSecs).toBe(860);
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
    expect(boat?.elapsedSecs).toBe(860);
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
          ? { ...f, sortOrder: null, elapsedSecs: undefined, resultCode: 'RET' as const }
          : f));

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('differs');
      expect(second.races[0].recommended).toBe(false);
      expect(second.races[0].changes).toEqual([
        { sailNumber: '1023', stored: 'RET', incoming: '2nd, 920s elapsed' },
      ]);
    });
  });

  describe('what the sheet can’t express', () => {
    /** Commit race 1, then apply scorer edits to the stored rows. */
    function storedWith(edit: (f: Finish) => Finish): { raceId: string; stored: Finish[] } {
      const first = plan({ races: [sourceRace({ number: 1 })] });
      const raceId = first.races[0].race!.id;
      return { raceId, stored: commit(raceId, first.races[0].result!).map(edit) };
    }

    it('carries a penalty across, reads back unchanged, and keeps it on the result', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c2' ? { ...f, penaltyCode: 'SCP' as const, penaltyOverride: 10 } : f);

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('unchanged');
      const carried = second.races[0].result!.finishes.find((f) => f.competitorId === 'c2');
      expect(carried?.penaltyCode).toBe('SCP');
      expect(carried?.penaltyOverride).toBe(10);
    });

    it('keeps the penalty through a corrected finish time, and says so on both sides', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c2' ? { ...f, penaltyCode: 'SCP' as const, penaltyOverride: 10 } : f);

      const second = plan({
        races: [sourceRace({
          number: 1,
          finishes: [
            finisher(1, '1021', '11:45:20'),
            finisher(2, '1023', '11:47:00'),
            coded('DNF', '1022'),
          ],
        })],
        finishes: stored,
      });
      expect(second.races[0].state).toBe('differs');
      expect(second.races[0].changes).toEqual([
        { sailNumber: '1023', stored: '2nd, SCP 10%, 920s elapsed', incoming: '2nd, SCP 10%, 960s elapsed' },
      ]);
    });

    it('shows the penalty a boat the sheet now codes would lose', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c2' ? { ...f, penaltyCode: 'SCP' as const, penaltyOverride: 10 } : f);

      const second = plan({
        races: [sourceRace({
          number: 1,
          finishes: [
            finisher(1, '1021', '11:45:20'),
            coded('DNF', '1023'),
            coded('DNF', '1022'),
          ],
        })],
        finishes: stored,
      });
      expect(second.races[0].state).toBe('differs');
      expect(second.races[0].recommended).toBe(false);
      expect(second.races[0].changes).toEqual([
        { sailNumber: '1023', stored: '2nd, SCP 10%, 920s elapsed', incoming: 'DNF' },
      ]);
      const incoming = second.races[0].result!.finishes.find((f) => f.competitorId === 'c2');
      expect(incoming?.penaltyCode).toBeNull();
    });

    it('carries redress granted on a finish and reads back unchanged', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c1'
          ? { ...f, resultCode: 'RDG' as const, redressMethod: 'stated' as const, redressPoints: 2 }
          : f);

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('unchanged');
      const carried = second.races[0].result!.finishes.find((f) => f.competitorId === 'c1');
      expect(carried?.resultCode).toBe('RDG');
      expect(carried?.redressPoints).toBe(2);
    });

    it('shows the redress a boat coded on the sheet would lose', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c3'
          ? { ...f, resultCode: 'RDG' as const, redressMethod: 'stated' as const, redressPoints: 5 }
          : f);

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('differs');
      expect(second.races[0].changes).toEqual([
        { sailNumber: '1022', stored: 'RDG (5 pts)', incoming: 'DNF' },
      ]);
    });

    it('carries a tie when the pair is unchanged and reads back unchanged', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c2' ? { ...f, tiedWithPrevious: true } : f);

      const second = plan({ races: [sourceRace({ number: 1 })], finishes: stored });
      expect(second.races[0].state).toBe('unchanged');
      const carried = second.races[0].result!.finishes.find((f) => f.competitorId === 'c2');
      expect(carried?.tiedWithPrevious).toBe(true);
    });

    it('shows the tie a reshuffled order would lose', () => {
      const { stored } = storedWith((f) =>
        f.competitorId === 'c2' ? { ...f, tiedWithPrevious: true } : f);

      const second = plan({
        races: [sourceRace({
          number: 1,
          finishes: [
            finisher(1, '1023', '11:45:20'),
            finisher(2, '1021', '11:46:20'),
            coded('DNF', '1022'),
          ],
        })],
        finishes: stored,
      });
      expect(second.races[0].state).toBe('differs');
      expect(second.races[0].changes).toEqual([
        { sailNumber: '1021', stored: '1st, 860s elapsed', incoming: '2nd, 920s elapsed' },
        { sailNumber: '1023', stored: '2nd, tied, 920s elapsed', incoming: '1st, 860s elapsed' },
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

    it('names the boats when the race has only this fleet in it', () => {
      // A series with no fleets at all: 563 is entered and simply isn't on
      // the sheet. Nothing about that involves another fleet's start.
      const { races } = plan({
        races: [sourceRace({ number: 1 })],
        seriesRaces: [{ id: 'plain-1', name: 'Race 1', raceNumber: 1, starts: [{ fleetIds: [] }] }],
        fleetId: null,
      });
      const roster = races[0].notes.find((n) => n.kind === 'roster');
      expect(roster?.message).toBe('1 boat entered in this race is not on this sheet: 563.');
      expect(roster?.message).not.toContain('more than one fleet');
    });

    it('recognises entered boats when the sheet writes nationality-qualified sails', () => {
      // A championship export writes "IRL 1021" where the competitor list
      // says sail 1021, nationality IRL. That is the same boat: she resolves,
      // and the roster check doesn't report her missing.
      const qualified: Candidate[] = [
        { id: 'c1', sailNumber: '1021', nationality: 'IRL', fleetIds: [YELLOW] },
        { id: 'c2', sailNumber: '1023', nationality: 'GBR', fleetIds: [YELLOW] },
      ];
      const { races } = planRaceSenseImport({
        workbook: workbook([sourceRace({
          number: 1,
          starters: [starter('IRL 1021'), starter('GBR 1023')],
          finishes: [finisher(1, 'IRL 1021', '11:45:20'), finisher(2, 'GBR 1023', '11:46:20')],
        })]),
        fleetId: YELLOW,
        races: [seriesRace(1)],
        competitors: qualified,
        finishes: [],
      });
      expect(warnings(races[0].notes)).toEqual([]);
      expect(races[0].recommended).toBe(true);
      expect(races[0].result!.finishes.map((f) => f.competitorId)).toEqual(['c1', 'c2']);
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

describe('what the device captured', () => {
  const tracked = (
    position: number,
    sailNumber: string,
    finishTime: string,
    track: { total?: number; speed?: number; distance?: number },
  ): RaceSenseFinish => ({
    position, code: null, sailNumber, boatName: '', bowNumber: '', finishTime,
    totalTimeSecs: track.total ?? null,
    maxSpeedKts: track.speed ?? null,
    distanceKm: track.distance ?? null,
  });

  const trackedRace = (number: number): RaceSenseRace => sourceRace({
    number,
    starters: [
      { ...starter('1021'), dtlAtStartM: 8.45 },
      { ...starter('1023'), dtlAtStartM: 4.36 },
      { ...starter('1022', 'OCS', 'ocs'), dtlAtStartM: -326.16 },
    ],
    finishes: [
      tracked(1, '1021', '11:45:20', { total: 860.45, speed: 14.6, distance: 2.73 }),
      tracked(2, '1023', '11:46:20', { total: 920.987, speed: 11.1, distance: 2.705 }),
      coded('DNF', '1022'),
    ],
  });

  it('hangs each boat’s capture on her planned finish row', () => {
    const { races } = plan({ races: [trackedRace(1)] });
    const byId = new Map(races[0].result!.finishes.map((f) => [f.competitorId, f]));
    // Elapsed is a recording of the finish, so it rides on the row itself;
    // the track metrics ride in `trackData`.
    expect(byId.get('c1')?.elapsedSecs).toBe(860.45);
    expect(byId.get('c1')?.trackData).toEqual({
      dtlAtStartM: 8.45, distanceKm: 2.73, maxSpeedKts: 14.6,
    });
    // The coded boat keeps what the device knows about her: the DTL alone.
    expect(byId.get('c3')?.elapsedSecs).toBeUndefined();
    expect(byId.get('c3')?.trackData).toEqual({ dtlAtStartM: -326.16 });
  });

  it('reports a drifting finishing time about the workbook, not against a race', () => {
    // The timestamp isn't imported, so a race whose sheet carries a bad one
    // is not a race with a problem — it stays recommended, and the note goes
    // where facts about the file go.
    const { races, workbookNotes } = plan({
      races: [sourceRace({ number: 1 })],
      anomalies: [{
        severity: 'info',
        kind: 'finish-time-drift',
        sheet: 'Race 1',
        where: 'finish row for 1021',
        message: "1021's finishing time is an hour earlier than her elapsed time.",
      }],
    });
    expect(races[0].notes.map((n) => n.kind)).not.toContain('finish-time-drift');
    expect(races[0].recommended).toBe(true);
    const [note] = workbookNotes.filter((n) => n.kind === 'finish-time-drift');
    expect(note.severity).toBe('info');
    expect(note.message).toContain('1021');
    // The result is unaffected: her elapsed time is what was imported.
    expect(races[0].result!.finishes.find((f) => f.competitorId === 'c1')?.elapsedSecs).toBe(860);
  });

  it('imports a finisher with no Total Time untimed, and says so', () => {
    // The timestamp beside her is not a substitute: it is the value this
    // import stopped trusting, and a handicap fleet needs a real time.
    const { races } = plan({
      races: [sourceRace({
        number: 1,
        finishes: [
          tracked(1, '1021', '11:45:20', { distance: 2.73 }),
          finisher(2, '1023', '11:46:20'),
          coded('DNF', '1022'),
        ],
      })],
    });
    const boat = races[0].result!.finishes.find((f) => f.competitorId === 'c1');
    expect(boat?.sortOrder).toBe(1);
    expect(boat?.elapsedSecs).toBeUndefined();
    expect(boat?.finishTime).toBeUndefined();
    expect(boat?.trackData).toEqual({ distanceKm: 2.73 });
    expect(warnings(races[0].notes)).toContain('no-elapsed');
    expect(races[0].recommended).toBe(false);
  });

  it('reads back unchanged when the same tracked workbook is uploaded again', () => {
    const first = plan({ races: [trackedRace(1)] });
    const stored = commit(first.races[0].race!.id, first.races[0].result!);
    const second = plan({ races: [trackedRace(1)], finishes: stored });
    expect(second.races[0].state).toBe('unchanged');
  });

  it('reads a race imported before the capture existed as differs, showing the addition', () => {
    const first = plan({ races: [trackedRace(1)] });
    const stored = commit(first.races[0].race!.id, first.races[0].result!)
      .map(({ trackData: _dropped, elapsedSecs: _also, ...f }) => f as Finish);
    const second = plan({ races: [trackedRace(1)], finishes: stored });
    expect(second.races[0].state).toBe('differs');
    const change = second.races[0].changes.find((c) => c.sailNumber === '1021');
    expect(change?.stored).toBe('1st');
    expect(change?.incoming).toContain('860.45s elapsed');
    expect(change?.incoming).toContain('2.73 km sailed');
    expect(change?.incoming).toContain('max 14.6 kn');
    expect(change?.incoming).toContain('DTL 8.45 m');
  });
});
