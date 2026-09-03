/**
 * The split-fleet block in the public JSON export: a championship's config
 * and assignment rounds travel with its published data file, on the export's
 * portable identities, and come back resolved onto freshly minted ids.
 *
 * Without them a re-import lands a series with stage-tagged starts, no rounds
 * and no config — which is a championship whose standings cannot be rebuilt.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
  buildPublicExportFromSnapshot,
  importPublicExport,
  type ImportRepos,
  type PublicSeriesExport,
} from '@/lib/public-export';
import type { SeriesSnapshot } from '@/lib/series-snapshot';
import type { SeriesFileSplitRound } from '@/lib/series-file';
import type { Competitor, Fleet, Series } from '@/lib/types';
import type { SplitFleetConfig } from '@/lib/split-fleets';
import { buildSplitFleetData, loadSplitFleetFixtures } from './fixtures/scoring/split-fleets/loader';

const fixtures = loadSplitFleetFixtures(join(__dirname, 'fixtures/scoring/split-fleets'));

/** The medal fixture: all three stages, so every round shape travels. */
function championship() {
  const fx = fixtures.find((f) => f.file === '03-f2-ilca-medal-race.yaml');
  if (!fx) throw new Error('medal-race fixture not found');
  return buildSplitFleetData(fx.fixture);
}

