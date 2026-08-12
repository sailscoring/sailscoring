'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SortableList, DragHandle } from '@/components/ui/sortable-list';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { pickableFleets } from '@/lib/split-fleets';
import { useSubSeriesBySeries } from '@/hooks/use-sub-series';
import { useUpdateSeries } from '@/hooks/use-series';
import { subdivisionAxes, subdivisionAxisLabel } from '@/lib/competitor-fields';
import {
  describeGroupMembers,
  describeGroupSections,
  publishingGroupError,
  resolvePublishingGroups,
  PUBLISHING_GROUP_NAME_MAX_LENGTH,
} from '@/lib/publishing-groups';
import type { Competitor, PublishingGroup, Series } from '@/lib/types';

/**
 * The "Extra pages" card (#255, #390, gated `combined-pages`): define pages
 * that publish alongside the per-fleet ones, assembled from sections. Sections
 * come either from fleets — an all-fleets "Overall" page, or a curated
 * multi-method class page that can replace its members' standalone pages — or
 * from a subdivision axis's values, which is how a Gold/Silver/Bronze page
 * gets published beside the overall standings. Definitions live on the series
 * (`publishingGroups`) and are *reflected* by the Publish dialog, following
 * the sub-series precedent: durable config here, publish/skip there.
 */
