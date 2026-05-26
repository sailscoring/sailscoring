'use client';

import { use } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Flag,
  Sailboat,
  Users,
} from 'lucide-react';

import { useSeriesActivity } from '@/hooks/use-activity';
import { activityKind, type ActivityKind } from '@/lib/activity-actions';
import { formatRelativeTime } from '@/lib/relative-time';
import { Button } from '@/components/ui/button';
import type { ActivityEntry } from '@/lib/types';

const KIND_ICON: Record<ActivityKind, typeof Flag> = {
  series: ClipboardList,
  competitor: Users,
  race: Flag,
  finish: CheckCircle2,
  other: Sailboat,
};

function actorLabel(actor: ActivityEntry['actor']): string {
  return actor?.displayName ?? actor?.email ?? 'Someone';
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon = KIND_ICON[activityKind(entry.action)];
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          {entry.summary}
          {entry.count > 1 && (
            <span className="ml-1.5 text-muted-foreground">×{entry.count}</span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {actorLabel(entry.actor)} · {formatRelativeTime(entry.createdAt)}
        </p>
      </div>
    </li>
  );
}

export default function SeriesActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useSeriesActivity(id);

  if (isLoading) {
    return <p className="text-muted-foreground">Loading activity…</p>;
  }
  if (isError) {
    return <p className="text-muted-foreground">Couldn’t load activity.</p>;
  }

  const entries = data?.pages.flatMap((p) => p.items) ?? [];

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>No activity yet.</p>
        <p className="mt-1">
          Edits to this series — results entered, competitors imported, settings
          changed — show up here, newest first, with who made them.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Who changed what, newest first. Co-scorers&apos; edits appear here too.
      </p>
      <ul className="divide-y" data-testid="activity-feed">
        {entries.map((entry) => (
          <ActivityRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {isFetchingNextPage ? 'Loading…' : 'Show older'}
        </Button>
      )}
    </div>
  );
}
