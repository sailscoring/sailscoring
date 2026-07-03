/**
 * Version-guarded structural sharing for row caches.
 *
 * React Query applies query results last-resolve-wins: a refetch dispatched
 * before a save can resolve after the save's `onSuccess` and overwrite the
 * fresh row with the pre-save snapshot, silently reverting any UI state
 * mirrored from the cache. The guards reject a row whose `version` is lower
 * than the cached one. The QueryObserver tests drive the real query pipeline
 * (no React render needed) to pin the race end-to-end.
 */
import { describe, expect, test } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';

import {
  keepNewerVersionedRow,
  keepNewerVersionedRows,
} from '@/hooks/query-version-guard';

const row = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id,
  version,
  ...extra,
});

describe('keepNewerVersionedRow', () => {
  test('rejects a lower-version snapshot of the same row', () => {
    const cached = row('a', 5, { name: 'fresh' });
    expect(keepNewerVersionedRow(cached, row('a', 4, { name: 'stale' }))).toBe(cached);
  });

  test('accepts an equal or higher version', () => {
    const cached = row('a', 5, { name: 'old' });
    expect(keepNewerVersionedRow(cached, row('a', 5, { name: 'old' }))).toEqual(row('a', 5, { name: 'old' }));
    expect(keepNewerVersionedRow(cached, row('a', 6, { name: 'new' }))).toEqual(row('a', 6, { name: 'new' }));
  });

  test('a different id is not a snapshot of the cached row', () => {
    const incoming = row('b', 1);
    expect(keepNewerVersionedRow(row('a', 5), incoming)).toEqual(incoming);
  });

  test('rows without a numeric version pass through', () => {
    const incoming = { id: 'a' };
    expect(keepNewerVersionedRow(row('a', 5), incoming)).toEqual(incoming);
    expect(keepNewerVersionedRow({ id: 'a' }, row('a', 1))).toEqual(row('a', 1));
  });

  test('null and undefined pass through (deleted row, first load)', () => {
    expect(keepNewerVersionedRow(row('a', 5), null)).toBeNull();
    expect(keepNewerVersionedRow(undefined, row('a', 1))).toEqual(row('a', 1));
  });

  test('deep-equal data keeps the cached reference (default structural sharing)', () => {
    const cached = row('a', 5, { nested: { x: 1 } });
    expect(keepNewerVersionedRow(cached, row('a', 5, { nested: { x: 1 } }))).toBe(cached);
  });
});

describe('keepNewerVersionedRows', () => {
  test('swaps stale snapshots for cached rows, per row', () => {
    const cachedFresh = row('a', 3, { name: 'fresh' });
    const cached = [cachedFresh, row('b', 1, { name: 'old-b' })];
    const incoming = [row('a', 2, { name: 'stale' }), row('b', 2, { name: 'new-b' })];
    expect(keepNewerVersionedRows(cached, incoming)).toEqual([
      cachedFresh,
      row('b', 2, { name: 'new-b' }),
    ]);
  });

  test('the incoming list decides membership and order', () => {
    const cached = [row('a', 1), row('b', 1)];
    const incoming = [row('c', 1), row('a', 1)];
    expect(keepNewerVersionedRows(cached, incoming)).toEqual(incoming);
  });

  test('non-array data passes through', () => {
    expect(keepNewerVersionedRows(undefined, [row('a', 1)])).toEqual([row('a', 1)]);
  });
});

describe('stale refetch racing a save (QueryObserver pipeline)', () => {
  const key = ['series', 'detail', 'race-test'];

  /** Mount an observer whose queryFn we resolve by hand. */
  function mountRacingQuery(qc: QueryClient, guarded: boolean) {
    let resolveFetch!: (value: unknown) => void;
    const observer = new QueryObserver(qc, {
      queryKey: key,
      queryFn: () => new Promise((resolve) => { resolveFetch = resolve; }),
      staleTime: 0,
      ...(guarded ? { structuralSharing: keepNewerVersionedRow } : {}),
    });
    const unsubscribe = observer.subscribe(() => {});
    return { resolveFetch: (v: unknown) => resolveFetch(v), unsubscribe };
  }

  test('without the guard, the pre-save snapshot overwrites the saved row', async () => {
    const qc = new QueryClient();
    qc.setQueryData(key, row('s1', 1, { name: 'pre-save' }));
    const { resolveFetch, unsubscribe } = mountRacingQuery(qc, false);

    // The save lands while the refetch is still in flight…
    qc.setQueryData(key, row('s1', 2, { name: 'saved' }));
    // …then the refetch resolves with the row it read before the save.
    resolveFetch(row('s1', 1, { name: 'pre-save' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(qc.getQueryData(key)).toEqual(row('s1', 1, { name: 'pre-save' }));
    unsubscribe();
    qc.clear();
  });

  test('with the guard, the saved row survives the stale refetch', async () => {
    const qc = new QueryClient();
    qc.setQueryData(key, row('s1', 1, { name: 'pre-save' }));
    const { resolveFetch, unsubscribe } = mountRacingQuery(qc, true);

    qc.setQueryData(key, row('s1', 2, { name: 'saved' }));
    resolveFetch(row('s1', 1, { name: 'pre-save' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(qc.getQueryData(key)).toEqual(row('s1', 2, { name: 'saved' }));
    unsubscribe();
    qc.clear();
  });
});
