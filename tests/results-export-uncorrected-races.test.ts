/**
 * A page must never print points it won't break down (#563).
 *
 * A progressive fleet (ECHO/NHC) left out of a race's start has no gun to
 * measure elapsed time from, so the engine scores that race on crossing order
 * — the fallback #562 now warns about. The published page has to agree with
 * the summary it prints: before this, the export read the race off the ECHO
 * rating map, found nothing there, and emitted a page of standings whose R1
 * column nothing explained.
 *
 * The HYC Autumn League shape that found it: ECHO fleets added to a series
 * whose races already had starts, so the start covers the IRC fleet and not
 * them.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import { calculateFleetStandings } from '@/lib/scoring';
import type { ExportRepos } from '@/lib/public-export';
import type {
  Competitor,
  Finish,
  Fleet,
  PublishingGroup,
  Race,
  RaceStart,
  Series,
} from '@/lib/types';

const ECHO_PAGE: PublishingGroup = {
  id: 'g-echo',
  name: 'ECHO Results',
  fleetMode: 'chosen',
  fleetIds: ['f-echo-1', 'f-echo-2'],
  detail: 'full',
};

const FLEETS: Fleet[] = [
  { id: 'f-irc', seriesId: 's1', name: 'Class 1 (IRC)', displayOrder: 0, scoringSystem: 'irc' },
  { id: 'f-echo-1', seriesId: 's1', name: 'Class 1 (Echo)', displayOrder: 1, scoringSystem: 'echo' },
  { id: 'f-echo-2', seriesId: 's1', name: 'Class 2 (Echo)', displayOrder: 2, scoringSystem: 'echo' },
];

// Class 1 boats are in the IRC fleet and its ECHO companion; Class 2 boats
// only in their own ECHO fleet.
const COMPETITORS: Competitor[] = [
  comp('c1', '101', ['f-irc', 'f-echo-1'], 1.1, 1.05),
  comp('c2', '102', ['f-irc', 'f-echo-1'], 0.9, 0.95),
  comp('c3', '103', ['f-irc', 'f-echo-1'], 1.0, 1.0),
  comp('c4', '201', ['f-echo-2'], undefined, 1.02),
  comp('c5', '202', ['f-echo-2'], undefined, 0.98),
  comp('c6', '203', ['f-echo-2'], undefined, 1.0),
];

function comp(
  id: string,
  sail: string,
  fleetIds: string[],
  ircTcc: number | undefined,
  echoStartingTcf: number,
): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: sail,
    names: [`Helm ${sail}`],
    clubs: [],
    gender: '',
    age: null,
    createdAt: 0,
    ...(ircTcc != null ? { ircTcc } : {}),
    echoStartingTcf,
  };
}

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-05', createdAt: 0 },
];

/** The only start in the race, and the ECHO fleets are not in it. */
const STARTS: RaceStart[] = [
  { id: 'rs1', raceId: 'r1', fleetIds: ['f-irc'], startTime: '14:00:00' },
];

function finish(competitorId: string, sortOrder: number, finishTime: string): Finish {
  return {
    id: `r1-${competitorId}`,
    raceId: 'r1',
    competitorId,
    sortOrder,
    finishTime,
    tiedWithPrevious: false,
    resultCode: null,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

const FINISHES: Finish[] = [
  finish('c1', 1, '14:50:00'),
  finish('c2', 2, '14:55:00'),
  finish('c3', 3, '15:00:00'),
  finish('c4', 4, '15:05:00'),
  finish('c5', 5, '15:10:00'),
  finish('c6', 6, '15:15:00'),
];

function makeSeries(): Series {
  return {
    id: 's1',
    name: 'Autumn League',
    venue: 'HYC',
    startDate: '2026-09-01',
    endDate: '2026-10-30',
    venueLogoUrl: '',
    eventLogoUrl: '',
    venueUrl: '',
    eventUrl: '',
    createdAt: 0,
    lastSavedAt: null,
    lastModifiedAt: 0,
    scoringMode: 'handicap',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    ftpPaths: {},
    includeJsonExport: false,
    enabledCompetitorFields: ['club'],
    primaryPersonLabel: 'helm',
    subdivisionAxes: [],
    publishingGroups: [ECHO_PAGE],
    publishIndividualFleetPages: true,
  };
}

function makeRepos(series: Series): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === series.id ? series : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => STARTS },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}

async function pages() {
  const build = await buildFleetHtmlFiles(makeRepos(makeSeries()), 's1');
  const byName = new Map(build!.files.map((f) => [f.fleetName, f.html]));
  return byName;
}

