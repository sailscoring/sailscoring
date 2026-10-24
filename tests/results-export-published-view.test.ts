/**
 * The published view through the shared build: each page carries what it
 * shows, and what the API serves from it is what the page prints.
 */
import { describe, expect, it } from 'vitest';

import { applyPublish, viewResources, type PublicationFacts } from '@/lib/public-api/published-view';
import type { ExportRepos } from '@/lib/public-export';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import { defaultSplitFleetConfig } from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';
import { raceSchema, standingsSchema } from '@/lib/validation/public-api-v1';

const SERIES: Series = {
  id: 's1',
  name: 'Autumn League',
  venue: 'Galway',
  startDate: '2026-09-20',
  endDate: '2026-10-25',
  venueLogoUrl: '',
  eventLogoUrl: '',
  venueUrl: '',
  eventUrl: '',
  createdAt: 0,
  lastSavedAt: null,
  lastModifiedAt: 0,
  scoringMode: 'scratch',
  discardThresholds: [],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  ftpPaths: {},
  includeJsonExport: false,
  enabledCompetitorFields: ['boatName'],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
  publishingGroups: [{ id: 'g1', name: 'Overall', fleetMode: 'chosen', fleetIds: ['f-red', 'f-blue'], detail: 'full' }],
  publishIndividualFleetPages: true,
};

const FLEETS: Fleet[] = [
  { id: 'f-red', seriesId: 's1', name: 'Red', displayOrder: 0, scoringSystem: 'scratch' },
  { id: 'f-blue', seriesId: 's1', name: 'Blue', displayOrder: 1, scoringSystem: 'scratch' },
];

function competitor(id: string, sail: string, fleetIds: string[]): Competitor {
  return {
    id,
    seriesId: 's1',
    fleetIds,
    sailNumber: sail,
    boatName: `Boat ${sail}`,
    names: [`Helm ${sail}`],
    clubs: [],
    gender: '',
    age: null,
    createdAt: 0,
  };
}

const COMPETITORS = [
  competitor('c1', '101', ['f-red']),
  competitor('c2', '102', ['f-red']),
  competitor('c3', '201', ['f-blue']),
  competitor('c4', '202', ['f-blue']),
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-09-20', createdAt: 0 },
  { id: 'r2', seriesId: 's1', raceNumber: 2, name: 'Round the Islands', date: '2026-09-27', createdAt: 0 },
];

function finish(raceId: string, competitorId: string, sortOrder: number, resultCode: Finish['resultCode'] = null): Finish {
  return {
    id: `${raceId}-${competitorId}`,
    raceId,
    competitorId,
    sortOrder,
    tiedWithPrevious: false,
    resultCode,
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
  finish('r1', 'c1', 1), finish('r1', 'c2', 2), finish('r1', 'c3', 3), finish('r1', 'c4', 4),
  finish('r2', 'c2', 1), finish('r2', 'c1', 2, 'DNF'), finish('r2', 'c4', 3), finish('r2', 'c3', 4),
];

const RACE_STARTS: RaceStart[] = [
  { id: 'rs1', raceId: 'r1', fleetIds: ['f-red', 'f-blue'], startTime: '11:00:00' },
  { id: 'rs2', raceId: 'r2', fleetIds: ['f-red', 'f-blue'], startTime: '10:30:00' },
];

function makeRepos(extra: Partial<ExportRepos> = {}, raceStarts: RaceStart[] = RACE_STARTS): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => raceStarts },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
    ...extra,
  } as unknown as ExportRepos;
}

const API = 'https://app.example/api/public/v1/publications/p1';
const ctx = { apiBase: API, competitor: (id: string) => ({ id: `pub-${id}` }) };
const facts: PublicationFacts = {
  name: 'Autumn League',
  kind: 'series',
  status: null,
  workspace: { slug: 'gbsc', name: 'GBSC', url: 'https://app.example/p/gbsc' },
  season: null,
  page: 'https://app.example/p/gbsc/autumn-league',
  data: null,
  publishedAt: '2026-10-24T00:00:00.000Z',
  fleets: [],
};

