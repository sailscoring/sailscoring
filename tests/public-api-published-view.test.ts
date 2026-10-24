import { describe, expect, it } from 'vitest';

import {
  applyPublish,
  viewResources,
  type PageView,
  type PublicationFacts,
  type ViewContext,
} from '@/lib/public-api/published-view';
import type { SeriesResultsData } from '@/lib/results-renderer';
import {
  competitorsSchema,
  publicationSchema,
  raceSchema,
  racesSchema,
  standingsSchema,
} from '@/lib/validation/public-api-v1';

const API = 'https://app.example/api/public/v1/publications/pub-1';

const ctx: ViewContext = {
  apiBase: API,
  competitor: (id) => ({ id: `pub-${id}` }),
};

const facts: PublicationFacts = {
  name: 'Autumn League',
  kind: 'series',
  status: 'provisional',
  workspace: { slug: 'gbsc', name: 'Galway Bay SC', url: 'https://app.example/p/gbsc' },
  season: '2026',
  page: 'https://app.example/p/gbsc/autumn-league',
  data: null,
  publishedAt: '2026-10-24T10:00:00.000Z',
  fleets: [{ key: 'cruisers-1', name: 'Cruisers 1', scoringSystem: 'irc' }],
};

/** One fleet, two races: Alpha wins both, Bravo retires from the second. */
function fleetData(alphaSecond = 1): SeriesResultsData {
  return {
    series: { name: 'Autumn League', venue: 'Galway' },
    enabledCompetitorFields: ['boatName', 'club', 'gender'],
    primaryPersonLabel: 'helm',
    races: [1, 2].map((n) => ({
      raceNumber: n,
      raceId: `race-${n}`,
      order: n,
      date: `2026-10-0${n}`,
      label: `R${n}`,
      anchorId: `r${n}`,
      startTime: '11:00:00',
      results: [
        {
          competitorId: 'a',
          sailNumber: 'IRL 1',
          boatName: 'Alpha',
          helm: ['Ann'],
          clubs: ['GBSC'],
          gender: '',
          place: 1,
          rank: 1,
          points: n === 2 ? alphaSecond : 1,
          resultCode: null,
          penaltyCode: null,
          penaltyOverride: null,
          tcc: 1.012,
          finishTime: '12:00:00',
          elapsedTimeSecs: 3600,
          correctedTimeSecs: 3643,
        },
        {
          competitorId: 'b',
          sailNumber: 'IRL 2',
          boatName: 'Bravo',
          helm: ['Ben'],
          place: n === 1 ? 2 : null,
          rank: n === 1 ? 2 : null,
          points: n === 1 ? 2 : 3,
          resultCode: n === 1 ? null : 'DNF',
          penaltyCode: null,
          penaltyOverride: null,
        },
      ],
    })),
    standings: [
      {
        rank: 1,
        competitorId: 'a',
        sailNumber: 'IRL 1',
        boatName: 'Alpha',
        helm: ['Ann'],
        clubs: ['GBSC'],
        raceScores: [
          { points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null, isDiscard: false, isRedress: false, podiumRank: 1 },
          { points: alphaSecond, resultCode: null, penaltyCode: null, penaltyOverride: null, isDiscard: false, isRedress: false, podiumRank: 1 },
        ],
        totalPoints: 1 + alphaSecond,
        netPoints: 1 + alphaSecond,
      },
      {
        rank: 2,
        competitorId: 'b',
        sailNumber: 'IRL 2',
        boatName: 'Bravo',
        helm: ['Ben'],
        raceScores: [
          { points: 2, resultCode: null, penaltyCode: null, penaltyOverride: null, isDiscard: false, isRedress: false, podiumRank: 2 },
          { points: 3, resultCode: 'DNF', penaltyCode: null, penaltyOverride: null, isDiscard: true, isRedress: false, podiumRank: null },
        ],
        totalPoints: 5,
        netPoints: 2,
      },
    ],
  };
}

function resultsPage(data: SeriesResultsData, fleetName = 'Cruisers 1'): PageView {
  return { kind: 'results', sections: [{ fleetName, scoringSystem: 'irc', data }] };
}

const entriesPage: PageView = {
  kind: 'entries',
  count: 1,
  display: { enabledCompetitorFields: ['boatName'], primaryPersonLabel: 'helm' },
  groups: [
    {
      ratingColumns: [],
      rows: [{ competitorId: 'a', sailNumber: 'IRL 1', boatName: 'Alpha', names: ['Ann'], fleetNames: ['Cruisers 1'] }],
    },
  ],
};

function resources(state: ReturnType<typeof applyPublish>) {
  return viewResources(state, { id: 'pub-1', facts }, 'Europe/Dublin', API);
}

