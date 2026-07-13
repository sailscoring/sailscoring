'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useSeries, useArchiveSeries } from '@/hooks/use-series';
import { cn } from '@/lib/utils';
import { useChordShortcut, useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { usePublicationStatus } from '@/hooks/use-published';
import { KeyboardHelp } from '@/components/keyboard-help';
import { SeriesActionsMenu } from '@/components/series-actions-menu';
import { SeriesReadOnlyProvider } from '@/components/series-read-only';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useFeatures } from '@/components/features-provider';
import { Button } from '@/components/ui/button';
import { SeriesTabFallback } from '@/components/series-tab-fallback';

const baseTabs = [
  { label: 'Competitors', href: (id: string) => `/series/${id}/competitors` },
  { label: 'Races', href: (id: string) => `/series/${id}/races` },
  { label: 'Standings', href: (id: string) => `/series/${id}/standings` },
  { label: 'Settings', href: (id: string) => `/series/${id}/settings` },
  { label: 'History', href: (id: string) => `/series/${id}/history` },
];

const prizesTab = { label: 'Prizes', href: (id: string) => `/series/${id}/prizes` };

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
  const { data: series, isLoading } = useSeries(id);
  const archiveSeries = useArchiveSeries();
  const { can } = useWorkspacePermissions();
  const { has } = useFeatures();
  const [showHelp, setShowHelp] = useState(false);

  const showPrizes = has('prizes');
  const asPublished = series?.asPublished ?? false;
  // Prizes slots in after Standings — allocation reads the standings, so the
  // tabs follow the scorer's flow. An as-published archive (ADR-010) keeps
  // Competitors and Standings (the stored tables); races, prizes, settings,
  // and history have nothing behind them in this regime.
  const tabs = asPublished
    ? [baseTabs[0], baseTabs[2]]
    : showPrizes
      ? [...baseTabs.slice(0, 3), prizesTab, ...baseTabs.slice(3)]
      : baseTabs;

  useChordShortcut({
    c: () => router.push(`/series/${id}/competitors`),
    r: () => router.push(`/series/${id}/races`),
    s: () => router.push(`/series/${id}/standings`),
    t: () => router.push(`/series/${id}/settings`),
    h: () => router.push(`/series/${id}/history`),
    ...(showPrizes ? { p: () => router.push(`/series/${id}/prizes`) } : {}),
  });

  // No description: the dialog's static Global section documents `?` itself.
  // (Ctrl+S save-to-file is bound by SeriesActionsMenu below.)
  useShortcuts([{ key: '?', handler: () => setShowHelp(true) }]);

  if (isLoading || series === undefined) {
    return <SeriesTabFallback status="loading" />;
  }

  if (series === null) {
    return <SeriesTabFallback status="missing" />;
  }

  const readOnly = (series.archived ?? false) || (series.asPublished ?? false);

  return (
    <div className="space-y-6 max-w-screen-2xl mx-auto">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {series.name}
            {series.asPublished && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
                As published
              </span>
            )}
            {readOnly && !series.asPublished && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
                <Archive className="h-3 w-3" />
                Archived
              </span>
            )}
          </h1>
          <SeriesActionsMenu series={series} />
        </div>
        {(series.venue || series.startDate) && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {[series.venue, series.startDate].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {series.asPublished ? (
        <AsPublishedNotice seriesId={series.id} />
      ) : readOnly && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
          <p className="text-amber-900 dark:text-amber-200">
            <strong>This series is archived and read-only.</strong> Unarchive it
            to make changes, or copy it to another workspace from the ⋯ menu.
          </p>
          {can('manage-series') && (
            <Button
              size="sm"
              variant="outline"
              disabled={archiveSeries.isPending}
              onClick={() => archiveSeries.mutate({ id, archived: false })}
            >
              <ArchiveRestore className="h-4 w-4" />
              Unarchive
            </Button>
          )}
        </div>
      )}

      <nav className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1 shadow-sm">
        {tabs.map((tab) => {
          const href = tab.href(id);
          const active = pathname.startsWith(href);
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
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

/**
 * The read-only banner for an as-published archive series (ADR-010): results
 * were ingested exactly as originally published and are corrected in the
 * archive repo, not here. Links to the live public pages, which are the
 * series' real face.
 */
function AsPublishedNotice({ seriesId }: { seriesId: string }) {
  const { data: publication } = usePublicationStatus(seriesId);
  const pages = publication?.published?.pages ?? [];
  return (
    <div
      className="rounded-lg border bg-card px-4 py-3 text-sm space-y-1"
      data-testid="as-published-notice"
    >
      <p>
        <strong>This series is an as-published archive.</strong> Results are
        shown exactly as originally published and can&rsquo;t be edited or
        re-scored here; corrections are made in the archive that supplies them.
      </p>
      {pages.length > 0 && (
        <p className="text-muted-foreground">
          Public pages:{' '}
          {pages.map((p, i) => (
            <span key={p.url}>
              {i > 0 && ' · '}
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                {p.fleetName}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
