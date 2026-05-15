'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import * as dexie from '@/lib/dexie-repository';
import * as repos from '@/lib/api-repository';
import { buildSeriesFile, openSeriesFromFile } from '@/lib/series-file';
import { queryKeys } from '@/hooks/query-keys';
import { Button } from '@/components/ui/button';
import type { Series } from '@/lib/types';

// Idempotency is tracked client-side: the wizard remaps source IDs to
// fresh UUIDs server-side (see openSeriesFromFile), so re-running would
// otherwise duplicate. ADR-008 Phase 5 chose Option A over plumbing
// skip-if-exists through the API — clearing storage and re-migrating
// produces dupes, which beta-sized data tolerates.
const STORAGE_KEY = 'sailscoring.migrated-series-ids';

function readMigrated(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as unknown;
    return Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeMigrated(ids: Set<string>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

type Status =
  | { step: 'loading' }
  | { step: 'idle'; pending: Series[] }
  | { step: 'migrating'; pending: Series[]; done: number; failures: { name: string; message: string }[] }
  | { step: 'done'; failures: { name: string; message: string }[] }
  | { step: 'empty' };

export function MigrationBanner() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>({ step: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void dexie.seriesRepo.list().then((all) => {
      if (cancelled) return;
      const migrated = readMigrated();
      const pending = all.filter((s) => !migrated.has(s.id));
      setStatus(pending.length > 0 ? { step: 'idle', pending } : { step: 'empty' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleMigrate() {
    if (status.step !== 'idle') return;
    const pending = status.pending;
    const failures: { name: string; message: string }[] = [];
    setStatus({ step: 'migrating', pending, done: 0, failures });
    const migrated = readMigrated();

    for (let i = 0; i < pending.length; i++) {
      const series = pending[i];
      try {
        const file = await buildSeriesFile(series.id, dexie);
        await openSeriesFromFile(file, repos);
        migrated.add(series.id);
        writeMigrated(migrated);
      } catch (err) {
        failures.push({
          name: series.name,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
      setStatus({ step: 'migrating', pending, done: i + 1, failures: [...failures] });
    }

    await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
    setStatus({ step: 'done', failures });
  }

  if (status.step === 'loading' || status.step === 'empty') return null;

  if (status.step === 'done') {
    if (status.failures.length === 0) return null;
    return (
      <div className="border rounded-lg px-4 py-3 bg-destructive/5 text-sm">
        <div className="font-medium mb-1">Some series could not be migrated:</div>
        <ul className="list-disc pl-5 space-y-0.5">
          {status.failures.map((f, i) => (
            <li key={i}>
              <span className="font-medium">{f.name}:</span> {f.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="border rounded-lg px-4 py-3 bg-accent/40 flex items-center justify-between gap-4">
      <div className="text-sm">
        {status.step === 'idle' ? (
          <>
            {status.pending.length} series saved in this browser{' '}
            {status.pending.length === 1 ? 'has' : 'have'} not been moved to your account.
          </>
        ) : (
          <>
            Migrating… ({status.done}/{status.pending.length})
          </>
        )}
      </div>
      <Button onClick={handleMigrate} disabled={status.step === 'migrating'}>
        {status.step === 'migrating' ? 'Migrating…' : 'Move to my account'}
      </Button>
    </div>
  );
}
