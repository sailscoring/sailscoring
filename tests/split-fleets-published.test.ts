/**
 * Golden tests: the three championships scored with split fleets, as they
 * were published. Each one's published data file is imported, its standings
 * page is rendered again through the publish build, and every table must
 * match the published page cell for cell.
 *
 * These are the safety net for rebuilding the split-fleet configuration: a
 * change to the engine, the config model or the upgrade path that alters a
 * published result fails here, against real events rather than constructed
 * fixtures. Where a change is meant to alter one of them (a relabel), the test
 * should say so explicitly rather than having the expectation refreshed.
 *
 * The fixtures and how they were captured: `fixtures/split-fleets-published/`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  importPublicExport,
  parsePublicExport,
  type ExportRepos,
  type ImportRepos,
} from '@/lib/public-export';
import { buildFleetHtmlFiles } from '@/lib/results-export';
import type { SeriesFileSplitRound } from '@/lib/series-file';
import type { SplitFleetConfig } from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series, SubSeries } from '@/lib/types';

const DIR = join(__dirname, 'fixtures/split-fleets-published');

const EVENTS = ['junior-champions-cup-2026', 'ilca7-men-worlds-2026', 'ilca6-women-worlds-2026'];

interface Table {
  header: string[];
  rows: Record<string, string>[];
}

/** In-memory repos: an import writes into them, the publish build reads back. */
function makeStore() {
  let series: Series | null = null;
  const fleets: Fleet[] = [];
  const competitors: Competitor[] = [];
  const races: Race[] = [];
  const raceStarts: RaceStart[] = [];
  const finishes: Finish[] = [];
  const subSeries: SubSeries[] = [];
  let split: { config: SplitFleetConfig | null; rounds: SeriesFileSplitRound[] } | null = null;

  const importRepos = {
    seriesRepo: { save: async (s: Series) => (series = s) },
    fleetRepo: { save: async (f: Fleet) => (fleets.push(f), f) },
    competitorRepo: { save: async (c: Competitor) => (competitors.push(c), c) },
    raceRepo: { save: async (r: Race) => (races.push(r), r) },
    raceStartRepo: { save: async (s: RaceStart) => (raceStarts.push(s), s) },
    finishRepo: { saveMany: async (l: Finish[]) => void finishes.push(...l) },
    subSeriesRepo: { saveMany: async (l: SubSeries[]) => void subSeries.push(...l) },
    listSeriesNames: async () => [],
    splitFleets: {
      get: async () => null,
      replace: async (_id: string, data: typeof split) => void (split = data),
    },
  } as unknown as ImportRepos;

  const exportRepos = {
    seriesRepo: { get: async () => series ?? undefined },
    competitorRepo: { listBySeries: async () => competitors },
    raceRepo: { listBySeries: async () => races },
    fleetRepo: { listBySeries: async () => fleets },
    subSeriesRepo: { listBySeries: async () => subSeries },
    finishRepo: { listBySeries: async () => finishes },
    raceStartRepo: { listBySeries: async () => raceStarts },
    raceRatingOverrideRepo: { listBySeries: async () => [] },
    splitFleets: {
      get: async () => (split?.config ? { config: split.config, rounds: split.rounds } : null),
    },
  } as unknown as ExportRepos;

  return { importRepos, exportRepos };
}

const text = (fragment: string) =>
  fragment
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();

/**
 * The standings tables of a results page, header by header and row by row, as
 * a reader sees them. The published fixtures were extracted with the same
 * reading, so both sides are compared as text.
 */
function standingsTables(html: string): Table[] {
  const page = html.replace(/<svg[\s\S]*?<\/svg>/g, '');
  return [...page.matchAll(/<table class="summarytable">([\s\S]*?)<\/table>/g)].map(([, t]) => {
    const header = [...t.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(([, h]) => text(h));
    const rows = [...t.matchAll(/<tr class="[^"]*summaryrow[^"]*">([\s\S]*?)<\/tr>/g)].map(
      ([, tr]) => {
        const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(([, td]) => text(td));
        return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
      },
    );
    return { header, rows };
  });
}

/**
 * What has changed on purpose since an event was published, applied to the
 * expectation rather than written into the captured page.
 *
 * The 2026 ILCA 7 Men's Worlds numbered its Preliminary and Elimination series
 * races Q1–Q12 straight through. Race labels are now fixed by the wording a
 * championship uses, and under the 2026 ILCA wording they are QP, QE and F:
 * its five Preliminary races are QP1–QP5, and Q6–Q12 are QE1–QE7.
 */
const CHANGED_SINCE_PUBLISHED: Record<string, (tables: Table[]) => Table[]> = {
  'ilca7-men-worlds-2026': (tables) => {
    const PRELIMINARY_RACES = 5;
    const relabel = (h: string) => {
      const n = /^Q(\d+)$/.exec(h)?.[1];
      if (!n) return h;
      return Number(n) <= PRELIMINARY_RACES ? `QP${n}` : `QE${Number(n) - PRELIMINARY_RACES}`;
    };
    return tables.map(({ header, rows }) => ({
      header: header.map(relabel),
      rows: rows.map((row) =>
        Object.fromEntries(Object.entries(row).map(([h, cell]) => [relabel(h), cell])),
      ),
    }));
  },
};

describe.each(EVENTS)('%s, as published', (event) => {
  it('renders the published standings, cell for cell', async () => {
    const published = parsePublicExport(
      readFileSync(join(DIR, `${event}.sailscoring.json`), 'utf-8'),
    );
    const captured: Table[] = JSON.parse(
      readFileSync(join(DIR, `${event}.standings.json`), 'utf-8'),
    );
    const expected = (CHANGED_SINCE_PUBLISHED[event] ?? ((t) => t))(captured);

    const store = makeStore();
    const seriesId = await importPublicExport(published, store.importRepos);
    const build = await buildFleetHtmlFiles(store.exportRepos, seriesId);
    const page = build?.files.find((f) => standingsTables(f.html).length > 0);
    expect(page).toBeDefined();

    expect(standingsTables(page!.html)).toEqual(expected);
  });
});
