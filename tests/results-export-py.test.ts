/**
 * A PY fleet's published race table prints each boat's Portsmouth Number
 * under "PY" — the number a dinghy sailor knows their boat by — not the
 * 1000/PY decimal the corrected time is worked from, which reads as an IRC
 * TCC. The published results API carries the same number under the same
 * label.
 */
import { describe, it, expect } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import { applyPublish, viewResources, type PublicationFacts, type ViewContext } from '@/lib/public-api/published-view';
import { raceSchema } from '@/lib/validation/public-api-v1';
import type { Competitor, Finish, Fleet, Race, RaceRatingOverride, RaceStart, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1', name: 'Frostbites', venue: 'Howth', startDate: '2026-11-01', endDate: '',
  venueLogoUrl: '', eventLogoUrl: '', venueUrl: '', eventUrl: '', createdAt: 0, lastSavedAt: null, lastModifiedAt: 0,
  scoringMode: 'handicap', discardThresholds: [], dnfScoring: 'seriesEntries', ftpHost: '', ftpPath: '', ftpPaths: {},
  includeJsonExport: false, enabledCompetitorFields: [], primaryPersonLabel: 'helm', subdivisionAxes: [],
};

const FLEETS: Fleet[] = [{ id: 'py', seriesId: 's1', name: 'PY Fleet', displayOrder: 0, scoringSystem: 'py' }];

const boat = (sail: string, pyNumber: number): Competitor => ({
  id: `c${sail}`, seriesId: 's1', fleetIds: ['py'], sailNumber: sail, names: [`Helm ${sail}`],
  clubs: [], gender: '', age: null, createdAt: 0, pyNumber,
});

// A Finn and an IDRA 14.
const COMPETITORS = [boat('6', 1049), boat('38', 1125)];
const RACES: Race[] = [1, 2].map((n) => ({ id: `r${n}`, seriesId: 's1', raceNumber: n, name: null, date: '2026-11-01', createdAt: 0 }));
const STARTS: RaceStart[] = RACES.map((r) => ({ id: `st-${r.id}`, raceId: r.id, fleetIds: ['py'], startTime: '11:00:00' }));

function finish(raceId: string, competitorId: string, sortOrder: number, finishTime: string): Finish {
  return {
    id: `${raceId}-${competitorId}`, raceId, competitorId, sortOrder, tiedWithPrevious: false, finishTime,
    resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null,
    redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null,
  };
}

const FINISHES: Finish[] = [
  finish('r1', 'c6', 1, '11:40:00'), finish('r1', 'c38', 2, '11:45:00'),
  finish('r2', 'c6', 1, '11:40:00'), finish('r2', 'c38', 2, '11:45:00'),
];

// The Finn sails race 2 on a PY the scorer entered for that race.
const OVERRIDES: RaceRatingOverride[] = [{ id: 'o1', raceId: 'r2', competitorId: 'c6', field: 'pyNumber', value: 1063 }];

const repos = {
  seriesRepo: { get: async (id: string) => (id === 's1' ? SERIES : undefined) },
  competitorRepo: { listBySeries: async () => COMPETITORS },
  raceRepo: { listBySeries: async () => RACES },
  fleetRepo: { listBySeries: async () => FLEETS },
  subSeriesRepo: { listBySeries: async () => [] },
  finishRepo: { listBySeries: async () => FINISHES },
  raceStartRepo: { listBySeries: async () => STARTS },
  raceRatingOverrideRepo: { listBySeries: async () => OVERRIDES },
} as unknown as ExportRepos;

function raceTable(html: string, n: number): string {
  const at = html.indexOf(`id="r${n}"`);
  return html.slice(at, html.indexOf('</table>', at));
}

function row(table: string, sail: string): string {
  const at = table.indexOf(`>${sail}<`);
  return table.slice(at, table.indexOf('</tr>', at));
}

describe('a PY fleet on the published page', () => {
  it('heads the rating column PY and prints the Portsmouth Number', async () => {
    const build = await buildFleetHtmlFiles(repos, 's1');
    const table = raceTable(build!.files[0].html, 1);
    expect(table).toContain('<th>PY</th>');
    expect(table).not.toContain('<th>TCC</th>');
    // 2400 s × 1000/1049 = 2288 s = 38:08; 2700 s × 1000/1125 = 2400 s = 40:00.
    expect(row(table, '6')).toMatch(/<td class="mono">40:00<\/td>\s*<td class="mono">1049<\/td>\s*<td class="mono">38:08<\/td>/);
    expect(row(table, '38')).toMatch(/<td class="mono">45:00<\/td>\s*<td class="mono">1125<\/td>\s*<td class="mono">40:00<\/td>/);
    expect(table).not.toContain('0.953');
  });

  it('prints a per-race override as the PY the scorer entered, marked', async () => {
    const build = await buildFleetHtmlFiles(repos, 's1');
    const finn = row(raceTable(build!.files[0].html, 2), '6');
    // 2400 s × 1000/1063 = 2257.8 → 2258 s = 37:38.
    expect(finn).toMatch(/<td class="mono">1063<span class="override-marker"[^>]*>\*<\/span><\/td>\s*<td class="mono">37:38<\/td>/);
  });

  it('carries the Portsmouth Number in the published results API, labelled PY', async () => {
    const build = await buildFleetHtmlFiles(repos, 's1');
    const api = 'https://app.example/api/public/v1/publications/pub-1';
    const ctx: ViewContext = { apiBase: api, competitor: (id) => ({ id: `pub-${id}` }) };
    const facts: PublicationFacts = {
      name: 'Frostbites', kind: 'series', status: 'provisional',
      workspace: { slug: 'hyc', name: 'Howth YC', url: 'https://app.example/p/hyc' },
      season: '2026', page: 'https://app.example/p/hyc/frostbites', data: null,
      publishedAt: '2026-11-01T12:00:00.000Z',
      fleets: [{ key: 'py-fleet', name: 'PY Fleet', scoringSystem: 'py' }],
    };
    const state = applyPublish(null, [{ pageKey: 'py', view: build!.files[0].view! }], new Set(['py']), Date.UTC(2026, 10, 1), ctx);
    const out = viewResources(state, { id: 'pub-1', facts }, 'Europe/Dublin', api);

    const race1 = raceSchema.parse(out.get('races/1'));
    expect(race1.fleets[0].ratingLabel).toBe('PY');
    expect(race1.fleets[0].results.map((r) => r.rating)).toEqual([1049, 1125]);
    expect(raceSchema.parse(out.get('races/2')).fleets[0].results[0].rating).toBe(1063);
  });
});
