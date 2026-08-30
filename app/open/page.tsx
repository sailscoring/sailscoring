'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * `/open?from=/p/{ws}/{slug}/{name}.sailscoring.json` — the public door into
 * a spectator view (#475, ADR-012).
 *
 * Reads the published data file into an in-memory series and hands over to
 * the ordinary series tabs, read-only. No account, and nothing stored: the
 * "Open in Sail Scoring" link on every published page points here, and the
 * one way out of read-only — importing a copy — asks for sign-in at that
 * point and not before.
 *
 * Navigation is client-side on purpose. The view lives in module state, so a
 * hard navigation would drop what this page just read.
 */
export default function OpenPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from');
    if (!from) {
      setError('That link is missing the results it should open.');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const { openSpectatorSeries } = await import('@/lib/spectator/seed');
        const seriesId = await openSpectatorSeries(from);
        if (cancelled) return;
        router.replace(`/series/${seriesId}/standings`);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Could not read the results data from that link.',
        );
      }
    })();
    return () => { cancelled = true; };
  }, [router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (error) {
    return (
      <div className="max-w-xl mx-auto space-y-2" data-testid="open-error">
        <h1 className="text-xl font-semibold">Can’t open these results</h1>
        <p className="text-muted-foreground text-sm">{error}</p>
      </div>
    );
  }

  return <p className="text-muted-foreground">Opening results…</p>;
}
