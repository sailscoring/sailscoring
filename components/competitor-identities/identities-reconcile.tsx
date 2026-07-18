'use client';

import { useMemo, useState } from 'react';
import { Landmark, ExternalLink, GitMerge, Scissors, TriangleAlert, Undo2 } from 'lucide-react';

import { LONG_ARC_YEARS } from '@/lib/competitor-identity-cluster';
import type {
  IdentityWithArc,
  MergeResult as IdentityMergeUndo,
} from '@/lib/competitor-identity-repository';
import type { StaleLink } from '@/lib/competitor-identity-reconcile';
import {
  useCompetitorIdentities,
  useDistinguishIdentities,
  useIdentityReviewQueue,
  useUnlinkIdentity,
  useMergeCompetitorIdentities,
  useRenameCompetitorIdentity,
  useRestoreCompetitorIdentity,
  useSetIdentityReviewed,
  useSplitCompetitorIdentity,
} from '@/hooks/use-competitor-identities';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

function span(identity: IdentityWithArc): string {
  if (identity.firstYear == null || identity.lastYear == null) return '—';
  return identity.firstYear === identity.lastYear
    ? `${identity.firstYear}`
    : `${identity.firstYear}–${identity.lastYear}`;
}

function isLongArc(identity: IdentityWithArc): boolean {
  return (
    identity.firstYear != null &&
    identity.lastYear != null &&
    identity.lastYear - identity.firstYear > LONG_ARC_YEARS
  );
}

/** One line summarising an identity in the review queue / merge dialog. */
function identitySummary(identity: IdentityWithArc): string {
  const parts = [
    `${identity.entries.length} series`,
    span(identity),
  ];
  if (identity.club) parts.push(identity.club);
  if (identity.sailNumber) parts.push(identity.sailNumber);
  return parts.join(' · ');
}

/** What a completed merge shows in the undo banner. */
interface UndoState {
  sourceLabel: string;
  targetLabel: string;
  payload: IdentityMergeUndo;
}

/**
 * "Possible same sailor" — a weak name-match edge between two settled
 * identities. Combine merges the smaller record into the larger; "Different
 * sailors" dismisses the pair for good.
 */
function MergeSuggestionRow({
  a,
  b,
  onMerged,
}: {
  a: IdentityWithArc;
  b: IdentityWithArc;
  onMerged: (undo: UndoState) => void;
}) {
  const merge = useMergeCompetitorIdentities();
  const distinguish = useDistinguishIdentities();
  // An archive-managed record always survives (ADR-010 — git would recreate
  // it anyway); between two app records, the richer one does.
  const [target, source] =
    a.managedBy !== b.managedBy
      ? a.managedBy === 'archive'
        ? [a, b]
        : [b, a]
      : b.entries.length > a.entries.length
        ? [b, a]
        : [a, b];

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
      data-testid="merge-suggestion"
    >
      <div className="min-w-0 text-sm">
        <div className="font-medium">
          {a.label}
          <span className="text-muted-foreground font-normal"> — {identitySummary(a)}</span>
        </div>
        <div className="font-medium">
          {b.label}
          <span className="text-muted-foreground font-normal"> — {identitySummary(b)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Same name; nothing else confirms it&rsquo;s one sailor. Combine them, or
          keep them apart for good.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          disabled={merge.isPending || distinguish.isPending}
          onClick={async () => {
            // mutateAsync rather than mutate-callbacks: this row unmounts as
            // soon as the refetched queue drops the pair, and unmount skips
            // mutate-level onSuccess — the undo banner must outlive the row.
            const res = await merge
              .mutateAsync({ id: target.id, sourceId: source.id })
              .catch(() => null);
            if (res) {
              onMerged({
                sourceLabel: source.label,
                targetLabel: target.label,
                payload: res.undo,
              });
            }
          }}
        >
          <GitMerge className="h-3.5 w-3.5" />
          Combine
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={merge.isPending || distinguish.isPending}
          onClick={() => distinguish.mutate({ aId: a.id, bId: b.id })}
        >
          Different sailors
        </Button>
      </div>
    </div>
  );
}

