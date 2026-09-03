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
  return fixture('03-f2-ilca-medal-race.yaml');
}

function fixture(file: string) {
  const fx = fixtures.find((f) => f.file === file);
  if (!fx) throw new Error(`fixture not found: ${file}`);
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

/**
 * What a championship exposes about the export's portable identities. Both
 * hold for an ordinary series by luck rather than by design — one fleet per
 * name, one entry list per race — and a championship is where that runs out.
 */
describe('public export — a championship\'s identities', () => {
  it('keeps two rounds\' fleets of the same name apart', async () => {
    // A reassignment championship mints a fresh Yellow and Blue each round.
    const data = fixture('10-reassignment.yaml');
    const names = data.fleets.map((f) => f.name);
    expect(new Set(names).size).toBeLessThan(names.length);

    const out = exportOf(data);
    // Each fleet is named once in the export, and one whose name had to be
    // suffixed says what the scorer actually calls it.
    const exportedNames = out.fleets.map((f) => f.name);
    expect(new Set(exportedNames).size).toBe(exportedNames.length);
    expect(out.fleets.filter((f) => f.label).map((f) => f.label)).toEqual(
      names.filter((n, i) => names.indexOf(n) !== i),
    );

    const { repos, fleets, read } = makeRecordingRepos();
    await importPublicExport(out, repos);
    // The fleets come back under their real names, one per source fleet, and
    // each round still names its own.
    expect(fleets.map((f) => f.name)).toEqual(names);
    const roundFleetIds = read()!.rounds.flatMap((r) => r.fleetIds);
    expect(new Set(roundFleetIds).size).toBe(roundFleetIds.length);
  });

  it('invents no DNC for a boat who was never in the race', () => {
    const data = championship();
    const out = exportOf(data);
    // A championship's absentees are the reading engine's to materialise: it
    // is the half that knows a boat away in the medal fleet is absent from
    // her old fleet's last race rather than scored for missing it.
    expect(out.races.reduce((n, r) => n + r.finishes.length, 0)).toBe(data.finishes.length);

    const medalRound = data.rounds.find((r) => r.stage === 'medal')!;
    const medalSails = data.competitors
      .filter((c) => c.fleetIds.some((id) => medalRound.fleetIds.includes(id)))
      .map((c) => c.sailNumber);
    expect(medalSails.length).toBeGreaterThan(0);

    const companionStart = data.raceStarts.find(
      (rs) => rs.stage === 'final' && rs.stageRaceNumber === 2,
    )!;
    const companionNumber = data.races.find((r) => r.id === companionStart.raceId)!.raceNumber;
    const companion = out.races.find((r) => r.raceNumber === companionNumber)!;
    for (const sail of medalSails) {
      expect(companion.finishes.some((f) => f.sailNumber === sail)).toBe(false);
    }
  });
});
