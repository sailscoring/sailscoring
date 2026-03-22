'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import type { Series } from '@/lib/types';

function SeriesCard({ series }: { series: Series }) {
  return (
    <Link
      href={`/series/${series.id}/competitors`}
      className="block border rounded-lg px-5 py-4 hover:bg-accent transition-colors"
    >
      <div className="font-medium">{series.name}</div>
      {(series.venue || series.date) && (
        <div className="text-sm text-muted-foreground mt-0.5">
          {[series.venue, series.date].filter(Boolean).join(' · ')}
        </div>
      )}
    </Link>
  );
}

export default function HomePage() {
  const seriesList = useLiveQuery(() => seriesRepo.list(), []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Series</h1>
        <Button asChild>
          <Link href="/series/new">New series</Link>
        </Button>
      </div>

      {seriesList === undefined && (
        <p className="text-muted-foreground">Loading…</p>
      )}

      {seriesList !== undefined && seriesList.length === 0 && (
        <p className="text-muted-foreground">
          No series yet.{' '}
          <Link href="/series/new" className="underline">
            Create your first series
          </Link>{' '}
          to get started.
        </p>
      )}

      {seriesList !== undefined && seriesList.length > 0 && (
        <div className="space-y-2">
          {seriesList.map((s) => (
            <SeriesCard key={s.id} series={s} />
          ))}
        </div>
      )}
    </div>
  );
}
