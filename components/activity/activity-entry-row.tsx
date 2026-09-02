'use client';

import Link from 'next/link';

import { formatRelativeTime } from '@/lib/relative-time';
import type { ActivityEntry } from '@/lib/types';

function actorLabel(actor: ActivityEntry['actor']): string {
  return actor?.displayName ?? actor?.email ?? 'Someone';
}

/**
 * One activity entry, the way every feed shows it: the summary sentence, the
 * coalesced count when a row stands for several occurrences, and a byline of
 * who and when. The History tab adds a note (the entry has no saved version
 * behind it); the workspace feed adds a link to the series the entry belongs
 * to, when there still is one.
 */
export function ActivityEntryRow({
  entry,
  series,
  note,
}: {
  entry: ActivityEntry;
  /** The series to link to; omit for a workspace-level entry or a series that is gone. */
  series?: { id: string; name: string } | null;
  note?: string;
}) {
  return (
    <li className="py-3" data-testid="activity-entry" data-action={entry.action}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center">
          <span className="h-1.5 w-1.5 rounded-full border border-muted-foreground/40" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">
            {entry.summary}
            {entry.count > 1 && <span className="ml-1">×{entry.count}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {actorLabel(entry.actor)} · {formatRelativeTime(entry.createdAt)}
            {series && (
              <>
                {' · '}
                <Link href={`/series/${series.id}`} className="underline-offset-2 hover:underline">
                  {series.name}
                </Link>
              </>
            )}
            {note && <> · {note}</>}
          </p>
        </div>
      </div>
    </li>
  );
}
