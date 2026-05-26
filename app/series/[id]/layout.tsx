'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useSeries, useArchiveSeries } from '@/hooks/use-series';
import { queryKeys } from '@/hooks/query-keys';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown, useChordShortcut } from '@/hooks/use-keyboard-shortcut';
import { KeyboardHelp } from '@/components/keyboard-help';
import { SeriesReadOnlyProvider } from '@/components/series-read-only';
import { Button } from '@/components/ui/button';
import * as repos from '@/lib/api-repository';
import { saveSeriesFile } from '@/lib/series-file';

const tabs = [
  { label: 'Competitors', href: (id: string) => `/series/${id}/competitors` },
  { label: 'Races', href: (id: string) => `/series/${id}/races` },
  { label: 'Standings', href: (id: string) => `/series/${id}/standings` },
  { label: 'Settings', href: (id: string) => `/series/${id}/settings` },
  { label: 'Activity', href: (id: string) => `/series/${id}/activity` },
];

export default function SeriesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: series, isLoading } = useSeries(id);
  const archiveSeries = useArchiveSeries();
  const [showHelp, setShowHelp] = useState(false);

  useChordShortcut({
    c: () => router.push(tabs[0].href(id)),
    r: () => router.push(tabs[1].href(id)),
    s: () => router.push(tabs[2].href(id)),
    t: () => router.push(tabs[3].href(id)),
    a: () => router.push(tabs[4].href(id)),
  });

  useGlobalKeyDown((e) => {
    if (e.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement?.tagName ?? '')
    )) {
      e.preventDefault();
      setShowHelp(true);
    } else if (e.ctrlKey && !e.metaKey && e.key === 's' && !/\/races\/[^/]+/.test(pathname)) {
      // Ctrl+S saves to file from any series page except finish entry (which owns Ctrl+S itself)
      e.preventDefault();
      saveSeriesFile(id, repos)
        .then(() =>
          queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(id) }),
        )
        .catch(console.error);
    }
  });

  if (isLoading || series === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (series === null) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

  const readOnly = series.archived ?? false;

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          {series.name}
          {readOnly && (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
              <Archive className="h-3 w-3" />
              Archived
            </span>
          )}
        </h1>
        {(series.venue || series.startDate) && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {[series.venue, series.startDate].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="text-amber-900 dark:text-amber-200">
            <strong>This series is archived and read-only.</strong> Unarchive it
            to make changes, or copy it to another workspace from Settings.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={archiveSeries.isPending}
            onClick={() => archiveSeries.mutate({ id, archived: false })}
          >
            <ArchiveRestore className="h-4 w-4" />
            Unarchive
          </Button>
        </div>
      )}

      <nav className="flex gap-1 border-b">
        {tabs.map((tab) => {
          const href = tab.href(id);
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab.label}
              href={href}
              className={cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <SeriesReadOnlyProvider readOnly={readOnly}>
        {children}
      </SeriesReadOnlyProvider>

      <KeyboardHelp open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
