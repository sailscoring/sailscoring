'use client';

import { use, useState } from 'react';
import { useSeriesData } from '@/hooks/use-series-data';
import { getDiscardCount, calculateFleetStandings } from '@/lib/scoring';
import { subdivisionFieldLabel } from '@/lib/competitor-fields';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { Button } from '@/components/ui/button';
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

  const data = useSeriesData(seriesId, { finishes: true, raceStarts: true });

  useShortcuts([
    ...(canPublish
      ? [{ key: 'p', description: 'Publish results', section: 'Standings', handler: () => setShowPublishDialog(true) }]
      : []),
    { key: 'x', description: 'Preview results', section: 'Standings', handler: () => setShowPreviewDialog(true) },
    ...(canFtp
      ? [{ key: 'f', description: 'Upload via FTP', section: 'Standings', handler: () => setShowFtpDialog(true) }]
      : []),
  ]);

  if (data.status !== 'ready') {
    return <SeriesTabFallback status={data.status} />;
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
  const { fleetStandings: fleetResults, circularRedressRaces } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    discardThresholds,
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
  );
  const discardCount = getDiscardCount(races.length, discardThresholds);
  const isSingleFleet = fleets.length <= 1;
  const fleetCountLabel = fleets.length > 1 ? ` · ${fleets.length} fleets` : '';

  const enabledFields = data.enabledFields;
  const subdivisionLabel = subdivisionFieldLabel(series);

  return (
    <div className="space-y-4 overflow-x-auto">
      {circularRedressRaces.length > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Circular redress: two or more boats in{' '}
          {circularRedressRaces.map((n) => `Race ${n}`).join(', ')}{' '}
          have RDG assigned. Assign one result manually to resolve.
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races.length} race{races.length === 1 ? '' : 's'}{fleetCountLabel} · Low Point ·{' '}
          {discardCount > 0
            ? `${discardCount} discard${discardCount > 1 ? 's' : ''}`
            : 'No discards'}{' '}
          · {competitors.length} competitor{competitors.length === 1 ? '' : 's'}
        </p>
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
              races={races}
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

