'use client';

import { useEffect, useState } from 'react';

import {
  getSpectatorSeries,
  isSpectatorSeriesId,
  readSpectatorSource,
  type SpectatorSeries,
} from '@/lib/spectator/store';

/**
 * What the series tree is looking at: an ordinary stored series (`off`), or a
 * spectator view of a published data file (#475).
 *
 * A view opened through `/open` is already in memory, so `ready` is reached
 * synchronously and no tab flashes a loader. A reload has lost the module
 * state but not the source path, so this re-reads the file — landing on the
 * identical series, ids and all. A view whose source is unknown (a spectator
 * URL pasted into another browser, where the shareable link was the published
 * page) is `unavailable`, which is the honest answer rather than an empty
 * series.
 */
export type SpectatorView =
  | { kind: 'off' }
  | { kind: 'opening' }
  | { kind: 'ready'; view: SpectatorSeries }
  | { kind: 'unavailable'; message: string };

const NO_SOURCE =
  'This view was opened from a published results page and is not stored anywhere. Open it again from the results page to look at it.';

export function useSpectatorView(seriesId: string): SpectatorView {
  const [state, setState] = useState<SpectatorView>(() => initial(seriesId));

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const next = initial(seriesId);
    if (next.kind !== 'opening') {
      setState(next);
      return;
    }
    const source = readSpectatorSource(seriesId);
    if (!source) {
      setState({ kind: 'unavailable', message: NO_SOURCE });
      return;
    }
    let cancelled = false;
    setState({ kind: 'opening' });
    void (async () => {
      try {
        const { openSpectatorSeries } = await import('@/lib/spectator/seed');
        await openSpectatorSeries(source);
        const view = getSpectatorSeries(seriesId);
        if (cancelled) return;
        setState(
          view
            ? { kind: 'ready', view }
            : { kind: 'unavailable', message: NO_SOURCE },
        );
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: 'unavailable',
          message: err instanceof Error ? err.message : NO_SOURCE,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [seriesId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return state;
}

/** Synchronous read of the store, so an already-open view never flashes. */
function initial(seriesId: string): SpectatorView {
  if (!isSpectatorSeriesId(seriesId)) return { kind: 'off' };
  const view = getSpectatorSeries(seriesId);
  return view ? { kind: 'ready', view } : { kind: 'opening' };
}
