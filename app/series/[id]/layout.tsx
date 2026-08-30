'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, CheckCircle2 } from 'lucide-react';
import { useSeries, useArchiveSeries, useSetResultsStatus } from '@/hooks/use-series';
import { cn } from '@/lib/utils';
import { useChordShortcut, useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { usePublicationStatus } from '@/hooks/use-published';
import { useConfirm } from '@/components/confirm-dialog';
import { KeyboardHelp } from '@/components/keyboard-help';
import { SeriesActionsMenu } from '@/components/series-actions-menu';
import { SeriesReadOnlyProvider } from '@/components/series-read-only';
import { SpectatorBanner } from '@/components/spectator-banner';
import { SpectatorProvider } from '@/components/spectator-context';
import { useSpectatorView } from '@/hooks/use-spectator';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useFeatures } from '@/components/features-provider';
import { useSplitFleetState } from '@/hooks/use-split-fleets';
import { Button } from '@/components/ui/button';
import { SeriesNotFound } from '@/components/series-not-found';
import { SeriesTabFallback } from '@/components/series-tab-fallback';

// Each tab carries its `g`-chord key; the chord bindings and the help-dialog
// rows are both derived from the visible tab set below, so a tab that isn't
// in the bar is neither listed nor navigable.
const baseTabs = [
  { label: 'Competitors', chord: 'c', href: (id: string) => `/series/${id}/competitors` },
  { label: 'Races', chord: 'r', href: (id: string) => `/series/${id}/races` },
  { label: 'Standings', chord: 's', href: (id: string) => `/series/${id}/standings` },
  { label: 'Settings', chord: 't', href: (id: string) => `/series/${id}/settings` },
  { label: 'History', chord: 'h', href: (id: string) => `/series/${id}/history` },
];

const prizesTab = { label: 'Prizes', chord: 'p', href: (id: string) => `/series/${id}/prizes` };

const splitFleetsTab = {
  label: 'Split Fleets',
  chord: 'q',
  href: (id: string) => `/series/${id}/split-fleets`,
};