describe('a fleet whose race had no start to correct against', () => {
  it('publishes the race detail its standings column refers to', async () => {
    const html = (await pages()).get('Class 1 (Echo)')!;
    expect(html.match(/class="racetable"/g)).toHaveLength(1);
    // Every finisher is in it, not just the ones the ECHO chain scored.
    for (const sail of ['101', '102', '103']) expect(html).toContain(`>${sail}<`);
  });

  it('keeps the combined page full-detail rather than silently standings-only', async () => {
    const html = (await pages()).get('ECHO Results')!;
    // One race block per member fleet, and the summary columns link into them.
    expect(html.match(/class="racetable"/g)).toHaveLength(2);
    expect(html).toContain('<section class="fleetraces" id="class-1-echo-races">');
    expect(html).toContain('<section class="fleetraces" id="class-2-echo-races">');
    expect(html).toContain('href="#class-1-echo-r1"');
    expect(html).toContain('href="#class-2-echo-r1"');
  });

  it('shows no rating or corrected-time columns, which is the race saying it was not corrected', async () => {
    const html = (await pages()).get('Class 1 (Echo)')!;
    expect(html).toContain('class="racetable"');
    expect(html).not.toContain('class="starth"');
    expect(html).not.toContain('<th>CT</th>');
    // The scores are crossing order, the way the engine scored them.
    const ranks = [...html.matchAll(/<td[^>]*>(10[123])<\/td>/g)].map((m) => m[1]);
    expect(ranks.slice(0, 3)).toEqual(['101', '102', '103']);
  });

  it('a fleet that is in the start still corrects, so the difference is the start', async () => {
    const html = (await pages()).get('Class 1 (IRC)')!;
    expect(html).toContain('class="tcc"');
    expect(html).toContain('<th>CT</th>');
    // 102's lower TCC corrects it ahead of 101, which crossed first.
    expect(html.indexOf('>102<')).toBeLessThan(html.indexOf('>101<'));
  });
});

/**
 * The renderer reads its per-race detail off these maps, so the engine records
 * what every race scored — not only the races the rating chain advanced on.
 * NHC shares the shape; the export path reads both the same way.
 */
describe('the progressive score maps cover every race', () => {
  const race: Race = RACES[0];

  function standingsFor(
    system: 'nhc' | 'echo',
    starts: RaceStart[],
    struckRaceIds?: Map<string, Set<string>>,
  ) {
    const fleet: Fleet = { id: 'f1', seriesId: 's1', name: system.toUpperCase(), displayOrder: 0, scoringSystem: system };
    const competitors = COMPETITORS.slice(0, 3).map((c) => ({
      ...c,
      fleetIds: ['f1'],
      nhcStartingTcf: c.echoStartingTcf,
    }));
    return calculateFleetStandings(
      [fleet],
      competitors,
      [race],
      FINISHES.slice(0, 3),
      [],
      'seriesEntries',
      starts,
      undefined,
      undefined,
      struckRaceIds,
    ).fleetStandings[0];
  }

  for (const system of ['nhc', 'echo'] as const) {
    const key = system === 'nhc' ? 'nhcRaceScoresByRaceId' : 'echoRaceScoresByRaceId';

    it(`${system}: a race with no start still carries its scores, uncorrected`, () => {
      const scores = standingsFor(system, [])[key]!.get(race.id);
      expect(scores).toBeDefined();
      expect([...scores!.keys()].sort()).toEqual(['c1', 'c2', 'c3']);
      // Nothing was corrected, so every handicap field is empty.
      for (const s of scores!.values()) {
        expect(s.tcfApplied).toBeNull();
        expect(s.correctedTime).toBeNull();
      }
      expect(scores!.get('c1')!.points).toBe(1);
    });

    it(`${system}: a race with a start carries the chain's own scores`, () => {
      const started: RaceStart[] = [{ id: 'rs1', raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' }];
      const scores = standingsFor(system, started)[key]!.get(race.id);
      expect(scores).toBeDefined();
      for (const s of scores!.values()) expect(s.tcfApplied).not.toBeNull();
    });

    it(`${system}: a race struck for the fleet keeps its corrected scores`, () => {
      // Striking a race holds the rating chain across it, so the rating
      // update is skipped — but the race was corrected, and its detail has to
      // print the corrected times rather than fall back to crossing order.
      const started: RaceStart[] = [{ id: 'rs1', raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' }];
      const struck = new Map([['f1', new Set(['r1'])]]);
      const scores = standingsFor(system, started, struck)[key]!.get(race.id);
      expect(scores).toBeDefined();
      for (const s of scores!.values()) {
        expect(s.tcfApplied).not.toBeNull();
        expect(s.correctedTime).not.toBeNull();
      }
    });
  }
});
