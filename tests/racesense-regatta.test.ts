import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { finishRowsFromImport } from '@/lib/finish-entry';
import type { Candidate } from '@/lib/finish-sheet-csv';
import { parseWorkbookBytes } from '@/lib/import-table';
import { planRaceSenseImport, type SeriesRace } from '@/lib/racesense-plan';
import {
  decodeFirestoreValue,
  parseRaceSensePlayerRef,
  parseTimestampMs,
  pickDivision,
  PRUNED_FIELDS,
  pruneFirestoreDocument,
  readRaceSenseRegatta,
  readRaceSenseRegattaDocument,
  regattaToWorkbook,
  type FirestoreDocument,
  type RaceSenseRegatta,
  type RaceSenseRegattaRace,
} from '@/lib/racesense-regatta';
import { parseRaceSenseWorkbook, type RaceSenseWorkbook } from '@/lib/racesense-workbook';
import type { Finish } from '@/lib/types';

/**
 * The fixture pair: the regatta document behind the ILCA 7 Worlds 2026
 * Elimination Series replay on the RaceSense player, and the workbook the
 * race committee exported from the same regatta for the Gold division. Six
 * races, 47 boats. The document is captured as the Firestore REST API
 * returned it, pruned of positions and device identifiers.
 *
 * The property under test is that the two sources say the same thing —
 * not approximately, but to the figure the app stores, so that a race
 * imported from one reads back `unchanged` from the other.
 */
const DOCUMENT = resolve(__dirname, 'fixtures/racesense/ilca7-elimination-series.json');
const WORKBOOK = resolve(__dirname, 'fixtures/xlsx/racesense-ilca7-gold.xlsx');

const REGATTA_ID = '5JsqWPmBU6P7G5rk15ic';

function loadDocument(): FirestoreDocument {
  return JSON.parse(readFileSync(DOCUMENT, 'utf8')) as FirestoreDocument;
}

function loadRegatta(): RaceSenseRegatta {
  return readRaceSenseRegattaDocument(loadDocument(), REGATTA_ID);
}

