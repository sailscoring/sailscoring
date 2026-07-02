'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SortableList, DragHandle } from '@/components/ui/sortable-list';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useSubSeriesBySeries } from '@/hooks/use-sub-series';
import { useUpdateSeries } from '@/hooks/use-series';
import {
  describeGroupMembers,
  publishingGroupError,
  resolvePublishingGroups,
  PUBLISHING_GROUP_NAME_MAX_LENGTH,
} from '@/lib/publishing-groups';
import type { PublishingGroup, Series } from '@/lib/types';

/**
 * The "Combined pages" card (#255, gated `combined-pages`): define pages that
 * publish several fleets' results as sections of one document — an all-fleets
 * "Overall" page, or a curated multi-method class page that can replace its
 * members' standalone pages. Definitions live on the series
 * (`publishingGroups`) and are *reflected* by the Publish dialog, following
 * the sub-series precedent: durable config here, publish/skip there.
 */
export function CombinedPagesCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const updateSeries = useUpdateSeries();
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const { data: subSeriesList } = useSubSeriesBySeries(seriesId);
  const fleets = fleetsData ?? [];
  const [expanded, setExpanded] = useState(false);
  // Name edits are committed on blur/Enter; keep the draft local so typing
  // doesn't round-trip per keystroke.
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});

  const groups = series.publishingGroups ?? [];
  const hasBlocks = (subSeriesList?.length ?? 0) > 0;
  const multiFleet = fleets.length > 1;

  // A single-fleet series has nothing to combine; stay out of the way unless
  // there's existing config to surface.
  if (!multiFleet && groups.length === 0) return null;

  const resolved = resolvePublishingGroups(groups, fleets);

  function patchGroups(update: (current: PublishingGroup[]) => PublishingGroup[]) {
    updateSeries.mutate({
      id: seriesId,
      patch: (current) => ({
        publishingGroups: update(current.publishingGroups ?? []),
        lastModifiedAt: Date.now(),
      }),
    });
  }

  function patchGroup(id: string, changes: Partial<PublishingGroup>) {
    patchGroups((current) =>
      current.map((g) => (g.id === id ? { ...g, ...changes } : g)),
    );
  }

  function addGroup() {
    const defaultName = groups.some((g) => g.name.trim().toLowerCase() === 'overall')
      ? ''
      : 'Overall';
    patchGroups((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: defaultName,
        fleetMode: 'all',
        fleetIds: [],
        detail: 'standings',
        publishMembersIndividually: true,
      },
    ]);
    setExpanded(true);
  }

  function commitName(group: PublishingGroup) {
    const draft = nameDrafts[group.id];
    if (draft === undefined) return;
    const name = draft.trim();
    const candidate = { ...group, name };
    const error = publishingGroupError(
      candidate,
      groups.map((g) => (g.id === group.id ? candidate : g)),
      fleets,
    );
    // Membership errors are shown by the fleet picker; only block on name
    // problems here so a name edit isn't held hostage by an empty selection.
    const nameError = error && !/at least one fleet/i.test(error) ? error : '';
    setNameErrors((prev) => ({ ...prev, [group.id]: nameError }));
    if (nameError) return;
    if (name !== group.name) patchGroup(group.id, { name });
    setNameDrafts((prev) => {
      const { [group.id]: _committed, ...rest } = prev;
      void _committed;
      return rest;
    });
  }

  function toggleMember(group: PublishingGroup, fleetId: string) {
    const next = group.fleetIds.includes(fleetId)
      ? group.fleetIds.filter((id) => id !== fleetId)
      : [...group.fleetIds, fleetId];
    patchGroup(group.id, { fleetIds: next });
  }

  // Stored array order is display order everywhere downstream — the publish
  // dialog rows, the built page list, and the public series index.
  function reorderGroups(orderedIds: string[]) {
    patchGroups((current) => {
      const byId = new Map(current.map((g) => [g.id, g]));
      const next = orderedIds
        .map((id) => byId.get(id))
        .filter((g): g is PublishingGroup => !!g);
      // Keep any group the drag didn't know about (a concurrent add).
      for (const g of current) {
        if (!orderedIds.includes(g.id)) next.push(g);
      }
      return next;
    });
  }

  const summary =
    groups.length === 0
      ? 'No combined pages.'
      : resolved
          .map((r) => `${r.group.name.trim() || '(unnamed)'} (${describeGroupMembers(r)})`)
          .join(' · ');

  const sortedFleets = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4" data-testid="combined-pages-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Combined pages</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>

      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            A combined page publishes several fleets&apos; results together on
            one page — for example an &ldquo;Overall&rdquo; page with every
            fleet&apos;s standings, or a single class page covering its scratch
            and handicap fleets.
            {hasBlocks && (
              <>
                {' '}This series has sub-series, so each sub-series gets its
                own combined page covering these fleets within it.
              </>
            )}
          </p>

          <SortableList
            items={resolved.map((r) => ({ id: r.group.id, group: r.group }))}
            onReorder={reorderGroups}
          >
            {({ group }, { ref, style, handleProps }) => {
            const nameValue = nameDrafts[group.id] ?? group.name;
            const nameError = nameErrors[group.id];
            const chosen = group.fleetMode === 'chosen';
            return (
              <div
                ref={ref}
                style={style}
                className="border rounded-md p-3 space-y-3"
                data-testid="combined-page-row"
              >
                <div className="flex items-center gap-2">
                  <DragHandle
                    {...handleProps}
                    data-testid={`combined-page-drag-${group.id}`}
                  />
                  <Input
                    value={nameValue}
                    maxLength={PUBLISHING_GROUP_NAME_MAX_LENGTH}
                    placeholder="Page name, e.g. Overall"
                    aria-label="Combined page name"
                    className={`h-8 text-sm${nameError ? ' border-destructive' : ''}`}
                    onChange={(e) => {
                      setNameDrafts((prev) => ({ ...prev, [group.id]: e.target.value }));
                      setNameErrors((prev) => ({ ...prev, [group.id]: '' }));
                    }}
                    onBlur={() => commitName(group)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitName(group);
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-1.5 text-destructive/70 hover:text-destructive shrink-0"
                    onClick={() => patchGroups((current) => current.filter((g) => g.id !== group.id))}
                    title="Remove combined page"
                    aria-label={`Remove ${group.name.trim() || 'combined page'}`}
                  >
                    ×
                  </Button>
                </div>
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}

                <div className="space-y-1.5">
                  <div
                    role="group"
                    aria-label="Fleets on this page"
                    className="inline-flex rounded-md bg-muted p-0.5 text-xs"
                  >
                    {(
                      [
                        ['all', 'All fleets'],
                        ['chosen', 'Choose fleets'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={group.fleetMode === value}
                        onClick={() => {
                          if (group.fleetMode !== value) patchGroup(group.id, { fleetMode: value });
                        }}
                        className={`rounded px-2.5 py-1 font-medium transition-colors ${
                          group.fleetMode === value
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {chosen && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pl-0.5">
                      {sortedFleets.map((f) => (
                        <label key={f.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={group.fleetIds.includes(f.id)}
                            onChange={() => toggleMember(group, f.id)}
                            className="h-4 w-4"
                          />
                          {f.name}
                        </label>
                      ))}
                    </div>
                  )}
                  {chosen && group.fleetIds.length === 0 && (
                    <p className="text-xs text-destructive">Choose at least one fleet.</p>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-5 gap-y-1" role="radiogroup" aria-label="Detail level">
                  {(
                    [
                      ['standings', 'Standings only'],
                      ['full', 'Full per-race detail'],
                    ] as const
                  ).map(([value, label]) => (
                    <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={`detail-${group.id}`}
                        checked={group.detail === value}
                        onChange={() => patchGroup(group.id, { detail: value })}
                        className="h-4 w-4"
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={group.publishMembersIndividually}
                    onChange={(e) =>
                      patchGroup(group.id, { publishMembersIndividually: e.target.checked })
                    }
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Also publish each fleet as its own page
                    <span className="block text-xs text-muted-foreground">
                      Untick to publish these fleets only through this combined
                      page — their standalone pages are taken down on the next
                      publish.
                    </span>
                  </span>
                </label>
              </div>
            );
            }}
          </SortableList>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={addGroup}>
              + Add combined page
            </Button>
            <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
