'use client';

import { use, useState } from 'react';
import { ChevronRight, History, Pin, Undo2 } from 'lucide-react';

import { useSeriesRevisions } from '@/hooks/use-revisions';
import { useSeriesActivity } from '@/hooks/use-activity';
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import type { ActivityEntry, RevisionEntry } from '@/lib/types';

function actorLabel(actor: RevisionEntry['actor']): string {
  return actor?.displayName ?? actor?.email ?? 'Someone';
}

/** Headline for a revision row: a named checkpoint's label, else its summary. */
function revisionTitle(rev: RevisionEntry): string {
  if (rev.kind === 'named' && rev.label) return rev.label;
  if (rev.summary) return rev.summary;
  return rev.kind === 'revert' ? 'Restored an earlier version' : 'Edited the series';
}

function KindBadge({ kind }: { kind: RevisionEntry['kind'] }) {
  if (kind === 'named') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <Pin className="h-3 w-3" /> Checkpoint
      </span>
    );
  }
  if (kind === 'revert') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <Undo2 className="h-3 w-3" /> Revert
      </span>
    );
  }
  return null;
}

function RevisionRow({
  rev,
  windowActivity,
}: {
  rev: RevisionEntry;
  windowActivity: ActivityEntry[];
}) {
  const [open, setOpen] = useState(false);
  const expandable = windowActivity.length > 0;

  return (
    <li className="py-3">
      <button
        type="button"
        className={cn(
          'flex w-full items-start gap-3 text-left',
          expandable ? 'cursor-pointer' : 'cursor-default',
        )}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center text-muted-foreground">
          {expandable ? (
            <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm">
            <span className="font-medium">{revisionTitle(rev)}</span>
            <KindBadge kind={rev.kind} />
          </p>
          <p className="text-xs text-muted-foreground">
            {actorLabel(rev.actor)} · {formatRelativeTime(rev.createdAt)}
            {expandable && ` · ${windowActivity.length} change${windowActivity.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </button>
      {open && expandable && (
        <ul className="mt-2 ml-10 space-y-1 border-l pl-4">
          {windowActivity.map((a) => (
            <li key={a.id} className="text-xs text-muted-foreground">
              {a.summary}
              {a.count > 1 && <span className="ml-1">×{a.count}</span>}
              <span className="ml-1 opacity-70">· {formatRelativeTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SeriesHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: revisions, isLoading, isError } = useSeriesRevisions(id);
  // Activity feeds the per-revision drill-down. The first page is enough for the
  // recent sessions; older revisions simply show without expandable detail.
  const { data: activityPages } = useSeriesActivity(id);

  if (isLoading) {
    return <p className="text-muted-foreground">Loading history…</p>;
  }
  if (isError) {
    return <p className="text-muted-foreground">Couldn’t load history.</p>;
  }

  const revs = revisions ?? [];
  const activity = activityPages?.pages.flatMap((p) => p.items) ?? [];

  if (revs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>No saved versions yet.</p>
        <p className="mt-1">
          As you edit this series, Sail Scoring keeps a versioned history here —
          each editing session is saved automatically so you can review and
          restore earlier states.
        </p>
      </div>
    );
  }

  // Bucket activity into each revision's window: entries created after the
  // previous (older) revision and up to this one. `revs` is newest-first, so
  // the previous revision in time is the next index.
  function windowFor(index: number): ActivityEntry[] {
    const thisAt = new Date(revs[index].createdAt).getTime();
    const prevAt =
      index + 1 < revs.length ? new Date(revs[index + 1].createdAt).getTime() : -Infinity;
    return activity.filter((a) => {
      const t = new Date(a.createdAt).getTime();
      return t > prevAt && t <= thisAt;
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="h-4 w-4" />
        Saved versions, newest first. Each editing session is captured
        automatically; expand one to see the changes it covers.
      </p>
      <ul className="divide-y bg-card border rounded-lg px-5" data-testid="revision-list">
        {revs.map((rev, i) => (
          <RevisionRow key={rev.id} rev={rev} windowActivity={windowFor(i)} />
        ))}
      </ul>
    </div>
  );
}
