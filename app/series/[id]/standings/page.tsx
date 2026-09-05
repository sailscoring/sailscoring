'use client';

import { use, useState } from 'react';
import { useSeriesData } from '@/hooks/use-series-data';
import { useUpdateSeries } from '@/hooks/use-series';
import { useUpdateCompetitorsField } from '@/hooks/use-competitors';
import { useSubSeriesBySeries, useSaveSubSeries } from '@/hooks/use-sub-series';
import {
  getDiscardCount,
  calculateFleetStandings,
  calculateSubSeriesFleetStandings,
  buildRaceFleetExclusionMap,
  resolveEntrants,
  resolveEntryStatuses,
  type EntryResolutionOptions,
  type EntryStatus,
} from '@/lib/scoring';
import { displayCompetitorLabel, subdivisionAxes } from '@/lib/competitor-fields';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useIsSpectator } from '@/components/spectator-context';
import { FinaliseResultsDialog } from '@/components/finalise-results-dialog';
import { PreviewDialog } from '@/components/preview-dialog';
import { PublishDialog } from '@/components/publish-dialog';
import { AsPublishedStandings } from '@/components/as-published-standings';
import { SplitFleetFormat } from '@/components/split-fleet-si';
import {
  buildFleetMeta,
  SplitFleetStandings,
} from '@/components/split-fleet-standings';
import { useSplitFleetState } from '@/hooks/use-split-fleets';
import {
  roundsForStage,
  splitFleetStandings,
  type SplitFleetData,
} from '@/lib/split-fleets';
import {
  FleetStandingsTable,
  type FleetStandingsTableProps,
} from '@/components/fleet-standings-table';
import { ScoringRejectionsWarning } from '@/components/scoring-rejections-warning';
import type { Competitor, DiscardThreshold, Race } from '@/lib/types';



