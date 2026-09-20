'use client';

/**
 * The series-level Publish action.
 *
 * Publish used to be mounted per page — on Standings, on Competitors, and on
 * Split Fleets — which meant a scorer who had just finished entering a race
 * had to navigate away from the finish sheet to find it. It belongs to the
 * series rather than to any one tab, so it lives in the series header beside
 * the ⋯ menu and is reachable from every tab, including a race's finish
 * sheet.
 *
 * The dialog itself already decides *what* goes out — entry list, standings,
 * per-race pages — from the series and its own page selection, so one mount
 * serves every tab. The one thing a tab knows better than the header is which
 * races the engine could not score: the standings page has already scored the
 * series to draw its tables, and hands those notes over by rendering a
 * {@link PublishUnscoredNotes} so the dialog can mark the pages holding them.
 * A tab that contributes nothing leaves the list empty, which is what the
 * Competitors and Split Fleets mounts always passed.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { PublishDialog, type UnscoredRaceNote } from '@/components/publish-dialog';
import { Button } from '@/components/ui/button';
import { useFeatures } from '@/components/features-provider';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import type { Series } from '@/lib/types';

interface SeriesPublishValue {
  /** Whether this series can be published at all — permission, and a regime
   *  that has something to publish. False leaves the header button off. */
  available: boolean;
  open: () => void;
  setUnscored: (notes: UnscoredRaceNote[]) => void;
}

const SeriesPublishContext = createContext<SeriesPublishValue | null>(null);

export function SeriesPublishProvider({
  series,
  available,
  isSplitFleetSeries,
  children,
}: {
  series: Series;
  available: boolean;
  /** A split-fleet championship publishes its own pages — the championship
   *  standings, the per-race results, the assignments — rather than one page
   *  per fleet, so the dialog runs in single-default-page mode. */
  isSplitFleetSeries: boolean;
  children: React.ReactNode;
}) {
  const { has } = useFeatures();
  const { can } = useWorkspacePermissions();
  const [open, setOpen] = useState(false);
  const [unscored, setUnscored] = useState<UnscoredRaceNote[]>([]);
  const { data: fleets } = useFleetsBySeries(series.id, { enabled: available });

  // `p` was the per-page binding on Standings and Competitors; it is now the
  // series' own, so it works from the finish sheet too. The tab chords are
  // `g`-prefixed, so there is no collision.
  useShortcuts([
    {
      key: 'p',
      description: 'Publish',
      section: 'Series',
      when: () => available,
      handler: () => setOpen(true),
    },
  ]);

  const value = useMemo<SeriesPublishValue>(
    () => ({ available, open: () => setOpen(true), setUnscored }),
    [available],
  );

  return (
    <SeriesPublishContext.Provider value={value}>
      {children}
      {available && (
        <PublishDialog
          series={series}
          fleets={isSplitFleetSeries ? [] : (fleets ?? [])}
          open={open}
          onClose={() => setOpen(false)}
          canFtp={has('ftp-upload') && can('manage-workspace')}
          unscored={unscored}
        />
      )}
    </SeriesPublishContext.Provider>
  );
}

/** The series-level Publish action, for a page that offers its own route to
 *  it (a Preview dialog's "Publish" button). Null outside a series. */
export function useSeriesPublish(): SeriesPublishValue | null {
  return useContext(SeriesPublishContext);
}

/**
 * Hand the header's Publish dialog the races this tab knows the engine could
 * not score. Cleared when the tab stops rendering it, so a note never outlives
 * the page that computed it.
 *
 * A component rather than a hook because the page that has the answer only has
 * it well past its own early returns, where a hook cannot be called.
 */
export function PublishUnscoredNotes({ notes }: { notes: UnscoredRaceNote[] }) {
  const publish = useSeriesPublish();
  const setUnscored = publish?.setUnscored;
  // Keyed on the notes' content: the caller rebuilds the array on every
  // render, and an identity check would write state in a loop.
  const key = JSON.stringify(notes);
  useEffect(() => {
    if (!setUnscored) return;
    setUnscored(JSON.parse(key) as UnscoredRaceNote[]);
    return () => setUnscored([]);
  }, [key, setUnscored]);
  return null;
}

/** The Publish button as the series header renders it. */
export function SeriesPublishButton() {
  const publish = useSeriesPublish();
  const open = publish?.open;
  const onClick = useCallback(() => open?.(), [open]);
  if (!publish?.available) return null;
  return (
    <Button size="sm" variant="outline" onClick={onClick} title="Publish (p)">
      Publish…
    </Button>
  );
}
