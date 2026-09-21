'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { RateLimitedApiError } from '@/lib/api-client';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';

/**
 * "Refresh from source" beside a feed's as-of stamp (#594).
 *
 * The external rating feeds are cached for six hours, which is right for the
 * ordinary case and wrong for the one that matters: ORC amends certificates
 * through the season and IRC re-rates after protests, so a scorer who knows a
 * certificate was reissued this morning could only wait out the window.
 *
 * Shown to workspace admins alone — the same bar as the FTP credentials this
 * dialog already holds — because pressing it reaches someone else's server.
 * The server throttles it to one forced refetch per source per minute and
 * says how long to wait; a scorer who presses twice is told, not ignored.
 */
export function RefreshSource({
  onRefresh,
  what,
}: {
  /** Refetch past the cache, and resolve when the fresh data has landed. */
  onRefresh: () => Promise<unknown>;
  /** What is being refreshed, for the button's accessible name. */
  what: string;
}) {
  const { can } = useWorkspacePermissions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!can('manage-workspace')) return null;

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      await onRefresh();
      setMessage('Refreshed.');
    } catch (err) {
      // The throttle answers 429 with the seconds left, so the button can say
      // how long rather than only that it refused.
      setMessage(
        err instanceof RateLimitedApiError
          ? `Just refreshed — try again in ${err.retryAfterSeconds ?? 60}s.`
          : 'Could not refresh. The source may be unavailable.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={busy}
        data-testid="refresh-source"
        aria-label={`Refresh ${what} from source`}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
        {busy ? 'Refreshing…' : 'Refresh from source'}
      </button>
      {message && (
        <span className="ml-2 text-xs text-muted-foreground" data-testid="refresh-source-message">
          {message}
        </span>
      )}
    </>
  );
}
