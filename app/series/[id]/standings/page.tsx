'use client';

import { use, useState } from 'react';
import { useSeriesData } from '@/hooks/use-series-data';
import { useSubSeriesBySeries } from '@/hooks/use-sub-series';
import {
  getDiscardCount,
  calculateFleetStandings,
  calculateSubSeriesFleetStandings,
  subSeriesEntrantIds,
} from '@/lib/scoring';
import { subdivisionFieldLabel } from '@/lib/competitor-fields';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { PreviewDialog } from '@/components/preview-dialog';
import { PublishDialog } from '@/components/publish-dialog';
import { FtpUploadDialog } from '@/components/ftp-upload-dialog';
import { FleetStandingsTable } from '@/components/fleet-standings-table';
import { ScoringRejectionsWarning } from '@/components/scoring-rejections-warning';
import type { DiscardThreshold } from '@/lib/types';



export default function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const { has } = useFeatures();
  const { can } = useWorkspacePermissions();
  // Publishing is a race-day (score) operation; the FTP dialog reads the
  // credential-bearing server list, which demands manage-workspace.
  const canPublish = can('score');
  const canFtp = has('ftp-upload') && can('manage-workspace');
  const [showFtpDialog, setShowFtpDialog] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const data = useSeriesData(seriesId, { finishes: true, raceStarts: true });
  const { data: subSeriesList } = useSubSeriesBySeries(seriesId);

  useShortcuts([
    ...(canPublish
      ? [{ key: 'p', description: 'Publish results', section: 'Standings', handler: () => setShowPublishDialog(true) }]
      : []),
    { key: 'x', description: 'Preview results', section: 'Standings', handler: () => setShowPreviewDialog(true) },
    ...(canFtp
      ? [{ key: 'f', description: 'Upload via FTP', section: 'Standings', handler: () => setShowFtpDialog(true) }]
      : []),
  ]);

  if (data.status !== 'ready' || subSeriesList === undefined) {
    return <SeriesTabFallback status={data.status === 'missing' ? 'missing' : 'loading'} />;
  }
  const { series, competitors, fleets, races } = data;
  const allFinishes = data.finishes ?? [];
  const allRaceStarts = data.raceStarts ?? [];

  if (competitors.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No competitors yet. Add competitors to see standings.
      </p>
    );
  }

  if (races.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No races yet. Add races and record results to see standings.
      </p>
    );
  }

  const discardThresholds: DiscardThreshold[] = series.discardThresholds ?? [];
  const enabledFields = data.enabledFields;
  const subdivisionLabel = subdivisionFieldLabel(series);
  const isSingleFleet = fleets.length <= 1;
  const fleetCountLabel = fleets.length > 1 ? ` · ${fleets.length} fleets` : '';

  // Sub-series replace the whole-series standings: each block is scored
  // independently, and the tab strip selects which one is shown.
  const hasBlocks = subSeriesList.length > 0;

  let raceLabels: { id: string; raceNumber: number }[];
  let fleetResults: ReturnType<typeof calculateFleetStandings>['fleetStandings'];
  let circularRedressRaces: number[];
  let summary: string;
  let blockTabs: { id: string; name: string }[] = [];
  let effectiveBlockId: string | null = null;

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

    // Race columns are numbered within the block — "Spring Race 3", not the
    // series-wide race number.
    raceLabels = selected.races.map((r, i) => ({ id: r.id, raceNumber: i + 1 }));
    fleetResults = selected.fleetStandings;
    circularRedressRaces = selected.circularRedressRaces;
    const blockDiscards = getDiscardCount(selected.races.length, discardThresholds);
    const entrantCount = subSeriesEntrantIds(selected.races, allFinishes).size;
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
    );
    raceLabels = races;
    fleetResults = whole.fleetStandings;
    circularRedressRaces = whole.circularRedressRaces;
    const discardCount = getDiscardCount(races.length, discardThresholds);
    summary =
      `${races.length} race${races.length === 1 ? '' : 's'}${fleetCountLabel} · Low Point · ` +
      (discardCount > 0
        ? `${discardCount} discard${discardCount > 1 ? 's' : ''}`
        : 'No discards') +
      ` · ${competitors.length} competitor${competitors.length === 1 ? '' : 's'}`;
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
        <p className="text-sm text-muted-foreground">{summary}</p>
        <div className="flex gap-2">
          {canPublish && (
            <Button size="sm" variant="outline" onClick={() => setShowPublishDialog(true)} title="Publish (p)">
              Publish
            </Button>
          )}
          {canFtp && (
            <Button size="sm" variant="outline" onClick={() => setShowFtpDialog(true)} title="Upload via FTP (f)">
              Upload via FTP
            </Button>
          )}
          <Button size="sm" onClick={() => setShowPreviewDialog(true)} title="Preview results (x)">
            Preview
          </Button>
        </div>
      </div>

      {fleetResults.map(({ fleet, standings, rejections }) => {
        const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
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
              subdivisionLabel={subdivisionLabel}
            />
          </div>
        );
      })}

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
      />
      <FtpUploadDialog
        series={series}
        fleets={fleets}
        open={showFtpDialog}
        onClose={() => setShowFtpDialog(false)}
      />
    </div>
  );
}