/** A stale membership (#316): the identity's label matches no person on the
 *  (multi-person) row — a rename that walked away from the link, or a
 *  pre-list joined-name identity still attached. Unlink removes just this
 *  membership; the identity keeps its other events. */
function StaleLinkRow({ link }: { link: StaleLink }) {
  const unlink = useUnlinkIdentity();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
      data-testid="stale-link-row"
    >
      <div className="min-w-0 text-sm">
        <span className="font-medium">{link.identityLabel}</span>
        <span className="text-muted-foreground">
          {' '}— linked to {link.competitorNames.filter((n) => n.trim()).join(' & ')} ({link.sailNumber})
        </span>
        <p className="text-xs text-muted-foreground mt-1">
          None of the entry&rsquo;s named people match this record. Unlink it,
          or rename the record if it should match.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          disabled={unlink.isPending}
          onClick={() => unlink.mutate({ identityId: link.identityId, competitorId: link.competitorId })}
        >
          Unlink
        </Button>
      </div>
    </div>
  );
}

/** A long-arc identity awaiting review: show its entries, or confirm it. */
function LongArcRow({
  identity,
  onShow,
}: {
  identity: IdentityWithArc;
  onShow: (label: string) => void;
}) {
  const review = useSetIdentityReviewed();
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
      data-testid="long-arc-row"
    >
      <div className="min-w-0 text-sm">
        <span className="font-medium">{identity.label}</span>
        <span className="text-muted-foreground"> — {identitySummary(identity)}</span>
        <p className="text-xs text-muted-foreground mt-1">
          Spans more than {LONG_ARC_YEARS} years — often two sailors merged by
          mistake. Split the misgrouped entries, or confirm it&rsquo;s one career.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={() => onShow(identity.label)}>
          Show entries
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={review.isPending}
          onClick={() => review.mutate({ id: identity.id, reviewed: true })}
        >
          Looks right
        </Button>
      </div>
    </div>
  );
}

