'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Scissors, TriangleAlert } from 'lucide-react';

import { LONG_ARC_YEARS } from '@/lib/competitor-identity-cluster';
import type { IdentityWithArc } from '@/lib/competitor-identity-repository';
import {
  useCompetitorIdentities,
  useRenameCompetitorIdentity,
  useUnlinkCompetitor,
} from '@/hooks/use-competitor-identities';
import { Button } from '@/components/ui/button';
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

function IdentityCard({
  identity,
  workspaceSlug,
}: {
  identity: IdentityWithArc;
  workspaceSlug: string;
}) {
  const rename = useRenameCompetitorIdentity();
  const unlink = useUnlinkCompetitor();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(identity.label);
  const longArc = isLongArc(identity);

  return (
    <div className="border rounded-lg p-4 space-y-3" data-testid="identity-card">
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
          {longArc && (
            <span
              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500"
              title={`Spans more than ${LONG_ARC_YEARS} years — likely two sailors merged by mistake. Split the misgrouped rows.`}
            >
              <TriangleAlert className="h-3.5 w-3.5" />
              long arc
            </span>
          )}
          <a
            href={`/p/${workspaceSlug}/competitor/${identity.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Career arc
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
            <span className="min-w-0 truncate">
              <span className="tabular-nums text-muted-foreground mr-2">
                {e.year ?? '????'}
              </span>
              {e.seriesName}
            </span>
            <span className="flex items-center gap-3 shrink-0 text-muted-foreground">
              <span className="tabular-nums">{e.sailNumber}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-muted-foreground hover:text-destructive"
                title="Split this entry off — it isn't this competitor"
                disabled={unlink.isPending}
                onClick={() =>
                  unlink.mutate({ id: identity.id, competitorId: e.competitorId })
                }
              >
                <Scissors className="h-3.5 w-3.5" />
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IdentitiesReconcile({ workspaceSlug }: { workspaceSlug: string }) {
  const { data: identities } = useCompetitorIdentities();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const list = identities ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((i) => i.label.toLowerCase().includes(q));
  }, [identities, query]);

  if (identities === undefined) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (identities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No competitor identities yet. Run the reconcile pass to populate them
        from this workspace&rsquo;s series.
      </p>
    );
  }

  const longArcs = identities.filter(isLongArc).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 max-w-xs"
          aria-label="Search competitor identities"
        />
        <span className="text-xs text-muted-foreground shrink-0">
          {identities.length} identities
          {longArcs > 0 && ` · ${longArcs} to review`}
        </span>
      </div>

      <div className="space-y-3">
        {filtered.map((identity) => (
          <IdentityCard
            key={identity.id}
            identity={identity}
            workspaceSlug={workspaceSlug}
          />
        ))}
      </div>
    </div>
  );
}
