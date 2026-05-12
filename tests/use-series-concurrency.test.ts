/**
 * Regression test for the rapid-double-click 409 reported in
 * https://github.com/sailscoring/sailscoring/issues — two `mutateAsync` calls
 * fired before the first resolves both read the same `version` from the
 * React Query cache, so the second sends a stale `If-Match` and 409s.
 *
 * The fix is `scope: { id: 'series' }` on the mutation: TanStack Query
 * pauses same-scope mutations until the previous one settles, so the second
 * mutationFn reads the post-onSuccess version. We mirror the
 * `useUpdateSeries` config here against `MutationObserver` so the test
 * doesn't need a React render — `MutationObserver` is the same object
 * `useMutation` ends up driving.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/query-keys';
import { ConflictApiError } from '@/lib/api-client';
import type { SaveOpts, SeriesRepository } from '@/lib/repository';
import type { Series } from '@/lib/types';

const baseSeries: Series = {
  id: 'a1b2c3d4-1111-4222-8333-444444444444',
  name: 'Test',
  venue: '',
  startDate: '',
  endDate: '',
  venueLogoUrl: '',
  eventLogoUrl: '',
  createdAt: 0,
  lastSnapshotId: null,
  lastSavedAt: null,
  lastModifiedAt: 0,
  snapshotHistory: [],
  scoringMode: 'scratch',
  discardThresholds: [{ minRaces: 5, discardCount: 1 }],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  ftpPaths: {},
  bilgeBundle: null,
  includeJsonExport: true,
  publishRatingCalculations: true,
  enabledCompetitorFields: [],
  primaryPersonLabel: 'competitor',
  version: 0,
};

/** Server-shaped fake — bumps version on every accepted save and rejects
 *  stale `expectedVersion` with the same error the real api-client throws. */
function makeRepo(initial: Series): { repo: SeriesRepository; current: () => Series } {
  let current: Series = { ...initial };
  const repo: SeriesRepository = {
    list: async () => [current],
    get: async (id) => (id === current.id ? { ...current } : undefined),
    save: async (s, opts?: SaveOpts) => {
      if (opts?.expectedVersion !== undefined && opts.expectedVersion !== (current.version ?? 0)) {
        throw new ConflictApiError({
          currentVersion: current.version,
          expectedVersion: opts.expectedVersion,
        });
      }
      current = { ...s, version: (current.version ?? 0) + 1 };
      return { ...current };
    },
    delete: async () => {},
    touch: async () => {},
  };
  return { repo, current: () => current };
}

/** Mirrors the mutation config in hooks/use-series.ts useUpdateSeries.
 *  `scope` is the only knob we toggle to demonstrate the race vs the fix. */
function buildOptions(
  qc: QueryClient,
  repo: SeriesRepository,
  scope?: { id: string },
) {
  return {
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Series> }) => {
      const cached = qc.getQueryData<Series | null>(queryKeys.series.detail(id));
      const current = cached ?? (await repo.get(id)) ?? null;
      if (!current) throw new Error(`series ${id} not found`);
      return repo.save({ ...current, ...patch }, { expectedVersion: current.version });
    },
    onSuccess: (saved: Series) => {
      qc.setQueryData(queryKeys.series.detail(saved.id), saved);
    },
    ...(scope ? { scope } : {}),
  };
}

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(queryKeys.series.detail(baseSeries.id), { ...baseSeries });
});

afterEach(() => {
  qc.clear();
});

describe('useUpdateSeries scope serialization', () => {
  test('without scope, two parallel mutates send the same expectedVersion → second 409s', async () => {
    const { repo } = makeRepo(baseSeries);
    const saveSpy = vi.spyOn(repo, 'save');
    const observer = new MutationObserver(qc, buildOptions(qc, repo /* no scope */));

    const results = await Promise.allSettled([
      observer.mutate({ id: baseSeries.id, patch: { discardThresholds: [{ minRaces: 6, discardCount: 1 }] } }),
      observer.mutate({ id: baseSeries.id, patch: { discardThresholds: [{ minRaces: 7, discardCount: 1 }] } }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictApiError);

    // Both saves were attempted with expectedVersion === 0 — the smoking gun.
    const versions = saveSpy.mock.calls.map((call) => call[1]?.expectedVersion);
    expect(versions).toEqual([0, 0]);
  });

  test('with scope: { id: "series" }, the second mutate sees the cache update and both succeed', async () => {
    const { repo, current } = makeRepo(baseSeries);
    const saveSpy = vi.spyOn(repo, 'save');
    const observer = new MutationObserver(qc, buildOptions(qc, repo, { id: 'series' }));

    const results = await Promise.allSettled([
      observer.mutate({ id: baseSeries.id, patch: { discardThresholds: [{ minRaces: 6, discardCount: 1 }] } }),
      observer.mutate({ id: baseSeries.id, patch: { discardThresholds: [{ minRaces: 7, discardCount: 1 }] } }),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    // The second mutate should have read version 1 (post-onSuccess), not 0.
    const versions = saveSpy.mock.calls.map((call) => call[1]?.expectedVersion);
    expect(versions).toEqual([0, 1]);

    // Final state reflects the second click — both increments stuck.
    expect(current().discardThresholds).toEqual([{ minRaces: 7, discardCount: 1 }]);
    expect(current().version).toBe(2);
  });
});