// What a spectator view shows (#475): the entry list, the racing (down to
// each race's finish sheet, read-only since #486), the standings, and the
// setup that produced them — which is the whole of what a reader came to see.
// The rest of the bar belongs to a series that lives in a workspace: History
// and Activity record edits nobody can make here, and Prizes and Split Fleets
// are gated features of a workspace the viewer has none of.
const spectatorTabs = [
  baseTabs[0], // Competitors
  baseTabs[1], // Races
  baseTabs[2], // Standings
  baseTabs[3], // Settings
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
  // A spectator view (#475) is served from memory, so hold the series query
  // until the file has been read — the id is not one the server knows, and
  // asking it would only earn a 401 for a signed-out reader.
  const spectator = useSpectatorView(id);
  const isSpectator = spectator.kind !== 'off';
  const { data: series, isLoading } = useSeries(id, {
    enabled: !isSpectator || spectator.kind === 'ready',
  });
  const archiveSeries = useArchiveSeries();
  const setResultsStatus = useSetResultsStatus();
  const { can } = useWorkspacePermissions();
  const { has } = useFeatures();
  const confirm = useConfirm();
  const [showHelp, setShowHelp] = useState(false);

  const showPrizes = has('prizes');
  const showSplitFleets = has('split-fleets');
  // On a split-fleet series the regular per-fleet Standings tab is noise —
  // every round fleet gets a meaningless table; the standings that matter
  // live on the Split Fleets page (which also carries publish/preview).
  const { data: sfState } = useSplitFleetState(id, { enabled: showSplitFleets });
  const isSplitFleetSeries = !!sfState?.config;
  const asPublished = series?.asPublished ?? false;
  // Prizes slots in after Standings — allocation reads the standings, so the
  // tabs follow the scorer's flow. Split Fleets leads the bar — on a
  // championship series it IS the workflow (and the standings view), so the
  // scorer lands on it first; Competitors and Races stay as the underlying
  // data views. An as-published archive (ADR-010) keeps Competitors and
  // Standings (the stored tables); races, prizes, settings, and history have
  // nothing behind them in this regime.
  const gatedTabs = showPrizes
    ? [...baseTabs.slice(0, 3), prizesTab, ...baseTabs.slice(3)]
    : [...baseTabs];
  if (showSplitFleets && isSplitFleetSeries) {
    gatedTabs.unshift(splitFleetsTab);
  }
  const visibleTabs = isSplitFleetSeries
    ? gatedTabs.filter((t) => t.label !== 'Standings')
    : gatedTabs;
  const tabs = isSpectator
    ? spectatorTabs
    : asPublished
      ? [baseTabs[0], baseTabs[2]]
      : visibleTabs;

  useChordShortcut(
    Object.fromEntries(tabs.map((t) => [t.chord, () => router.push(t.href(id))])),
  );

  // No description: the dialog's static Global section documents `?` itself.
  // (Ctrl+S save-to-file is bound by SeriesActionsMenu below.)
  useShortcuts([{ key: '?', handler: () => setShowHelp(true) }]);

  // A view whose data file can no longer be reached — unpublished since, or
  // a spectator URL opened somewhere the file was never read. Neither is a
  // missing series, so neither gets "Series not found".
  if (spectator.kind === 'unavailable') {
    return (
      <div className="max-w-xl space-y-2" data-testid="spectator-unavailable">
        <h1 className="text-xl font-semibold">These results aren’t open here</h1>
        <p className="text-muted-foreground text-sm">{spectator.message}</p>
      </div>
    );
  }

  if (spectator.kind === 'opening' || isLoading || series === undefined) {
    return <SeriesTabFallback status="loading" />;
  }

  if (series === null) {
    return <SeriesNotFound seriesId={id} />;
  }

  const isFinal = series.resultsStatus === 'final';
  // A spectator view is read-only for good: there is no workspace behind it
  // to write to, and the transport refuses writes anyway.
  const readOnly =
    isSpectator || (series.archived ?? false) || (series.asPublished ?? false) || isFinal;

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
            {series.archived && !series.asPublished && (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground align-middle">
                <Archive className="h-3 w-3" />
                Archived
              </span>
            )}
            {isFinal && !series.asPublished && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-green-600/40 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 align-middle dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-400"
                data-testid="final-badge"
              >
                <CheckCircle2 className="h-3 w-3" />
                Final
              </span>
            )}
          </h1>
          {/* Save-to-file, publish, copy, delete: every one of them acts on a
              series in a workspace, which a spectator view is not. */}
          {!isSpectator && <SeriesActionsMenu series={series} />}
        </div>
        {(series.venue || series.startDate) && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {[series.venue, series.startDate].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>

      {spectator.kind === 'ready' ? (
        <SpectatorBanner source={spectator.view.source} />
      ) : series.asPublished ? (
        <AsPublishedNotice seriesId={series.id} />
      ) : series.archived ? (
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
      ) : isFinal && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
          data-testid="final-banner"
        >
          <p>
            <strong>These results are final.</strong> The series is read-only;
            reopen it as provisional to make changes.
          </p>
          {can('score') && (
            <Button
              size="sm"
              variant="outline"
              disabled={setResultsStatus.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Reopen this series as provisional?',
                  description:
                    'Results become editable again and the Final stamp comes off the next publish.',
                  confirmLabel: 'Reopen',
                });
                if (ok) setResultsStatus.mutate({ id, status: 'provisional' });
              }}
            >
              Reopen as provisional
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

      <SpectatorProvider spectator={isSpectator}>
        <SeriesReadOnlyProvider readOnly={readOnly}>
          {children}
        </SeriesReadOnlyProvider>
      </SpectatorProvider>

      <KeyboardHelp open={showHelp} onClose={() => setShowHelp(false)} tabChords={tabs} />
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
        shown exactly as originally published and can’t be edited or
        re-scored here; corrections — and removing the series altogether — are
        made in the archive that supplies them.
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
