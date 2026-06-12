/**
 * Concurrency regression tests for `useUpdateSeries`.
 *
 * 1. Rapid double-click 409: two `mutateAsync` calls fired before the first
 *    resolves both read the same `version` from the React Query cache, so
 *    the second sends a stale `If-Match` and 409s. The fix is
 *    `scope: { id: 'series' }`: TanStack Query pauses same-scope mutations
 *    until the previous one settles, so the second mutationFn reads the
 *    post-onSuccess version.
 *
 * 2. Lost update via read-prop-then-patch: a patch value computed at click
 *    time from a stale prop carries another field's old value and silently
 *    reverts an in-flight save. The fix is the functional-patch form,
 *    resolved inside the serialized mutationFn against the freshest row.
 *
 * The tests drive the real `updateSeriesMutationOptions` config through
 * `MutationObserver` — the same object `useMutation` ends up driving — so
 * no React render is needed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MutationObserver, QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/hooks/query-keys';
import { updateSeriesMutationOptions } from '@/hooks/use-series';
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
  venueUrl: '',
  eventUrl: '',
  createdAt: 0,
  lastSavedAt: null,
  lastModifiedAt: 0,
  scoringMode: 'scratch',
  discardThresholds: [{ minRaces: 5, discardCount: 1 }],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  ftpPaths: {},
  includeJsonExport: true,
  publishRatingCalculations: true,
  enabledCompetitorFields: [],
  primaryPersonLabel: 'competitor',
  subdivisionLabel: 'Division',
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
    reorder: async () => {},
  };
  return { repo, current: () => current };
}

/** The real `useUpdateSeries` config against a fake repo. `scope` is the
 *  only knob we toggle, to demonstrate the double-click race vs the fix. */
function buildOptions(
  qc: QueryClient,
  repo: SeriesRepository,
  { withScope = true }: { withScope?: boolean } = {},
) {
  const { scope, ...rest } = updateSeriesMutationOptions(qc, repo);
  return withScope ? { scope, ...rest } : rest;
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
  test('without scope, two parallel mutates send the same expectedVersion → second 409s and burns a retry', async () => {
    const { repo, current } = makeRepo(baseSeries);
    const saveSpy = vi.spyOn(repo, 'save');
    const observer = new MutationObserver(qc, buildOptions(qc, repo, { withScope: false }));

    const results = await Promise.allSettled([
      observer.mutate({ id: baseSeries.id, patch: { discardThresholds: [{ minRaces: 6, discardCount: 1 }] } }),
      observer.mutate({ id: baseSeries.id, patch: { discardThresholds: [{ minRaces: 7, discardCount: 1 }] } }),
    ]);

    // The conflict-retry path heals the 409, so both fulfil — but the
    // smoking gun is that both first attempts read expectedVersion 0, and
    // the second needed an extra re-read + resend round-trip.
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const versions = saveSpy.mock.calls.map((call) => call[1]?.expectedVersion);
    expect(versions).toEqual([0, 0, 1]);
    expect(current().version).toBe(2);
  });

  test('with scope: { id: "series" }, the second mutate sees the cache update and both succeed', async () => {
    const { repo, current } = makeRepo(baseSeries);
    const saveSpy = vi.spyOn(repo, 'save');
    const observer = new MutationObserver(qc, buildOptions(qc, repo));

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

describe('useUpdateSeries functional patches', () => {
  test('a queued functional patch derives from the prior save, not stale state', async () => {
    const start = { ...baseSeries, enabledCompetitorFields: ['boatName' as const] };
    const { repo, current } = makeRepo(start);
    qc.setQueryData(queryKeys.series.detail(start.id), { ...start });
    const observer = new MutationObserver(qc, buildOptions(qc, repo));

    // A value patch computed at click time from the same starting state
    // would be ['boatName', 'crewName'] — resurrecting the field save A is
    // removing. The functional form runs after A's onSuccess and sees the
    // post-A list.
    await Promise.all([
      observer.mutate({ id: start.id, patch: { enabledCompetitorFields: [] } }),
      observer.mutate({
        id: start.id,
        patch: (s) => ({ enabledCompetitorFields: [...(s.enabledCompetitorFields ?? []), 'crewName'] }),
      }),
    ]);

    expect(current().enabledCompetitorFields).toEqual(['crewName']);
  });

  test('on a 409 retry the functional patch is re-derived from the re-read row', async () => {
    // The server moved on (version 1, fields ['helm']) but the cache still
    // holds the version-0 row with ['boatName'].
    const stale = { ...baseSeries, enabledCompetitorFields: ['boatName' as const] };
    const { repo, current } = makeRepo({
      ...baseSeries,
      enabledCompetitorFields: ['helm'],
      version: 1,
    });
    const saveSpy = vi.spyOn(repo, 'save');
    qc.setQueryData(queryKeys.series.detail(stale.id), { ...stale });
    const observer = new MutationObserver(qc, buildOptions(qc, repo));

    await observer.mutate({
      id: stale.id,
      patch: (s) => ({ enabledCompetitorFields: [...(s.enabledCompetitorFields ?? []), 'crewName'] }),
    });

    // First attempt sent the stale version and 409ed; the retry re-read the
    // row and re-applied the function to it — not to the stale cache.
    const versions = saveSpy.mock.calls.map((call) => call[1]?.expectedVersion);
    expect(versions).toEqual([0, 1]);
    expect(current().enabledCompetitorFields).toEqual(['helm', 'crewName']);
    expect(current().version).toBe(2);
  });
});