async function loadWorkbook(): Promise<RaceSenseWorkbook> {
  const bytes = readFileSync(WORKBOOK);
  const parsed = await parseWorkbookBytes(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  if (parsed.kind === 'error') throw new Error(parsed.message);
  return parseRaceSenseWorkbook(parsed.sheets);
}

function goldFromPlayer(): RaceSenseWorkbook {
  const regatta = loadRegatta();
  const gold = pickDivision(regatta, 'Gold');
  if (!gold) throw new Error('no Gold division in the fixture');
  return regattaToWorkbook(regatta, gold);
}

// ---------------------------------------------------------------------------

describe('parseRaceSensePlayerRef', () => {
  it('reads a watch URL with its division', () => {
    expect(parseRaceSensePlayerRef('https://player.vakaros.com/watch/5JsqWPmBU6P7G5rk15ic/Gold'))
      .toEqual({ regattaId: REGATTA_ID, division: 'Gold' });
  });

  it('reads a URL without a scheme, a division with a space, and a query', () => {
    expect(parseRaceSensePlayerRef('player.vakaros.com/watch/5JsqWPmBU6P7G5rk15ic/Fleet%20A?live=true'))
      .toEqual({ regattaId: REGATTA_ID, division: 'Fleet A' });
  });

  it('reads a URL that names no division', () => {
    expect(parseRaceSensePlayerRef('https://player.vakaros.com/watch/5JsqWPmBU6P7G5rk15ic/'))
      .toEqual({ regattaId: REGATTA_ID, division: null });
  });

  it('reads the bare id the workbook prints as Regatta ID', () => {
    expect(parseRaceSensePlayerRef(`  ${REGATTA_ID} `))
      .toEqual({ regattaId: REGATTA_ID, division: null });
  });

  it('rejects what is neither', () => {
    expect(parseRaceSensePlayerRef('')).toBeNull();
    expect(parseRaceSensePlayerRef('Gold')).toBeNull();
    expect(parseRaceSensePlayerRef('https://player.vakaros.com/')).toBeNull();
    expect(parseRaceSensePlayerRef('https://player.vakaros.com/about/5JsqWPmBU6P7G5rk15ic')).toBeNull();
    expect(parseRaceSensePlayerRef('https://player.vakaros.com/watch/not an id')).toBeNull();
  });
});

describe('the Firestore JSON', () => {
  it('decodes every value type the document uses', () => {
    expect(decodeFirestoreValue({
      mapValue: {
        fields: {
          s: { stringValue: 'Gold' },
          i: { integerValue: '3600000000' },
          d: { doubleValue: 10.166 },
          b: { booleanValue: true },
          n: { nullValue: null },
          t: { timestampValue: '2026-08-27T11:05:01Z' },
          a: { arrayValue: { values: [{ stringValue: 'x' }, { integerValue: '2' }] } },
          e: { arrayValue: {} },
        },
      },
    })).toEqual({
      s: 'Gold', i: 3600000000, d: 10.166, b: true, n: null, t: '2026-08-27T11:05:01Z', a: ['x', 2], e: [],
    });
  });

  it('parses timestamps with more fractional digits than Date.parse promises', () => {
    expect(parseTimestampMs('2026-08-27T12:03:19.495300Z')).toBe(Date.UTC(2026, 7, 27, 12, 3, 19, 495));
    expect(parseTimestampMs('2026-08-27T11:05:01Z')).toBe(Date.UTC(2026, 7, 27, 11, 5, 1));
    expect(parseTimestampMs('2026-08-27T12:05:01+01:00')).toBe(Date.UTC(2026, 7, 27, 11, 5, 1));
    expect(parseTimestampMs('yesterday')).toBeNull();
    expect(parseTimestampMs(null)).toBeNull();
  });

  it('prunes the telemetry and identifiers at every depth, and nothing else', () => {
    const pruned = pruneFirestoreDocument({
      name: 'projects/x/documents/regattas/abc',
      fields: {
        adminId: { stringValue: 'who' },
        name: { stringValue: 'Regatta' },
        divisions: { arrayValue: { values: [{ mapValue: { fields: {
          name: { stringValue: 'Gold' },
          participants: { arrayValue: { values: [{ mapValue: { fields: {
            sailNumber: { stringValue: 'IRL 1' },
            atlasSn: { stringValue: '0228007140' },
          } } }] } },
        } } }] } },
      },
    });
    expect(pruned).toEqual({
      name: 'projects/x/documents/regattas/abc',
      fields: {
        name: { stringValue: 'Regatta' },
        divisions: { arrayValue: { values: [{ mapValue: { fields: {
          name: { stringValue: 'Gold' },
          participants: { arrayValue: { values: [{ mapValue: { fields: {
            sailNumber: { stringValue: 'IRL 1' },
          } } }] } },
        } } }] } },
      },
    });
  });

  it('the fixture carries none of the pruned fields', () => {
    const text = readFileSync(DOCUMENT, 'utf8');
    for (const key of PRUNED_FIELDS) {
      expect(text.includes(`"${key}"`), key).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the regatta document', () => {
  it('reads the regatta and its divisions', () => {
    const regatta = loadRegatta();
    expect(regatta.id).toBe(REGATTA_ID);
    expect(regatta.name).toBe('ILCA 7 Worlds Elimination Series');
    expect(regatta.divisions.map((d) => d.name)).toEqual(['Gold', 'Silver', 'Bronze']);
    const gold = regatta.divisions[0];
    expect(gold.boatClass).toBe('ILCA');
    expect(gold.participants).toHaveLength(47);
    expect(gold.races.map((r) => r.raceNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(gold.races.every((r) => r.stage === 'finished')).toBe(true);
    expect(gold.races[0].timezoneOffsetMs).toBe(3_600_000);
    expect(gold.races[0].starts[0].prepFlag).toBe('p');
  });

  it('picks the division the URL watched, or the only one, or none', () => {
    const regatta = loadRegatta();
    expect(pickDivision(regatta, 'silver')?.name).toBe('Silver');
    expect(pickDivision(regatta, null)).toBeNull();
    expect(pickDivision(regatta, 'Platinum')).toBeNull();
    const one: RaceSenseRegatta = { ...regatta, divisions: [regatta.divisions[2]] };
    expect(pickDivision(one, null)?.name).toBe('Bronze');
    expect(pickDivision(one, 'Gold')?.name).toBe('Bronze');
  });

  it('reads a document with nothing in it as a regatta with nothing in it', () => {
    expect(readRaceSenseRegatta({}, 'abc')).toEqual({
      id: 'abc', name: null, startDate: null, endDate: null, modifiedTs: null,
      sequenceNumber: null, divisions: [],
    });
  });
});

// ---------------------------------------------------------------------------

describe('the same regatta from the player and from the export', () => {
  it('has the same header', async () => {
    const fromPlayer = goldFromPlayer();
    const fromExport = await loadWorkbook();
    expect(fromExport.regattaId).toBe(REGATTA_ID);
    expect(fromPlayer.regattaId).toBe(REGATTA_ID);
    expect(fromPlayer.regatta).toBe(fromExport.regatta);
    expect(fromPlayer.division).toBe('Gold');
    expect(fromPlayer.regattaStartDate).toBe(fromExport.regattaStartDate);
    expect(fromPlayer.races.map((r) => r.number)).toEqual(fromExport.races.map((r) => r.number));
  });

  it('agrees on every start: the gun, the signal, every boat’s status and distance to the line', async () => {
    const fromPlayer = goldFromPlayer();
    const fromExport = await loadWorkbook();
    for (const [i, exported] of fromExport.races.entries()) {
      const read = fromPlayer.races[i];
      const label = exported.sheetName;
      expect(read.date, label).toBe(exported.date);
      expect(read.startTime, label).toBe(exported.startTime);
      expect(read.preparatorySignal, label).toBe(exported.preparatorySignal);
      expect(read.startNumber, label).toBe(exported.startNumber);

      const starters = (w: typeof read) =>
        new Map(w.starters.map((s) => [s.sailNumber, { status: s.status, dtl: s.dtlAtStartM, name: s.boatName }]));
      expect(starters(read), label).toEqual(starters(exported));
    }
  });

  it('agrees on every finish: the order, the elapsed time to the millisecond, speed and distance', async () => {
    const fromPlayer = goldFromPlayer();
    const fromExport = await loadWorkbook();
    for (const [i, exported] of fromExport.races.entries()) {
      const read = fromPlayer.races[i];
      const label = exported.sheetName;
      const placed = (w: typeof read) =>
        (w.finishes ?? []).filter((f) => f.position !== null).map((f) => ({
          position: f.position,
          sailNumber: f.sailNumber,
          totalTimeSecs: f.totalTimeSecs,
          maxSpeedKts: f.maxSpeedKts,
          distanceKm: f.distanceKm,
        }));
      expect(placed(read), label).toEqual(placed(exported));

      const tail = (w: typeof read) =>
        (w.finishes ?? []).filter((f) => f.position === null).map((f) => `${f.code} ${f.sailNumber}`).sort();
      expect(tail(read), label).toEqual(tail(exported));
    }
  });

  it('raises the same short-course warning from either source', async () => {
    // One boat in race 5 of this event reads 3.91 km against a fleet median
    // of 7.23 km — half the course missing — with an elapsed time 22 seconds
    // under the median, so she trips the check while finishing 18th of 46.
    // That is a lost track rather than a lost lap, and exactly the call the
    // warning leaves to the scorer: it says which finish to look up in the
    // committee's results, not which one is wrong.
    const short = (w: RaceSenseWorkbook) =>
      w.anomalies.filter((a) => a.kind === 'short-course-finish')
        .map((a) => `${a.sheet}: ${a.message}`);
    const fromExport = await loadWorkbook();
    expect(short(fromExport)).toEqual([
      'Race 5: ITA 221118 finished 3.91 km in 55:41, against a fleet median of 7.23 km'
      + " and 56:03. A boat crossing the line a lap early looks like this. Check her"
      + " finish against the race committee's.",
    ]);
    expect(short(goldFromPlayer())).toEqual(short(fromExport));
  });

  it('has the right time of day where the export’s rendering is an hour out', async () => {
    // The export has been seen writing individual boats' finishing times an
    // hour out while their elapsed times stayed right; the document's
    // timestamps are the measurement and don't. So the two disagree on
    // exactly the rows the workbook parser flags, and nowhere else.
    const fromPlayer = goldFromPlayer();
    const fromExport = await loadWorkbook();
    const flagged = new Set(
      fromExport.anomalies
        .filter((a) => a.kind === 'finish-time-drift')
        .map((a) => `${a.sheet} ${a.where}`),
    );
    const disagreeing = new Set<string>();
    for (const [i, exported] of fromExport.races.entries()) {
      const read = fromPlayer.races[i];
      for (const f of exported.finishes ?? []) {
        if (f.position === null) continue;
        const other = read.finishes?.find((r) => r.sailNumber === f.sailNumber);
        if (other?.finishTime !== f.finishTime) {
          disagreeing.add(`${exported.sheetName} finish row for ${f.sailNumber}`);
        }
      }
    }
    expect(disagreeing).toEqual(flagged);
    expect(flagged.size).toBeGreaterThan(0);
  });

  it('reads back unchanged whichever source was imported first', async () => {
    const fromPlayer = goldFromPlayer();
    const fromExport = await loadWorkbook();
    const regatta = loadRegatta();
    const competitors: Candidate[] = regatta.divisions[0].participants.map((p, i) => ({
      id: `c${i}`,
      sailNumber: p.sailNumber,
      fleetIds: [],
    }));
    const races: SeriesRace[] = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `race-${n}`,
      name: null,
      raceNumber: n,
      starts: [{ fleetIds: [] }],
    }));
    const planFor = (workbook: RaceSenseWorkbook, finishes: Finish[]) =>
      planRaceSenseImport({ workbook, fleetId: null, races, competitors, finishes });
    const commit = (workbook: RaceSenseWorkbook): Finish[] =>
      planFor(workbook, []).races.flatMap((r) => finishRowsFromImport(r.race!.id, r.result!.finishes));

    const afterPlayer = planFor(fromExport, commit(fromPlayer));
    expect(afterPlayer.races.map((r) => r.state)).toEqual(Array(6).fill('unchanged'));
    const afterExport = planFor(fromPlayer, commit(fromExport));
    expect(afterExport.races.map((r) => r.state)).toEqual(Array(6).fill('unchanged'));
    // And nothing the plan reads is unresolved on either side.
    expect(planFor(fromPlayer, []).races.every((r) => r.result!.summary.unresolved === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('regattaToWorkbook', () => {
  function withRace(patch: Partial<RaceSenseRegattaRace>, raceNumber = 7): RaceSenseRegatta {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const template = gold.races[0];
    const extra: RaceSenseRegattaRace = { ...template, raceNumber, name: `Race ${raceNumber}`, ...patch };
    return { ...regatta, divisions: [{ ...gold, races: [...gold.races, extra] }] };
  }

  const notes = (w: RaceSenseWorkbook, kind: string) => w.anomalies.filter((a) => a.kind === kind);

  it('says when and how it read the regatta', () => {
    const w = goldFromPlayer();
    const [note] = notes(w, 'player-read');
    expect(note.severity).toBe('info');
    expect(note.message).toContain('10:56:50 on 2026-08-30');
    expect(note.message).toContain('update 80');
  });

  it('leaves a race still on the water out, and says so', () => {
    const regatta = withRace({ stage: 'racing', finishes: [] });
    const w = regattaToWorkbook(regatta, regatta.divisions[0]);
    expect(w.races.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6]);
    const [note] = notes(w, 'race-skipped');
    expect(note.severity).toBe('warning');
    expect(note.message).toContain('Race 7 is still in progress');
  });

  it('leaves a practice race out quietly, and a race never started', () => {
    const practice = withRace({ isPractice: true });
    let w = regattaToWorkbook(practice, practice.divisions[0]);
    expect(w.races).toHaveLength(6);
    expect(notes(w, 'race-skipped')[0].severity).toBe('info');

    const unstarted = withRace({ stage: 'notStarted', starts: [] });
    w = regattaToWorkbook(unstarted, unstarted.divisions[0]);
    expect(w.races).toHaveLength(6);
    expect(notes(w, 'race-skipped')[0].message).toContain('has not been started');
  });

  it('reads the last start after a general recall, and notes the recall', () => {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const race = gold.races[0];
    const recalled = { ...race.starts[0], startNumber: 1, stopReason: 'generalRecall', startTime: '2026-08-27T10:50:01Z', checkedIn: [] };
    const counted = { ...race.starts[0], startNumber: 2 };
    const withRecall: RaceSenseRegatta = {
      ...regatta,
      divisions: [{ ...gold, races: [{ ...race, starts: [recalled, counted] }] }],
    };
    const w = regattaToWorkbook(withRecall, withRecall.divisions[0]);
    expect(w.races[0].startTime).toBe('12:05:00');
    expect(w.races[0].startNumber).toBe('2');
    expect(w.races[0].starters.every((s) => s.status !== 'Not Checked-In')).toBe(true);
    const [note] = notes(w, 'general-recall');
    expect(note.severity).toBe('info');
    expect(note.message).toContain('Started 2 times');
  });

  it('warns when the start that was read did not run to a finish', () => {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const race = gold.races[0];
    const abandoned = { ...race.starts[0], stopReason: 'abandoned' };
    const r: RaceSenseRegatta = { ...regatta, divisions: [{ ...gold, races: [{ ...race, starts: [abandoned] }] }] };
    const w = regattaToWorkbook(r, r.divisions[0]);
    const [note] = notes(w, 'stop-reason');
    expect(note.severity).toBe('warning');
    expect(note.message).toContain('“abandoned”');
  });

  it('derives every status from the start’s lists', () => {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const race = gold.races[0];
    const [a, b, c, d] = gold.participants.map((p) => p.sailNumber);
    const start = {
      ...race.starts[0],
      ocs: [a, b, c],
      exonerated: [a],
      clearedOcs: [b],
      checkedIn: race.starts[0].checkedIn.filter((s) => s !== d),
    };
    const r: RaceSenseRegatta = { ...regatta, divisions: [{ ...gold, races: [{ ...race, starts: [start] }] }] };
    const w = regattaToWorkbook(r, r.divisions[0]);
    const status = (sail: string) => w.races[0].starters.find((s) => s.sailNumber === sail);
    expect(status(a)).toMatchObject({ status: 'OCS (Cleared)', meaning: 'cleared' });
    expect(status(b)).toMatchObject({ status: 'OCS *', meaning: 'cleared' });
    expect(status(c)).toMatchObject({ status: 'OCS', meaning: 'ocs' });
    expect(status(d)).toMatchObject({ status: 'Not Checked-In', meaning: 'not-checked-in' });
  });

  it('flags a start well past the minute, but still measures from the minute', () => {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const race = gold.races[0];
    const late = { ...race.starts[0], startTime: '2026-08-27T11:05:23Z' };
    const r: RaceSenseRegatta = { ...regatta, divisions: [{ ...gold, races: [{ ...race, starts: [late] }] }] };
    const w = regattaToWorkbook(r, r.divisions[0]);
    expect(w.races[0].startTime).toBe('12:05:00');
    const [note] = notes(w, 'start-seconds');
    expect(note.severity).toBe('warning');
    expect(note.message).toContain('recorded at 12:05:23');
    expect(note.message).toContain('measured from 12:05:00');
  });

  it('reads a race nobody finished as the workbook writes it: no Finishes block', () => {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const race = gold.races[0];
    const r: RaceSenseRegatta = { ...regatta, divisions: [{ ...gold, races: [{ ...race, finishes: [] }] }] };
    const w = regattaToWorkbook(r, r.divisions[0]);
    expect(w.races[0].finishes).toBeNull();
    expect(w.races[0].starters).toHaveLength(47);
  });

  it('keeps a finisher who is not among the participants, and says so', () => {
    const regatta = loadRegatta();
    const gold = regatta.divisions[0];
    const race = gold.races[0];
    const stranger = { ...race.finishes[0], sailNumber: 'IRL 999999', finishingTime: '2026-08-27T11:50:00.000Z' };
    const r: RaceSenseRegatta = {
      ...regatta,
      divisions: [{ ...gold, races: [{ ...race, finishes: [...race.finishes, stranger] }] }],
    };
    const w = regattaToWorkbook(r, r.divisions[0]);
    expect(w.races[0].finishes?.[0].sailNumber).toBe('IRL 999999');
    expect(w.races[0].finishes?.[0].totalTimeSecs).toBe(45 * 60);
    expect(notes(w, 'unlisted-finisher')[0].message).toContain('IRL 999999');
  });
});
