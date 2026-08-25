'use client';

/**
 * Rendered when the workspace-scoped series GET finds nothing. The id may
 * still be a real series in another of the user's workspaces — the active
 * workspace is a single session-level pointer shared by every tab, so a
 * switch made in one tab strands any series URL open in another. Resolve
 * where the series actually lives and offer an explicit switch back rather
 * than silently flipping the session, which would strand the other tab in
 * exactly the same way.
 */
import { useState } from 'react';

import { setActiveWorkspace } from '@/lib/auth-client';
import { useSeriesLocation } from '@/hooks/use-series';
import { Button } from '@/components/ui/button';
import { SeriesTabFallback } from '@/components/series-tab-fallback';

export function SeriesNotFound({ seriesId }: { seriesId: string }) {
  const { data: location, isLoading } = useSeriesLocation(seriesId);
  const [busy, setBusy] = useState(false);

  // Hold the loading state while the lookup runs so the page never flashes
  // "Series not found." at a scorer whose series is one switch away.
  if (isLoading) return <SeriesTabFallback status="loading" />;
  if (!location) return <SeriesTabFallback status="missing" />;

  const switchAndReload = async () => {
    setBusy(true);
    try {
      await setActiveWorkspace(location.workspaceId);
      // Hard reload so every server component re-evaluates against the
      // switched workspace; the URL already points at this series.
      window.location.reload();
    } catch (err) {
      console.error('switch workspace failed:', err);
      setBusy(false);
    }
  };

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
      data-testid="series-elsewhere-notice"
    >
      <div className="space-y-0.5">
        <p>
          This series is in the <strong>{location.workspaceName}</strong>{' '}
          workspace, which isn’t your active workspace.
        </p>
        <p className="text-muted-foreground">
          Switching applies to your whole session, including other open tabs.
        </p>
      </div>
      <Button size="sm" disabled={busy} onClick={switchAndReload}>
        Switch to {location.workspaceName}
      </Button>
    </div>
  );
}