export function CombinedPagesCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const updateSeries = useUpdateSeries();
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: subSeriesList } = useSubSeriesBySeries(seriesId);
  // Round-owned fleets (split-fleet ceremonies) never publish their own
  // pages, so they can't be publishing-group members either.
  const fleets = pickableFleets(fleetsData ?? []);
  const [expanded, setExpanded] = useState(false);
  // Name edits are committed on blur/Enter; keep the draft local so typing
  // doesn't round-trip per keystroke.
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string>>({});
  // Same treatment for the race-detail limit: typing "12" passes through "1".
  const [recentDrafts, setRecentDrafts] = useState<Record<string, string>>({});

  const groups = series.publishingGroups ?? [];
  const hasBlocks = (subSeriesList?.length ?? 0) > 0;
  const multiFleet = fleets.length > 1;
  // A race-results series (#347) publishes every page — combined pages
  // included — as race tables alone, so a group's own detail has nothing to
  // say. The radios stay visible but inert rather than vanishing, so the
  // configuration isn't silently discarded when the setting is flipped back.
  const detailOverridden = series.publishDetail === 'races';

  // Axes a page can be sectioned by. Gated on the competitor field being
  // enabled, the same condition under which the values reach a results table
  // at all; how many competitors have filled one in is reported per page
  // rather than hiding the option.
  const axes = (series.enabledCompetitorFields ?? []).includes('subdivision')
    ? subdivisionAxes(series)
    : [];

  function axisLabelFor(axisId: string): string {
    const axis = axes.find((a) => a.id === axisId);
    return axis ? subdivisionAxisLabel(axis) : 'value';
  }

  // A single-fleet series has nothing to combine, but one with divisions can
  // still section its fleet by them. Stay out of the way when neither applies
  // and there's no existing config to surface.
  if (!multiFleet && axes.length === 0 && groups.length === 0) return null;

  const resolved = resolvePublishingGroups(groups, fleets);

  /** The competitors a group's page draws on — its member fleets' entries. */
  function poolFor(group: PublishingGroup): Competitor[] {
    const all = competitors ?? [];
    if (group.fleetMode === 'all') return all;
    return all.filter((c) => c.fleetIds.some((id) => group.fleetIds.includes(id)));
  }

  /** Distinct values of the axis among a group's pool, plus how many of them
   *  carry none — the ones that will appear on no section of the page. */
  function axisValuesFor(group: PublishingGroup, axisId: string): {
    values: string[];
    missing: number;
  } {
    const byKey = new Map<string, string>();
    let missing = 0;
    for (const c of poolFor(group)) {
      const value = c.subdivisions?.[axisId]?.trim();
      if (!value) missing += 1;
      else if (!byKey.has(value.toLowerCase())) byKey.set(value.toLowerCase(), value);
    }
    return { values: [...byKey.values()].sort((a, b) => a.localeCompare(b)), missing };
  }

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
      subdivisionAxes(series),
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

  /** Absent means every race, so clearing the limit drops the key rather than
   *  storing an undefined one. */
  function setRecentRaces(group: PublishingGroup, value: number | undefined) {
    patchGroups((current) =>
      current.map((g) => {
        if (g.id !== group.id) return g;
        const { recentRaces: _cleared, ...rest } = g;
        void _cleared;
        return value == null ? rest : { ...rest, recentRaces: value };
      }),
    );
  }

  function commitRecent(group: PublishingGroup) {
    const draft = recentDrafts[group.id];
    if (draft === undefined) return;
    setRecentDrafts((prev) => {
      const { [group.id]: _committed, ...rest } = prev;
      void _committed;
      return rest;
    });
    const parsed = Number.parseInt(draft, 10);
    // A cleared or nonsense box falls back to what was stored rather than
    // silently turning the limit off.
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(999, Math.max(1, parsed));
    if (next !== group.recentRaces) setRecentRaces(group, next);
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
      ? 'No extra pages.'
      : resolved
          .map((r) => {
            if (r.group.sectionAxisId != null) {
              return `${r.group.name.trim() || '(unnamed)'} (${describeGroupSections(r.group, subdivisionAxes(series))})`;
            }
            const limit =
              r.group.detail === 'full' && r.group.recentRaces != null
                ? `, last ${r.group.recentRaces} races`
                : '';
            return `${r.group.name.trim() || '(unnamed)'} (${describeGroupMembers(r)}${limit})`;
          })
          .join(' · ') +
        (series.publishIndividualFleetPages === false
          ? ' · individual fleet pages off'
          : '');

  const sortedFleets = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4" data-testid="combined-pages-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Extra pages</h2>
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
            An extra page publishes alongside the per-fleet ones. It can carry
            several fleets&apos; results together — an &ldquo;Overall&rdquo;
            page with every fleet&apos;s standings, or a single class page
            covering its scratch and handicap fleets.
            {axes.length > 0 && (
              <>
                {' '}It can instead split one set of results by{' '}
                {axes.map((a) => subdivisionAxisLabel(a)).join(' or ')}, giving
                a table per value — the same scores presented the way a
                division prize-giving reads them.
              </>
            )}
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

                {axes.length > 0 && (
                  <div className="space-y-1.5" data-testid="page-sections">
                    <div
                      role="group"
                      aria-label="Sections on this page"
                      className="inline-flex rounded-md bg-muted p-0.5 text-xs"
                    >
                      {[
                        { id: null, label: 'One per fleet' },
                        ...axes.map((axis) => ({
                          id: axis.id,
                          label: `One per ${subdivisionAxisLabel(axis)}`,
                        })),
                      ].map((option) => {
                        const active = (group.sectionAxisId ?? null) === option.id;
                        return (
                          <button
                            key={option.id ?? 'fleets'}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              if (!active) {
                                patchGroup(group.id, {
                                  sectionAxisId: option.id ?? undefined,
                                });
                              }
                            }}
                            className={`rounded px-2.5 py-1 font-medium transition-colors ${
                              active
                                ? 'bg-background text-foreground shadow-sm'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    {group.sectionAxisId != null &&
                      (() => {
                        const { values, missing } = axisValuesFor(group, group.sectionAxisId);
                        return (
                          <p className="text-xs text-muted-foreground">
                            {values.length > 0
                              ? `A table each for ${values.join(', ')}, ranked 1..n within the ${axisLabelFor(group.sectionAxisId)}.`
                              : `No competitor has a ${axisLabelFor(group.sectionAxisId)} yet, so this page publishes nothing.`}
                            {missing > 0 && (
                              <>
                                {' '}
                                <span className="text-destructive">
                                  {missing} competitor{missing === 1 ? '' : 's'} without a{' '}
                                  {axisLabelFor(group.sectionAxisId)} appear on no table.
                                </span>
                              </>
                            )}
                          </p>
                        );
                      })()}
                  </div>
                )}

                {multiFleet && (
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
                )}

                {group.sectionAxisId != null ? (
                  <p className="text-xs text-muted-foreground">
                    Standings only: the sections share one set of races, so the
                    race tables stay on the fleet&rsquo;s own page.
                  </p>
                ) : (
                <div className="space-y-1">
                  <div
                    className={`flex flex-wrap gap-x-5 gap-y-1${detailOverridden ? ' opacity-50' : ''}`}
                    role="radiogroup"
                    aria-label="Detail level"
                  >
                    {(
                      [
                        ['standings', 'Standings only'],
                        ['full', 'Full per-race detail'],
                      ] as const
                    ).map(([value, label]) => (
                      <label
                        key={value}
                        className={`flex items-center gap-1.5 text-sm ${detailOverridden ? 'cursor-default' : 'cursor-pointer'}`}
                      >
                        <input
                          type="radio"
                          name={`detail-${group.id}`}
                          checked={group.detail === value}
                          disabled={detailOverridden}
                          onChange={() => patchGroup(group.id, { detail: value })}
                          className="h-4 w-4"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {detailOverridden && (
                    <p className="text-xs text-muted-foreground">
                      This series publishes race results only, so this page
                      carries its fleets&rsquo; race tables.
                    </p>
                  )}
                  {group.detail === 'full' && !detailOverridden && (
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center gap-1.5 text-sm">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={group.recentRaces != null}
                            onChange={(e) => setRecentRaces(group, e.target.checked ? 6 : undefined)}
                            className="h-4 w-4"
                          />
                          Show only the last
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={999}
                          value={recentDrafts[group.id] ?? String(group.recentRaces ?? 6)}
                          disabled={group.recentRaces == null}
                          aria-label="Races of detail to publish"
                          className="h-7 w-16 text-sm"
                          onChange={(e) =>
                            setRecentDrafts((prev) => ({ ...prev, [group.id]: e.target.value }))
                          }
                          onBlur={() => commitRecent(group)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitRecent(group);
                            }
                          }}
                        />
                        <span>races&rsquo; results</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        For a page embedded in a fixed-height frame, where a
                        long series runs past the space. The standings still
                        cover the whole series.
                      </p>
                    </div>
                  )}
                </div>
                )}

              </div>
            );
            }}
          </SortableList>

          {resolved.length > 0 && (
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={series.publishIndividualFleetPages ?? true}
                onChange={(e) =>
                  updateSeries.mutate({
                    id: seriesId,
                    patch: {
                      publishIndividualFleetPages: e.target.checked,
                      lastModifiedAt: Date.now(),
                    },
                  })
                }
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Publish individual per-fleet pages
                <span className="block text-xs text-muted-foreground">
                  Untick to publish only the pages above. A fleet that
                  isn&apos;t on any of them isn&apos;t published at all.
                </span>
              </span>
            </label>
          )}

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
