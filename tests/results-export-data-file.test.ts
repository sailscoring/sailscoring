/**
 * Published pages reference the publication's data file instead of embedding
 * the payload (ADR-012): with `dataPath` set, "Open in Sail Scoring" becomes
 * an `/open?from=` reference, the footer links the `.sailscoring.json`
 * file, the head declares the JSON alternate, and the base64 payload is gone.
 * Without it (downloads, FTP of a never-published series) the page stays
 * self-contained, exactly as before.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { ExportRepos } from '@/lib/public-export';
import type { Competitor, Finish, Fleet, Race, Series } from '@/lib/types';

const SERIES: Series = {
  id: 's1',
  name: 'Test Cup',
  venue: 'HYC',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
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
  includeJsonExport: true,
  enabledCompetitorFields: [],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
};

const FLEET: Fleet = { id: 'f1', seriesId: 's1', name: 'Default', displayOrder: 0, scoringSystem: 'scratch' };

const COMPETITORS: Competitor[] = [
  { id: 'c1', seriesId: 's1', fleetIds: ['f1'], sailNumber: '101', names: ['Helm 101'], club: '', gender: '', age: null, createdAt: 0 },
  { id: 'c2', seriesId: 's1', fleetIds: ['f1'], sailNumber: '102', names: ['Helm 102'], club: '', gender: '', age: null, createdAt: 0 },
];

const RACES: Race[] = [
  { id: 'r1', seriesId: 's1', raceNumber: 1, name: null, date: '2026-06-06', createdAt: 0 },
];

const FINISHES: Finish[] = [
  { id: 'r1-c1', raceId: 'r1', competitorId: 'c1', sortOrder: 1, tiedWithPrevious: false, resultCode: null, startPresent: null, penaltyCode: null, penaltyOverride: null, redressMethod: null, redressExcludeRaceIds: null, redressIncludeRaceIds: null, redressIncludeAllLater: false, redressPoints: null },
];

function makeRepos(series: Series = SERIES): ExportRepos {
  return {
    seriesRepo: { get: async (id: string) => (id === 's1' ? series : undefined) },
    competitorRepo: { listBySeries: async () => COMPETITORS },
    raceRepo: { listBySeries: async () => RACES },
    fleetRepo: { listBySeries: async () => FLEETS_ONE },
    subSeriesRepo: { listBySeries: async () => [] },
    finishRepo: { listBySeries: async () => FINISHES },
    raceStartRepo: { listBySeries: async () => [] },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
  } as unknown as ExportRepos;
}
const FLEETS_ONE = [FLEET];

const DATA_PATH = '/p/hyc/2026/test-cup.sailscoring.json';

describe('buildFleetHtmlFiles — the data-file reference (ADR-012)', () => {
  let savedAppUrl: string | undefined;
  beforeAll(() => {
    savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example';
  });
  afterAll(() => {
    if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;
  });

  it('with dataPath, pages reference the data file and embed nothing', async () => {
    const build = (await buildFleetHtmlFiles(makeRepos(), 's1', undefined, { dataPath: DATA_PATH }))!;
    expect(build.exportJson).toBeTruthy();
    const html = build.files[0].html;
    expect(html).toContain(`/open?from=${encodeURIComponent(DATA_PATH)}`);
    expect(html).toContain('>Open in Sail Scoring</a>');
    expect(html).toContain(`<a href="https://app.example${DATA_PATH}" target="_top" rel="noopener">Data (.sailscoring.json)</a>`);
    expect(html).toContain(`<link rel="alternate" type="application/json" href="https://app.example${DATA_PATH}">`);
    expect(html).not.toContain('#data=');
  });

  it('without dataPath, pages stay self-contained with the embedded payload', async () => {
    const build = (await buildFleetHtmlFiles(makeRepos(), 's1'))!;
    expect(build.exportJson).toBeTruthy();
    const html = build.files[0].html;
    expect(html).toContain('/import#data=');
    expect(html).not.toContain('Data (.sailscoring.json)');
    expect(html).not.toContain('rel="alternate"');
  });

  it('a series opted out of the JSON export gets neither', async () => {
    const optedOut = { ...SERIES, includeJsonExport: false };
    const build = (await buildFleetHtmlFiles(makeRepos(optedOut), 's1', undefined, { dataPath: DATA_PATH }))!;
    expect(build.exportJson).toBeUndefined();
    const html = build.files[0].html;
    expect(html).not.toContain('Open in Sail Scoring');
    expect(html).not.toContain('Data (.sailscoring.json)');
    expect(html).not.toContain('#data=');
  });
});
