'use client';

import Link from 'next/link';
import { Eye } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The standing notice on a spectator view (#475, ADR-012).
 *
 * Two jobs, and the first is the one that matters: say plainly that this is a
 * copy of published results being looked at, not the series that produced
 * them, so nothing here can be mistaken for the official record. The second
 * is the single door out — importing a copy, which is where signing in comes
 * in and where any editing, "what if" experiments included, happens.
 */
export function SpectatorBanner({ source }: { source: string }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm"
      data-testid="spectator-banner"
    >
      <p className="flex items-start gap-2">
        <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          <strong>You’re viewing published results.</strong> This is a
          read-only copy of the results data behind the published pages, not
          the scorer’s series. Save it to a workspace to score, edit, or try
          out changes of your own.
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Button asChild size="sm">
          <Link href={`/import?from=${encodeURIComponent(source)}`}>
            Save to my workspace
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={publishedPageOf(source)}>Back to results</a>
        </Button>
      </div>
    </div>
  );
}

/**
 * The published page a data file belongs to: its own folder. The file sits
 * beside the publication's pages, so dropping its filename lands on the
 * folder index, which lists them — the one link that is right whichever page
 * the reader came from.
 */
function publishedPageOf(source: string): string {
  const cut = source.lastIndexOf('/');
  return cut > 0 ? source.slice(0, cut) : source;
}
