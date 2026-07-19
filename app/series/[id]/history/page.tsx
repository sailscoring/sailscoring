'use client';

import { use, useState } from 'react';
import { ChevronRight, Globe, History, Pin, Save, Undo2 } from 'lucide-react';

import {
  useSeriesRevisions,
  useRevertToRevision,
  useCreateCheckpoint,
} from '@/hooks/use-revisions';
import { useSeriesActivity } from '@/hooks/use-activity';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { formatRelativeTime } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ActivityEntry, RevisionEntry } from '@/lib/types';

function actorLabel(actor: RevisionEntry['actor']): string {
  return actor?.displayName ?? actor?.email ?? 'Someone';
}

/**
 * Headline for a revision row. Named checkpoints use their label and reverts
 * their message; an auto revision's headline is derived from the *set* of
 * changes in its window (chronological, de-duplicated) rather than the
 * last-action `summary`, which only described whatever happened to land last.
 */
function revisionTitle(rev: RevisionEntry, windowActivity: ActivityEntry[]): string {
  // named / publish / saved carry an explicit label.
  if (rev.label) return rev.label;
  if (rev.kind === 'revert') return rev.summary ?? 'Restored an earlier version';
  const summaries = [...new Set([...windowActivity].reverse().map((a) => a.summary))];
  if (summaries.length === 0) return rev.summary ?? 'Edited the series';
  if (summaries.length <= 2) return summaries.join(', ');
  return `${summaries.slice(0, 2).join(', ')} +${summaries.length - 2} more`;
}

const KIND_BADGE: Partial<Record<RevisionEntry['kind'], { icon: typeof Pin; label: string }>> = {
  named: { icon: Pin, label: 'Checkpoint' },
  revert: { icon: Undo2, label: 'Revert' },
  publish: { icon: Globe, label: 'Published' },
  saved: { icon: Save, label: 'Saved' },
};

function KindBadge({ kind }: { kind: RevisionEntry['kind'] }) {
  const badge = KIND_BADGE[kind];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3 w-3" /> {badge.label}
    </span>
  );
}

function RevisionRow({
  rev,
  windowActivity,
  canRestore,
  onRestore,
}: {
  rev: RevisionEntry;
  windowActivity: ActivityEntry[];
  canRestore: boolean;
  onRestore: (rev: RevisionEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  const expandable = windowActivity.length > 0;

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-start gap-3 text-left',
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
              <span className="font-medium">{revisionTitle(rev, windowActivity)}</span>
              <KindBadge kind={rev.kind} />
            </p>
            <p className="text-xs text-muted-foreground">
              {actorLabel(rev.actor)} · {formatRelativeTime(rev.createdAt)}
              {expandable && ` · ${windowActivity.length} change${windowActivity.length === 1 ? '' : 's'}`}
              {!rev.hasSnapshot && ' · snapshot no longer kept'}
            </p>
          </div>
        </button>
        {canRestore && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onRestore(rev)}
          >
            <Undo2 className="h-4 w-4" />
            Restore
          </Button>
        )}
      </div>
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
  const archived = useSeriesReadOnly();
  const { can } = useWorkspacePermissions();
  // Naming a checkpoint is a race-day-level write; restoring a revision
  // rewrites the whole series and demands manage-series.
  const readOnly = archived || !can('score');
  const canRestore = !archived && can('manage-series');
  const { data: revisions, isLoading, isError } = useSeriesRevisions(id);
  // Activity feeds the per-revision drill-down. The first page is enough for the
  // recent sessions; older revisions simply show without expandable detail.
  const { data: activityPages } = useSeriesActivity(id);
  const revert = useRevertToRevision(id);
  const checkpoint = useCreateCheckpoint(id);
  const [confirming, setConfirming] = useState<RevisionEntry | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState('');

  function saveCheckpoint() {
    const trimmed = label.trim();
    if (!trimmed) return;
    checkpoint.mutate(trimmed, {
      onSuccess: () => {
        setNaming(false);
        setLabel('');
      },
    });
  }

  // `n` opens the "Name this version" dialog (page-level action), unless the
  // user is typing or the series is read-only.
  useShortcuts([
    {
      key: 'n',
      description: 'Name this version',
      section: 'History',
      when: () => !readOnly && !naming,
      handler: () => setNaming(true),
    },
  ]);

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
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="h-4 w-4" />
          Saved versions, newest first. Each editing session is captured
          automatically; expand one to see the changes it covers.
        </p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setNaming(true)}>
            <Pin className="h-4 w-4" />
            Name this version
          </Button>
        )}
      </div>
      <ul className="divide-y bg-card border rounded-lg px-5" data-testid="revision-list">
        {revs.map((rev, i) => (
          <RevisionRow
            key={rev.id}
            rev={rev}
            windowActivity={windowFor(i)}
            // The newest revision is the current state — nothing to restore to.
            canRestore={canRestore && i !== 0 && rev.hasSnapshot}
            onRestore={setConfirming}
          />
        ))}
      </ul>

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => { if (!o) { setConfirming(null); setRestoreError(null); } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this version?</DialogTitle>
            <DialogDescription>
              The series will be replaced with its state{' '}
              {confirming && `from ${new Date(confirming.createdAt).toLocaleString()}`}.
              Your current version is kept in the history, and this restore is
              recorded as a new version — so you can undo it by restoring again.
            </DialogDescription>
          </DialogHeader>
          {restoreError && (
            <p role="alert" className="text-sm text-destructive">
              {restoreError} The series has not been changed.
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={revert.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!confirming) return;
                setRestoreError(null);
                revert.mutate(confirming.id, {
                  onSuccess: () => setConfirming(null),
                  onError: (err) =>
                    setRestoreError(
                      err instanceof Error && err.message
                        ? `Restore failed: ${err.message}.`
                        : 'Restore failed.',
                    ),
                });
              }}
              disabled={revert.isPending}
            >
              {revert.isPending ? 'Restoring…' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={naming} onOpenChange={(o) => { if (!o) { setNaming(false); setLabel(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this version</DialogTitle>
            <DialogDescription>
              Save the series&apos; current state as a named checkpoint you can
              always return to. It&apos;s pinned in the history and never folded
              into an editing session.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="e.g. Before protest hearing"
            value={label}
            maxLength={100}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveCheckpoint(); }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setNaming(false); setLabel(''); }} disabled={checkpoint.isPending}>
              Cancel
            </Button>
            <Button onClick={saveCheckpoint} disabled={checkpoint.isPending || label.trim().length === 0}>
              {checkpoint.isPending ? 'Saving…' : 'Save checkpoint'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
