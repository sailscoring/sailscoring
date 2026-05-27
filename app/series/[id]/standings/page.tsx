'use client';

import { use, useState } from 'react';
import { useSeries } from '@/hooks/use-series';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useRacesBySeries } from '@/hooks/use-races';
import { useFinishesBySeries } from '@/hooks/use-finishes';
import { useRaceStartsByRaces } from '@/hooks/use-race-starts';
import { getDiscardCount, calculateFleetStandings } from '@/lib/scoring';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  subdivisionFieldLabel,
} from '@/lib/competitor-fields';
import { Button } from '@/components/ui/button';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';
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
  const [showFtpDialog, setShowFtpDialog] = useState(false);
  const [showPublishDialog, setShowPublishDialog] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);

  const { data: series } = useSeries(seriesId);
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: races } = useRacesBySeries(seriesId);
  const { data: allFinishes } = useFinishesBySeries(
    seriesId,
    (competitors ?? []).map((c) => c.id),
  );
  const { data: allRaceStarts } = useRaceStartsByRaces(
    (races ?? []).map((r) => r.id),
  );

  useGlobalKeyDown((e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')) return;
    if (e.key === 'x') {
      e.preventDefault();
      setShowPreviewDialog(true);
    } else if (e.key === 'f' && has('ftp-upload')) {
      e.preventDefault();
      setShowFtpDialog(true);
    } else if (e.key === 'p') {
      e.preventDefault();
      setShowPublishDialog(true);
    }
  });

  if (
    series === undefined ||
    competitors === undefined ||
    fleets === undefined ||
    races === undefined ||
    allFinishes === undefined ||
    allRaceStarts === undefined
  ) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  if (series === null) {
    return <p className="text-muted-foreground">Series not found.</p>;
  }

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

  const enabledFields = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
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
          <Button size="sm" variant="outline" onClick={() => setShowPublishDialog(true)} title="Publish (p)">
            Publish
          </Button>
          {has('ftp-upload') && (
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
              primaryLabel={series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL}
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
        onPublish={() => {
          setShowPreviewDialog(false);
          setShowPublishDialog(true);
        }}
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