describe('the published view', () => {
  it('serves a fleet page as standings and race results, in the v1 shapes', () => {
    const state = applyPublish(null, [{ pageKey: 'cruisers', view: resultsPage(fleetData()) }], new Set(['cruisers']), Date.UTC(2026, 9, 24), ctx);
    const out = resources(state);
    expect([...out.keys()].sort()).toEqual(['', 'races', 'races/1', 'races/2', 'standings', 'standings/cruisers-1']);

    const standings = standingsSchema.parse(out.get('standings'));
    const [table] = standings.tables;
    expect(table.namesLabel).toBe('Helm');
    expect(table.races.map((r) => r.race)).toEqual([1, 2]);
    const bravo = table.rows[1];
    expect(bravo.rankDisplay).toBe('2nd');
    expect(bravo.scores[1]).toEqual({ points: 3, code: 'DNF', discarded: true, display: '(3.0 DNF)' });
    expect(bravo.netDisplay).toBe('2.0');
    // Only the fields the series displays, and only where there is a value.
    expect(table.rows[0].competitor).toEqual({
      id: 'pub-a',
      sailNumber: 'IRL 1',
      boatName: 'Alpha',
      names: ['Ann'],
      clubs: ['GBSC'],
    });

    const race = raceSchema.parse(out.get('races/2'));
    expect(race.fleets[0].ratingLabel).toBe('TCC');
    expect(race.fleets[0].results[0]).toMatchObject({ rank: 1, display: '1.0', elapsed: '1:00:00', corrected: '1:00:43', rating: 1.012 });
    expect(race.fleets[0].results[1]).toMatchObject({ rank: null, code: 'DNF', display: '3.0 DNF' });

    const races = racesSchema.parse(out.get('races'));
    expect(races.races[0]).toMatchObject({ race: 1, starts: [{ time: '11:00:00', fleets: ['cruisers-1'] }], url: `${API}/races/1` });

    const publication = publicationSchema.parse(out.get(''));
    expect(publication.resources.standings?.url).toBe(`${API}/standings`);
    expect(publication.resources.competitors).toBeUndefined();
  });

  it('leaves a part alone when its page is not ticked', () => {
    const first = applyPublish(
      null,
      [
        { pageKey: 'cruisers', view: resultsPage(fleetData()) },
        { pageKey: 'entries', view: entriesPage },
      ],
      new Set(['cruisers', 'entries']),
      1000,
      ctx,
    );
    // Race 2 is re-entered, but only the entry list is published.
    const second = applyPublish(first, [{ pageKey: 'entries', view: entriesPage }], new Set(['cruisers', 'entries']), 2000, ctx);
    const out = resources(second);
    const standings = standingsSchema.parse(out.get('standings'));
    expect(standings.tables[0].rows[0].total).toBe(2);
    expect(standings.publishedAt).toBe(new Date(1000).toISOString());
    const competitors = competitorsSchema.parse(out.get('competitors'));
    expect(competitors.publishedAt).toBe(new Date(2000).toISOString());

    // Publishing the fleet page moves both standings and the race on.
    const third = applyPublish(second, [{ pageKey: 'cruisers', view: resultsPage(fleetData(4)) }], new Set(['cruisers', 'entries']), 3000, ctx);
    const after = resources(third);
    expect(standingsSchema.parse(after.get('standings')).tables[0].rows[0].total).toBe(5);
    expect(raceSchema.parse(after.get('races/2')).publishedAt).toBe(new Date(3000).toISOString());
  });

  it('removes what a retracted page showed, unless another live page shows it', () => {
    const both = applyPublish(
      null,
      [
        { pageKey: 'cruisers', view: resultsPage(fleetData()) },
        { pageKey: 'overall', view: resultsPage(fleetData()) },
        { pageKey: 'entries', view: entriesPage },
      ],
      new Set(['cruisers', 'overall', 'entries']),
      1000,
      ctx,
    );
    const withoutFleetPage = applyPublish(both, [], new Set(['overall', 'entries']), 2000, ctx);
    expect(resources(withoutFleetPage).has('standings')).toBe(true);

    const withoutEither = applyPublish(withoutFleetPage, [], new Set(['entries']), 3000, ctx);
    const out = resources(withoutEither);
    expect(out.has('standings')).toBe(false);
    expect(out.has('races/1')).toBe(false);
    expect(out.has('competitors')).toBe(true);
  });

  it('serves a placeholder fleet page unranked', () => {
    const empty = { ...fleetData(), races: [], standings: fleetData().standings.map((s) => ({ ...s, raceScores: [], totalPoints: 0, netPoints: 0 })) };
    const state = applyPublish(null, [{ pageKey: 'cruisers', view: resultsPage(empty) }], new Set(['cruisers']), 1000, ctx);
    const row = standingsSchema.parse(resources(state).get('standings')).tables[0].rows[0];
    expect(row).toMatchObject({ rank: null, rankDisplay: '', total: null, totalDisplay: null });
  });
});