async function viewOf(repos: ExportRepos) {
  const build = await buildFleetHtmlFiles(repos, 's1', undefined, { includeEntryList: true });
  const files = build!.files;
  const state = applyPublish(
    null,
    files.flatMap((f) => (f.view ? [{ pageKey: f.fleetName, view: f.view }] : [])),
    new Set(files.map((f) => f.fleetName)),
    1000,
    ctx,
  );
  return { files, resources: viewResources(state, { id: 'p1', facts }, 'Europe/Dublin', API) };
}

describe('buildFleetHtmlFiles — the published view', () => {
  it('attaches what each page shows', async () => {
    const { files } = await viewOf(makeRepos());
    const kinds = Object.fromEntries(files.map((f) => [f.fleetName, f.view?.kind]));
    expect(kinds).toEqual({ Overall: 'results', Red: 'results', Blue: 'results', Entries: 'entries' });
    const overall = files.find((f) => f.fleetName === 'Overall')!.view!;
    expect(overall.kind === 'results' && overall.sections.map((s) => s.fleetName)).toEqual(['Red', 'Blue']);
  });

  it('serves every score as the fleet page prints it', async () => {
    const { files, resources } = await viewOf(makeRepos());
    const standings = standingsSchema.parse(resources.get('standings'));
    expect(standings.tables.map((t) => t.fleet.key)).toEqual(['red', 'blue']);
    for (const table of standings.tables) {
      const html = files.find((f) => f.fleetName === table.fleet.name)!.html;
      for (const row of table.rows) {
        expect(html).toContain(`<td>${row.rankDisplay}</td>`);
        for (const score of row.scores) {
          expect(html).toMatch(new RegExp(`>${score!.display.replace(/[()]/g, '\\$&')}<`));
        }
      }
    }
    const red = standings.tables[0];
    expect(red.rows.map((r) => r.competitor.boatName)).toEqual(['Boat 102', 'Boat 101']);
    expect(red.rows[1].scores[1]).toMatchObject({ code: 'DNF' });
  });

  it('numbers races as the series does, with each fleet\'s gun', async () => {
    const { resources } = await viewOf(makeRepos());
    const race = raceSchema.parse(resources.get('races/2'));
    expect(race.name).toBe('Round the Islands');
    expect(race.fleets.map((f) => [f.fleet.key, f.startTime])).toEqual([
      ['red', '10:30:00'],
      ['blue', '10:30:00'],
    ]);
    expect(race.fleets[0].results.map((r) => r.competitor.sailNumber)).toEqual(['102', '101']);
  });

  it('serves a championship as one ranking, and its races by fleet', async () => {
    const repos = makeRepos(
      {
        splitFleets: {
          get: async () => ({
            config: defaultSplitFleetConfig(2),
            rounds: [
              {
                id: 'round1', seriesId: 's1', stage: 'qualifying', roundNumber: 1,
                fromStageRace: 1, fleetIds: ['f-red', 'f-blue'], method: 'seeded',
                basis: null, overrides: {}, createdAt: 0,
              },
            ],
          }),
        },
      } as unknown as Partial<ExportRepos>,
      [
        { id: 'rs1', raceId: 'r1', fleetIds: ['f-red', 'f-blue'], startTime: '10:00:00', stage: 'qualifying', stageRaceNumber: 1 },
      ],
    );
    const { files, resources } = await viewOf(repos);
    expect(files.find((f) => f.fleetName === 'Championship')!.view?.kind).toBe('championship');
    const standings = standingsSchema.parse(resources.get('standings'));
    expect(standings.tables.map((t) => t.fleet.name)).toEqual(['Championship']);
    expect(standings.tables[0].races.map((r) => r.label)).toEqual(['Q1']);
    expect(standings.tables[0].rows).toHaveLength(4);
    const race = raceSchema.parse(resources.get('races/1'));
    expect(race.fleets.map((f) => f.fleet.name).sort()).toEqual(['Blue', 'Red']);
    expect(race.fleets.every((f) => f.results[0].rank === 1)).toBe(true);
  });
});