/** Pick another identity to merge this one into. */
function MergeIntoDialog({
  identity,
  others,
  open,
  onOpenChange,
  onMerged,
}: {
  identity: IdentityWithArc;
  others: IdentityWithArc[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (undo: UndoState) => void;
}) {
  const merge = useMergeCompetitorIdentities();
  const [query, setQuery] = useState('');
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = others.filter((o) => o.id !== identity.id);
    if (!q) return pool.slice(0, 8);
    return pool.filter((o) => o.label.toLowerCase().includes(q)).slice(0, 8);
  }, [others, identity.id, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Merge &ldquo;{identity.label}&rdquo; into…</DialogTitle>
          <DialogDescription>
            All {identity.entries.length} of this competitor&rsquo;s entries move to
            the one you pick, which stays the public record. You can undo
            straight after.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search competitors…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search merge targets"
          autoFocus
        />
        <ul className="divide-y max-h-64 overflow-y-auto">
          {candidates.map((o) => (
            <li key={o.id}>
              <button
                className="w-full text-left px-2 py-2 text-sm hover:bg-accent rounded-md disabled:opacity-50"
                disabled={merge.isPending}
                onClick={async () => {
                  // mutateAsync: the dialog (and its card) unmount when the
                  // merged-away identity leaves the refetched list, and
                  // unmount skips mutate-level onSuccess.
                  const res = await merge
                    .mutateAsync({ id: o.id, sourceId: identity.id })
                    .catch(() => null);
                  if (res) {
                    onOpenChange(false);
                    onMerged({
                      sourceLabel: identity.label,
                      targetLabel: o.label,
                      payload: res.undo,
                    });
                  }
                }}
              >
                <span className="font-medium">{o.label}</span>{' '}
                <span className="text-muted-foreground text-xs">
                  {identitySummary(o)}
                </span>
              </button>
            </li>
          ))}
          {candidates.length === 0 && (
            <li className="px-2 py-2 text-sm text-muted-foreground">
              No matching competitor.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function IdentityCard({
  identity,
  others,
  workspaceSlug,
  onMerged,
}: {
  identity: IdentityWithArc;
  others: IdentityWithArc[];
  workspaceSlug: string;
  onMerged: (undo: UndoState) => void;
}) {
  const rename = useRenameCompetitorIdentity();
  const split = useSplitCompetitorIdentity();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(identity.label);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Archive-managed identities belong to the archive repo's manifest
  // (ADR-010): no rename, no merging *away*, no long-arc nagging — and
  // entries in as-published series can't be peeled here.
  const archiveManaged = identity.managedBy === 'archive';
  const longArc = isLongArc(identity) && !identity.reviewedAt && !archiveManaged;
  const splittable = (e: { asPublished: boolean }) => !e.asPublished;

  const toggle = (competitorId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(competitorId)) next.delete(competitorId);
      else next.add(competitorId);
      return next;
    });

  const splitDisabled =
    split.isPending || selected.size === 0 || selected.size >= identity.entries.length;

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card" data-testid="identity-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                rename.mutate(
                  { id: identity.id, label: label.trim() },
                  { onSuccess: () => setEditing(false) },
                );
              }}
            >
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="h-8 w-56"
                aria-label="Competitor name"
                autoFocus
              />
              <Button type="submit" size="sm" disabled={rename.isPending || !label.trim()}>
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLabel(identity.label);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </form>
          ) : archiveManaged ? (
            <span className="font-medium truncate text-left">
              {identity.label}
            </span>
          ) : (
            <button
              className="font-medium truncate hover:underline text-left"
              onClick={() => setEditing(true)}
              title="Rename"
            >
              {identity.label}
            </button>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">
            {identity.entries.length} series · {span(identity)}
            {identity.club ? ` · ${identity.club}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {archiveManaged && (
            <span
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
              title="Managed by the results archive — name and grouping are corrected in the archive repo"
              data-testid="archive-managed-badge"
            >
              <Landmark className="h-3.5 w-3.5" />
              archive
            </span>
          )}
          {longArc && (
            <span
              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
              title={`Spans more than ${LONG_ARC_YEARS} years — likely two sailors merged by mistake. Split the misgrouped rows.`}
            >
              <TriangleAlert className="h-3.5 w-3.5" />
              long arc
            </span>
          )}
          {!archiveManaged && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground"
            title="Merge this competitor into another — they're the same sailor"
            onClick={() => setMergeOpen(true)}
          >
            <GitMerge className="h-3.5 w-3.5" />
            Merge…
          </Button>
          )}
          <a
            href={`/p/${workspaceSlug}/competitor/${identity.slug ?? identity.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Timeline
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      <ul className="divide-y text-sm">
        {identity.entries.map((e) => (
          <li
            key={e.competitorId}
            className="flex items-center justify-between gap-3 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              {identity.entries.length > 1 && splittable(e) && (
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  aria-label={`Select ${e.seriesName}`}
                  checked={selected.has(e.competitorId)}
                  onChange={() => toggle(e.competitorId)}
                />
              )}
              <span className="min-w-0 truncate">
                <span className="tabular-nums text-muted-foreground mr-2">
                  {e.year ?? '????'}
                </span>
                {e.seriesName}
              </span>
            </span>
            <span className="flex items-center gap-3 shrink-0 text-muted-foreground">
              <span className="tabular-nums">{e.sailNumber}</span>
              {splittable(e) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-muted-foreground hover:text-destructive"
                  title="Split this entry off — it isn't this competitor"
                  disabled={split.isPending || identity.entries.length < 2}
                  onClick={() =>
                    split.mutate({ id: identity.id, competitorIds: [e.competitorId] })
                  }
                >
                  <Scissors className="h-3.5 w-3.5" />
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected
            {selected.size >= identity.entries.length &&
              ' — leave at least one entry behind (rename instead?)'}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={splitDisabled}
            title="Peel the selected entries onto a new competitor of their own"
            onClick={() =>
              split.mutate(
                { id: identity.id, competitorIds: [...selected] },
                { onSuccess: () => setSelected(new Set()) },
              )
            }
          >
            <Scissors className="h-3.5 w-3.5" />
            Split selected
          </Button>
        </div>
      )}

      <MergeIntoDialog
        identity={identity}
        others={others}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        onMerged={onMerged}
      />
    </div>
  );
}

export function IdentitiesReconcile({ workspaceSlug }: { workspaceSlug: string }) {
  const { data: identities, isError, refetch } = useCompetitorIdentities();
  const { data: review } = useIdentityReviewQueue();
  const mergeSuggestions = review?.mergeSuggestions;
  const staleLinks = review?.staleLinks ?? [];
  const restore = useRestoreCompetitorIdentity();
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState<UndoState | null>(null);

  const byId = useMemo(
    () => new Map((identities ?? []).map((i) => [i.id, i])),
    [identities],
  );

  // Merge candidates whose both sides are still present (a just-acted-on pair
  // drops out as soon as the lists refetch).
  const suggestionPairs = useMemo(
    () =>
      (mergeSuggestions ?? [])
        .map((s) => ({ a: byId.get(s.aId), b: byId.get(s.bId) }))
        .filter((p): p is { a: IdentityWithArc; b: IdentityWithArc } =>
          Boolean(p.a && p.b),
        ),
    [mergeSuggestions, byId],
  );

  const longArcs = useMemo(
    () =>
      (identities ?? []).filter(
        (i) => isLongArc(i) && !i.reviewedAt && i.managedBy !== 'archive',
      ),
    [identities],
  );

  const filtered = useMemo(() => {
    const list = identities ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((i) => i.label.toLowerCase().includes(q));
  }, [identities, query]);

  if (identities === undefined) {
    // Without this branch a failed load would sit on "Loading…" forever —
    // focus refetches are off, so nothing retries until a navigation.
    if (isError) {
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t load competitors. Check your connection and try again.
          </p>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      );
    }
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (identities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No competitors yet. They appear here as series are added and imported.
      </p>
    );
  }

  const reviewCount = suggestionPairs.length + longArcs.length + staleLinks.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 max-w-xs"
          aria-label="Search competitors"
        />
        <span className="text-xs text-muted-foreground shrink-0">
          {identities.length} competitors
          {reviewCount > 0 && ` · ${reviewCount} to review`}
        </span>
      </div>

      {undo && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm"
          data-testid="undo-merge"
        >
          <span>
            Combined &ldquo;{undo.sourceLabel}&rdquo; into &ldquo;
            {undo.targetLabel}&rdquo;.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={restore.isPending}
            onClick={() =>
              restore.mutate(undo.payload, { onSuccess: () => setUndo(null) })
            }
          >
            <Undo2 className="h-3.5 w-3.5" />
            Undo
          </Button>
        </div>
      )}

      {reviewCount > 0 && (
        <section className="space-y-2" data-testid="review-queue">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-primary">
            To review ({reviewCount})
          </h2>
          <div className="space-y-2">
            {suggestionPairs.map(({ a, b }) => (
              <MergeSuggestionRow
                key={`${a.id}:${b.id}`}
                a={a}
                b={b}
                onMerged={setUndo}
              />
            ))}
            {longArcs.map((identity) => (
              <LongArcRow key={identity.id} identity={identity} onShow={setQuery} />
            ))}
            {staleLinks.map((link) => (
              <StaleLinkRow key={`${link.identityId}:${link.competitorId}`} link={link} />
            ))}
          </div>
        </section>
      )}

      <div className="space-y-3">
        {filtered.map((identity) => (
          <IdentityCard
            key={identity.id}
            identity={identity}
            others={identities}
            workspaceSlug={workspaceSlug}
            onMerged={setUndo}
          />
        ))}
      </div>
    </div>
  );
}