export default function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const { has } = useFeatures();
  const { can } = useWorkspacePermissions();
  // Publishing is a race-day (score) operation. FTP is a destination within the
  // Publish dialog; its server list is credential-bearing, so it demands
  // manage-workspace (a subset of scorers). The dialog opens under `p`.
  const canPublish = can('score');
  const canScore = can('score');
  const canFtp = has('ftp-upload') && can('manage-workspace');
  // Preview asks for no permission — anyone looking at a series may see what
  // its pages would look like. A spectator view is the exception: the reader
  // arrived from those very pages, and rendering them again from a copy with
  // no workspace behind it offers a download and a route to Publish that
  // mean nothing here.
  const spectator = useIsSpectator();
  const updateSeries = useUpdateSeries();
  const saveSubSeries = useSaveSubSeries();
  const updateCompetitorsField = useUpdateCompetitorsField();
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [showFinaliseDialog, setShowFinaliseDialog] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const data = useSeriesData(seriesId, { finishes: true, raceStarts: true });
  const { data: subSeriesList } = useSubSeriesBySeries(seriesId);
  // A championship's standings are the tiered championship table, not one
  // table per round fleet — which is why the scorer's version of this tab is
  // hidden in favour of the Split Fleets page. A spectator has no such page
  // (nor the feature gate behind it), and arrived from the published
  // standings, so the table has to be here. Asked for only where it can
  // matter: a workspace without the gate has no championship to find.
  const splitFleetsPossible = spectator || has('split-fleets');
  const { data: splitState } = useSplitFleetState(seriesId, {
    enabled: splitFleetsPossible,
  });

  // Publish/preview don't exist for an as-published series (ADR-010): its
  // pages are published by the archive ingest, and there's nothing to render.
  const isAsPublished =
    data.status === 'ready' && (data.series.asPublished ?? false);
  useShortcuts([
    ...(canPublish && !isAsPublished
      ? [{ key: 'p', description: 'Publish results', section: 'Standings', handler: () => setShowPublishDialog(true) }]
      : []),
    ...(!isAsPublished && !spectator
      ? [{ key: 'x', description: 'Preview results', section: 'Standings', handler: () => setShowPreviewDialog(true) }]
      : []),
  ]);

  if (
    data.status !== 'ready' ||
    subSeriesList === undefined ||
    (splitFleetsPossible && splitState === undefined)
  ) {
    return <SeriesTabFallback status={data.status === 'missing' ? 'missing' : 'loading'} />;
  }
  const { series, competitors, fleets, races } = data;
  const allFinishes = data.finishes ?? [];
  const allRaceStarts = data.raceStarts ?? [];

  // Results lifecycle: the chip and finalise affordance are feature-gated,
  // but a series already marked final always shows its state — the gate
  // controls the affordances, not the data.
  const isFinal = series.resultsStatus === 'final';
  const showResultsStatus = has('results-status') || isFinal;

  // An as-published series (ADR-010) shows its stored tables — nothing is
  // computed, published, or previewed here.
  if (series.asPublished) {
    return <AsPublishedStandings seriesId={seriesId} />;
  }

  // A split-fleet championship's standings are the championship table: one
  // ranking over the qualifying and final stages, tiered by fleet after the
  // split. The scorer's affordances are left off — publishing a championship
  // lives on its own tab, and a spectator has neither the tab nor the
  // permission behind it.
  if (splitState?.config) {
    const splitData: SplitFleetData = {
      config: splitState.config,
      rounds: splitState.rounds,
      fleets,
      competitors,
      races,
      raceStarts: allRaceStarts,
      finishes: allFinishes,
    };
    return (
      <div className="space-y-4">
        <SplitFleetStandings
          data={splitData}
          fleetMeta={buildFleetMeta(splitData, fleets)}
          standings={splitFleetStandings(splitData)}
          splitRound={roundsForStage(splitState.rounds, 'final')[0] ?? null}
          enabledFields={series.enabledCompetitorFields ?? []}
          {...(showResultsStatus
            ? {
                resultsStatus: {
                  isFinal,
                  ...(series.finalisedAt ? { finalisedAt: series.finalisedAt } : {}),
                },
              }
            : {})}
        />
        {/* How the event is scored, under the standings it produced: the
            follow-up question, not the one the reader came with. */}
        <SplitFleetFormat config={splitState.config} />
      </div>
    );
  }

  if (competitors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No competitors yet. Add competitors to see standings.
      </p>
    );
  }

  if (races.length === 0) {
    // No standings to show, but the entry list (#423) is publishable in exactly
    // this window — before race one, when an event most wants its roster up.
    // Publish and Preview stay reachable for that page alone.
    const canPublishEntryList = has('entry-list');
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          No races yet. Add races and record results to see standings.
          {canPublishEntryList && ' The competitor list can be published now.'}
        </p>
        {canPublishEntryList && (
          <>
            <div className="flex gap-2">
              {canPublish && (
                <Button size="sm" variant="outline" onClick={() => setShowPublishDialog(true)} title="Publish (p)">
                  Publish
                </Button>
              )}
              <Button size="sm" onClick={() => setShowPreviewDialog(true)} title="Preview results (x)">
                Preview
              </Button>
            </div>
            <PreviewDialog
              series={series}
              fleets={fleets}
              open={showPreviewDialog}
              onClose={() => setShowPreviewDialog(false)}
              onPublish={
                canPublish
                  ? () => {
                      setShowPreviewDialog(false);
                      setShowPublishDialog(true);
                    }
                  : undefined
              }
            />
            <PublishDialog
              series={series}
              fleets={fleets}
              open={showPublishDialog}
              onClose={() => setShowPublishDialog(false)}
              canFtp={canFtp}
            />
          </>
        )}
      </div>
    );
  }

  const discardThresholds: DiscardThreshold[] = series.discardThresholds ?? [];
  const proportionalDiscard = series.proportionalDiscard;
  const enabledFields = data.enabledFields;
  const axes = subdivisionAxes(series);
  const isSingleFleet = fleets.length <= 1;
  const fleetCountLabel = fleets.length > 1 ? ` · ${fleets.length} fleets` : '';

  // Sub-series replace the whole-series standings: each block is scored
  // independently, and the tab strip selects which one is shown.
  const hasBlocks = subSeriesList.length > 0;

  let raceLabels: FleetStandingsTableProps['races'];
  let fleetResults: ReturnType<typeof calculateFleetStandings>['fleetStandings'];
  let circularRedressRaces: number[];
  let summary: string;
  let blockTabs: { id: string; name: string }[] = [];
  let effectiveBlockId: string | null = null;
  // The races the standings on screen are scored over — the block's, or all.
  let scopeRaces: Race[] = races;

  if (hasBlocks) {
    const blockResults = calculateSubSeriesFleetStandings(
      subSeriesList,
      fleets,
      competitors,
      races,
      allFinishes,
      discardThresholds,
      series.dnfScoring ?? 'seriesEntries',
      allRaceStarts,
      undefined,
      series.excludeDncOnlyCompetitors ?? false,
      proportionalDiscard,
    );
    const nonEmpty = blockResults.filter((b) => b.races.length > 0);
    blockTabs = nonEmpty.map((b) => ({ id: b.subSeries.id, name: b.subSeries.name }));
    // Default to the block currently being sailed: the last one with any
    // recorded finishes (falling back to the first block).
    const racesWithFinishes = new Set(allFinishes.map((f) => f.raceId));
    const current =
      [...nonEmpty].reverse().find((b) => b.races.some((r) => racesWithFinishes.has(r.id))) ??
      nonEmpty[0];
    const selected =
      nonEmpty.find((b) => b.subSeries.id === selectedBlockId) ?? current;
    if (!selected) {
      return (
        <p className="text-sm text-muted-foreground">
          No races yet. Add races and record results to see standings.
        </p>
      );
    }
    effectiveBlockId = selected.subSeries.id;
    scopeRaces = selected.races;

    // Race columns are numbered within the block — "Spring Race 3", not the
    // series-wide race number. Carry the overall number/date/name so the
    // exclusion menu can name the underlying race (block R6 might be Race 13).
    raceLabels = selected.races.map((r, i) => ({
      id: r.id,
      raceNumber: i + 1,
      overallNumber: r.raceNumber,
      date: r.date,
      name: r.name,
      discardPolicy: r.discardPolicy,
      pointsMultiplier: r.pointsMultiplier,
    }));
    fleetResults = selected.fleetStandings;
    circularRedressRaces = selected.circularRedressRaces;
    const blockDiscards = getDiscardCount(selected.races.length, discardThresholds, proportionalDiscard);
    // The boats this block actually scores — its flag and its overrides
    // applied — so the count agrees with the table beneath it.
    const blockRaceIds = new Set(selected.races.map((r) => r.id));
    const blockCompetitors = selected.subSeries.fleetIds
      ? competitors.filter((c) => c.fleetIds.some((fid) => selected.subSeries.fleetIds!.includes(fid)))
      : competitors;
    const entrantCount = resolveEntrants(
      blockCompetitors,
      selected.races,
      allFinishes.filter((f) => blockRaceIds.has(f.raceId)),
      {
        excludeDncOnlyCompetitors: selected.subSeries.excludeDncOnlyCompetitors ?? false,
        competitorOverrides: selected.subSeries.competitorOverrides,
      },
    ).length;
    // A fleet-scoped block scores fewer fleets than the series; reflect the
    // block's own count, not the series-wide one.
    const blockFleetCount = selected.fleetStandings.filter((fs) => fs.fleet.id !== '__unknown__').length;
    const blockFleetCountLabel = blockFleetCount > 1 ? ` · ${blockFleetCount} fleets` : '';
    summary =
      `${selected.races.length} race${selected.races.length === 1 ? '' : 's'}${blockFleetCountLabel} · Low Point · ` +
      (blockDiscards > 0
        ? `${blockDiscards} discard${blockDiscards > 1 ? 's' : ''}`
        : 'No discards') +
      ` · ${entrantCount} entrant${entrantCount === 1 ? '' : 's'}`;
  } else {
    const whole = calculateFleetStandings(
      fleets,
      competitors,
      races,
      allFinishes,
      discardThresholds,
      series.dnfScoring ?? 'seriesEntries',
      allRaceStarts,
      undefined,
      undefined,
      buildRaceFleetExclusionMap(series.raceFleetExclusions),
      proportionalDiscard,
      { excludeDncOnlyCompetitors: series.excludeDncOnlyCompetitors },
    );
    raceLabels = races;
    fleetResults = whole.fleetStandings;
    circularRedressRaces = whole.circularRedressRaces;
    const discardCount = getDiscardCount(races.length, discardThresholds, proportionalDiscard);
    // The entrants, not the list: an excluded boat is on the roster but is
    // not one of the competitors this table scores.
    const entrantCount = resolveEntrants(competitors, races, allFinishes, {
      excludeDncOnlyCompetitors: series.excludeDncOnlyCompetitors,
    }).length;
    summary =
      `${races.length} race${races.length === 1 ? '' : 's'}${fleetCountLabel} · Low Point · ` +
      (discardCount > 0
        ? `${discardCount} discard${discardCount > 1 ? 's' : ''}`
        : 'No discards') +
      ` · ${entrantCount} competitor${entrantCount === 1 ? '' : 's'}`;
  }

  // Per-fleet race exclusions for the standings on screen. When sub-series take
  // over, the scope is the selected block (writing SubSeries.raceFleetExclusions);
  // otherwise it's the whole series (Series.raceFleetExclusions). Either way the
  // column-header action strikes or restores a race for one fleet the moment a
  // scorer decides it — the same gesture the sub-series editor offers as a grid.
  const activeBlock = hasBlocks
    ? subSeriesList.find((ss) => ss.id === effectiveBlockId)
    : undefined;
  const activeExclusions = hasBlocks
    ? activeBlock?.raceFleetExclusions ?? []
    : series.raceFleetExclusions ?? [];
  // Who is entered in the scope on screen, and who is not and why. The table
  // shows the entrants; the strip below it shows the rest, so a boat the rule
  // or a scorer dropped is never simply missing. In block scope the answers
  // come from the block's own flag and overrides; in whole-series scope the
  // competitor flag and the series' own all-DNC rule apply.
  const scopeRaceIds = new Set(scopeRaces.map((r) => r.id));
  const scopeFinishes = hasBlocks ? allFinishes.filter((f) => scopeRaceIds.has(f.raceId)) : allFinishes;
  const scopeCompetitors = activeBlock?.fleetIds
    ? competitors.filter((c) => c.fleetIds.some((fid) => activeBlock.fleetIds!.includes(fid)))
    : competitors;
  const entryOptions: EntryResolutionOptions = hasBlocks
    ? {
        excludeDncOnlyCompetitors: activeBlock?.excludeDncOnlyCompetitors ?? false,
        competitorOverrides: activeBlock?.competitorOverrides,
      }
    : { excludeDncOnlyCompetitors: series.excludeDncOnlyCompetitors };
  const entryStatuses = resolveEntryStatuses(scopeCompetitors, scopeRaces, scopeFinishes, entryOptions);
  const notShown = scopeCompetitors.filter((c) => !entryStatuses.get(c.id)?.entered);
  const includedByOverride = new Set(
    scopeCompetitors
      .filter((c) => { const st = entryStatuses.get(c.id); return st?.entered && st.via === 'override'; })
      .map((c) => c.id),
  );
  const showCrew = enabledFields.includes('crewName');
  const notShownReason = (st: EntryStatus): string => {
    if (st.entered) return '';
    if (st.via === 'competitor') return 'Excluded from the series';
    if (st.via === 'override') return 'Excluded from this sub-series';
    return hasBlocks
      ? 'No results — not an entrant of this sub-series'
      : 'No results — not an entrant while the series ranks only boats that took part';
  };

  /** Write one boat's pin for the active block: a status, or null to clear it. */
  function setBlockOverride(competitorId: string, status: 'included' | 'excluded' | null) {
    if (!activeBlock) return;
    const rest = (activeBlock.competitorOverrides ?? []).filter((o) => o.competitorId !== competitorId);
    saveSubSeries.mutate({
      ...activeBlock,
      competitorOverrides: status ? [...rest, { competitorId, status }] : rest,
    });
  }
  function excludeCompetitor(competitorId: string) {
    if (hasBlocks) setBlockOverride(competitorId, 'excluded');
    else updateCompetitorsField.mutate({ seriesId, ids: [competitorId], patch: { field: 'excluded', value: true } });
  }
  /** Bring a not-shown boat onto the table. In block scope, clearing an
   *  exclusion pin is enough unless the series flag or the block's rule
   *  would drop the boat again, in which case it needs an include pin. */
  function includeCompetitor(c: Competitor) {
    if (!hasBlocks) {
      updateCompetitorsField.mutate({ seriesId, ids: [c.id], patch: { field: 'excluded', value: false } });
      return;
    }
    const rest = (activeBlock?.competitorOverrides ?? []).filter((o) => o.competitorId !== c.id);
    const unpinned = resolveEntryStatuses([c], scopeRaces, scopeFinishes, { ...entryOptions, competitorOverrides: rest });
    setBlockOverride(c.id, unpinned.get(c.id)?.entered ? null : 'included');
  }
  const canInclude = (st: EntryStatus): boolean => hasBlocks || st.via === 'competitor';

  // Multi-fleet only: striking a race for the sole fleet would just be excluding
  // it outright.
  const canExclude = canScore && !isSingleFleet;
  function toggleExclusion(fleetId: string, raceId: string) {
    const matches = (ex: { raceId: string; fleetId: string }) =>
      ex.raceId === raceId && ex.fleetId === fleetId;
    const toggle = (list: { raceId: string; fleetId: string }[]) =>
      list.some(matches) ? list.filter((ex) => !matches(ex)) : [...list, { raceId, fleetId }];
    if (hasBlocks) {
      if (!activeBlock) return;
      saveSubSeries.mutate({
        ...activeBlock,
        raceFleetExclusions: toggle(activeBlock.raceFleetExclusions ?? []),
      });
    } else {
      updateSeries.mutate({
        id: seriesId,
        patch: (s) => ({ raceFleetExclusions: toggle(s.raceFleetExclusions ?? []) }),
      });
    }
  }

  return (
    <div className="space-y-4">
      {circularRedressRaces.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Circular redress: two or more boats in{' '}
          {circularRedressRaces.map((n) => `Race ${n}`).join(', ')}{' '}
          have RDG assigned. Assign one result manually to resolve.
        </div>
      )}
      {blockTabs.length > 0 && effectiveBlockId && (
        <Tabs value={effectiveBlockId} onValueChange={setSelectedBlockId}>
          <TabsList>
            {blockTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">{summary}</p>
          {showResultsStatus && (
            <span
              className={
                isFinal
                  ? 'inline-flex items-center rounded-full border border-green-600/40 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-400'
                  : 'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
              }
              title={
                isFinal && series.finalisedAt
                  ? `Final since ${new Date(series.finalisedAt).toLocaleDateString()}`
                  : undefined
              }
              data-testid="results-status-chip"
            >
              {isFinal ? 'Final results' : 'Provisional'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {showResultsStatus && canScore && !isFinal && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowFinaliseDialog(true)}
            >
              Mark as final
            </Button>
          )}
          {canPublish && (
            <Button size="sm" variant="outline" onClick={() => setShowPublishDialog(true)} title="Publish (p)">
              Publish
            </Button>
          )}
          {!spectator && (
            <Button size="sm" onClick={() => setShowPreviewDialog(true)} title="Preview results (x)">
              Preview
            </Button>
          )}
        </div>
      </div>

      {fleetResults.map(({ fleet, standings, rejections }) => {
        const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
        // Struck races for this fleet in the active scope (block or series).
        // Shown to every viewer so the strike isn't invisible; the toggle
        // affordance is editor-only.
        const excludedRaceIds = new Set(
          activeExclusions.filter((ex) => ex.fleetId === fleet.id).map((ex) => ex.raceId),
        );
        const isRealFleet = fleet.id !== '__unknown__';
        return (
          <div key={fleet.id} className="space-y-2">
            {!isSingleFleet && (
              <h3 className="text-sm font-semibold pt-2">
                {fleet.name}
                {fleet.scoringSystem !== 'scratch' && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">({fleet.scoringSystem.toUpperCase()})</span>
                )}
              </h3>
            )}
            {isSingleFleet && fleet.scoringSystem !== 'scratch' && (
              <p className="text-xs text-muted-foreground">
                Scored on {fleet.scoringSystem.toUpperCase()} — points based on corrected time.
              </p>
            )}
            {rejections.length > 0 && (
              <ScoringRejectionsWarning rejections={rejections} competitors={competitors} />
            )}
            <FleetStandingsTable
              standings={standings}
              races={raceLabels}
              hasDiscards={hasDiscards}
              enabledFields={enabledFields}
              primaryLabel={data.primaryLabel}
              multiPersonFields={data.series.multiPersonFields}
              subdivisionAxes={axes}
              fleetName={fleet.name}
              excludedRaceIds={excludedRaceIds}
              onToggleExclude={
                canExclude && isRealFleet
                  ? (raceId) => toggleExclusion(fleet.id, raceId)
                  : undefined
              }
              // Not gated on a real fleet: a fleetless series scores its one
              // table under the synthetic Unknown bucket, and excluding a boat
              // names no fleet.
              onExcludeCompetitor={canScore && !spectator ? excludeCompetitor : undefined}
              excludeCompetitorLabel={hasBlocks ? 'Exclude from this sub-series' : 'Exclude from the series'}
              includedByOverride={includedByOverride}
              onClearInclude={hasBlocks ? (id) => setBlockOverride(id, null) : undefined}
            />
          </div>
        );
      })}

      {notShown.length > 0 && (
        <details className="rounded-md border px-4 py-2 text-sm" data-testid="not-shown">
          <summary className="cursor-pointer text-muted-foreground">
            Not shown ({notShown.length}) —{' '}
            {hasBlocks ? 'boats not entered in this sub-series' : 'boats not entered in the series'}
          </summary>
          <ul className="mt-2 space-y-1.5">
            {notShown.map((c) => {
              const st = entryStatuses.get(c.id)!;
              return (
                <li key={c.id} data-testid={`not-shown-${c.sailNumber}`} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 font-mono">{c.sailNumber}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {displayCompetitorLabel(c, { enabledCompetitorFields: enabledFields, showCrew })}
                  </span>
                  <span className="text-xs text-muted-foreground">{notShownReason(st)}</span>
                  {canScore && !spectator && canInclude(st) && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => includeCompetitor(c)}>
                      Include
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <PreviewDialog
        series={series}
        fleets={fleets}
        open={showPreviewDialog}
        onClose={() => setShowPreviewDialog(false)}
        onPublish={
          canPublish
            ? () => {
                setShowPreviewDialog(false);
                setShowPublishDialog(true);
              }
            : undefined
        }
      />
      <PublishDialog
        series={series}
        fleets={fleets}
        open={showPublishDialog}
        onClose={() => setShowPublishDialog(false)}
        canFtp={canFtp}
      />
      <FinaliseResultsDialog
        series={series}
        races={races}
        finishes={allFinishes}
        raceStarts={allRaceStarts}
        open={showFinaliseDialog}
        onClose={() => setShowFinaliseDialog(false)}
      />
    </div>
  );
}