function makeSeries(): Series {
  return {
    id: 's',
    name: 'Worlds',
    venue: 'Dun Laoghaire',
    startDate: '2026-08-23',
    endDate: '2026-08-30',
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
}

function snapshotOf(data: ReturnType<typeof championship>): SeriesSnapshot {
  return {
    series: makeSeries(),
    competitors: data.competitors,
    fleets: data.fleets,
    races: data.races,
    subSeries: [],
    finishes: data.finishes,
    raceStarts: data.raceStarts,
    ratingOverrides: [],
  };
}

function exportOf(
  data: ReturnType<typeof championship>,
  splitFleets?: { config: SplitFleetConfig; rounds: typeof data.rounds } | null,
): PublicSeriesExport {
  const out = buildPublicExportFromSnapshot(snapshotOf(data), {
    splitFleets: splitFleets === undefined ? { config: data.config, rounds: data.rounds } : splitFleets,
  });
  if (!out) throw new Error('export built nothing');
  return out;
}

/** Recording repos wide enough for the import, capturing the split write. */
function makeRecordingRepos() {
  const fleets: Fleet[] = [];
  const competitors: Competitor[] = [];
  let split: { config: SplitFleetConfig | null; rounds: SeriesFileSplitRound[] } | null = null;
  const repos = {
    seriesRepo: { save: async (s: Series) => s },
    fleetRepo: { save: async (f: Fleet) => { fleets.push(f); return f; }, saveMany: async (l: Fleet[]) => { fleets.push(...l); } },
    competitorRepo: {
      save: async (c: Competitor) => { competitors.push(c); return c; },
      saveMany: async (l: Competitor[]) => { competitors.push(...l); },
    },
    raceRepo: { save: async (r: unknown) => r },
    subSeriesRepo: { saveMany: async () => {} },
    raceStartRepo: { save: async (s: unknown) => s, saveMany: async () => {} },
    finishRepo: { saveMany: async () => {} },
    listSeriesNames: async () => [],
    splitFleets: {
      get: async () => null,
      replace: async (
        _seriesId: string,
        payload: { config: SplitFleetConfig | null; rounds: SeriesFileSplitRound[] },
      ) => { split = payload; },
    },
  } as unknown as ImportRepos;
  return { repos, fleets, competitors, read: () => split };
}

describe('public export — the split-fleet block', () => {
  it('carries the config and every round, keyed by fleet name', () => {
    const data = championship();
    const out = exportOf(data);
    expect(out.splitFleets).toBeDefined();
    expect(out.splitFleets!.config).toEqual(data.config);
    expect(out.splitFleets!.rounds).toHaveLength(data.rounds.length);

    const fleetNameById = new Map(data.fleets.map((f) => [f.id, f.name]));
    out.splitFleets!.rounds.forEach((round, i) => {
      const source = data.rounds[i];
      expect(round.stage).toBe(source.stage);
      expect(round.fromStageRace).toBe(source.fromStageRace);
      expect(round.createdAt).toBe(source.createdAt);
      expect(round.fleetNames).toEqual(source.fleetIds.map((id) => fleetNameById.get(id)));
      // No id and no seriesId: the round's identity is the importer's to mint.
      expect(round).not.toHaveProperty('id');
      expect(round).not.toHaveProperty('seriesId');
    });
    // All three stages travel, not just the qualifying rounds.
    expect(new Set(out.splitFleets!.rounds.map((r) => r.stage))).toEqual(
      new Set(['qualifying', 'final', 'medal']),
    );
  });

  it('rewrites a hand placement as sail number → fleet name', () => {
    const data = championship();
    const round = data.rounds.find((r) => r.stage === 'final')!;
    const boat = data.competitors[0];
    const fleetId = round.fleetIds[round.fleetIds.length - 1];
    const withOverride = {
      config: data.config,
      rounds: data.rounds.map((r) =>
        r === round ? { ...r, overrides: { [boat.id]: fleetId } } : r,
      ),
    };
    const out = exportOf(data, withOverride);
    const exported = out.splitFleets!.rounds.find((r) => r.overrides);
    expect(exported!.overrides).toEqual({
      [boat.sailNumber]: data.fleets.find((f) => f.id === fleetId)!.name,
    });
  });

  it('is absent on an ordinary series, and on a championship that has dealt no round', () => {
    const data = championship();
    expect(exportOf(data, null).splitFleets).toBeUndefined();
    expect(exportOf(data, { config: data.config, rounds: [] }).splitFleets).toBeUndefined();
  });
});

describe('public export — importing the split-fleet block', () => {
  it('replays the config and resolves each round onto the new fleet ids', async () => {
    const data = championship();
    const out = exportOf(data);
    const { repos, fleets, read } = makeRecordingRepos();
    await importPublicExport(out, repos);

    const written = read();
    expect(written).not.toBeNull();
    expect(written!.config).toEqual(data.config);
    expect(written!.rounds).toHaveLength(data.rounds.length);

    const fleetIdByName = new Map(fleets.map((f) => [f.name, f.id]));
    const sourceNames = new Map(data.fleets.map((f) => [f.id, f.name]));
    written!.rounds.forEach((round, i) => {
      // Fresh ids, resolving to the fleets this import just minted.
      expect(round.id).not.toBe(data.rounds[i].id);
      expect(round.fleetIds).toEqual(
        data.rounds[i].fleetIds.map((id) => fleetIdByName.get(sourceNames.get(id)!)),
      );
      expect(round.fleetIds.every((id) => fleets.some((f) => f.id === id))).toBe(true);
      expect(round.createdAt).toBe(data.rounds[i].createdAt);
    });
  });

  it('resolves a hand placement back to the new competitor and fleet ids', async () => {
    const data = championship();
    const round = data.rounds.find((r) => r.stage === 'final')!;
    const boat = data.competitors[0];
    const fleetId = round.fleetIds[round.fleetIds.length - 1];
    const out = exportOf(data, {
      config: data.config,
      rounds: data.rounds.map((r) =>
        r === round ? { ...r, overrides: { [boat.id]: fleetId } } : r,
      ),
    });

    const { repos, fleets, competitors, read } = makeRecordingRepos();
    await importPublicExport(out, repos);

    const written = read()!.rounds.find((r) => r.overrides)!;
    const newBoat = competitors.find((c) => c.sailNumber === boat.sailNumber)!;
    const newFleet = fleets.find((f) => f.name === data.fleets.find((x) => x.id === fleetId)!.name)!;
    expect(written.overrides).toEqual({ [newBoat.id]: newFleet.id });
  });

  it('leaves a bundle with no split writer alone rather than failing the import', async () => {
    const data = championship();
    const out = exportOf(data);
    const { repos } = makeRecordingRepos();
    const readOnly = { ...repos, splitFleets: { get: async () => null } } as unknown as ImportRepos;
    await expect(importPublicExport(out, readOnly)).resolves.toBeTypeOf('string');
  });
});
