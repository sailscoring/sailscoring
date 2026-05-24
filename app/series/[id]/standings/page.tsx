'use client';

import { use, useState } from 'react';
import * as repos from '@/lib/api-repository';
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
import { exportFleetHtml } from '@/lib/results-export';
import { Button } from '@/components/ui/button';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BilgePublishDialog } from '@/components/bilge-publish-dialog';
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
  const [showFtpDialog, setShowFtpDialog] = useState(false);
  const [showBilgeDialog, setShowBilgeDialog] = useState(false);
  // null = show all subdivisions; a string filters standings to one
  // subdivision for prize-giving (ranks stay the full-fleet ranks).
  const [subdivisionFilter, setSubdivisionFilter] = useState<string | null>(null);

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
      // For single fleet, download immediately. For multi-fleet, 'x' is a no-op
      // (user must pick a fleet from the dropdown — browser blocks multi-download).
      if (isSingleFleet) exportFleetHtml(repos, seriesId, fleets?.[0]?.name ?? '');
    } else if (e.key === 'f') {
      e.preventDefault();
      setShowFtpDialog(true);
    } else if (e.key === 'p') {
      e.preventDefault();
      setShowBilgeDialog(true);
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

  // Subdivision prize-giving filter. Offered only when the field is enabled
  // and at least one competitor carries a value.
  const enabledFields = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const subdivisionLabel = subdivisionFieldLabel(series);
  const subdivisionValues = enabledFields.includes('subdivision')
    ? Array.from(
        new Set(
          competitors
            .map((c) => c.subdivision?.trim())
            .filter((v): v is string => !!v),
        ),
      ).sort((a, b) => a.localeCompare(b))
    : [];
  const showSubdivisionFilter = subdivisionValues.length > 0;
  // Guard against a stale filter pointing at a value no longer present.
  const activeSubdivision =
    subdivisionFilter && subdivisionValues.includes(subdivisionFilter)
      ? subdivisionFilter
      : null;

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
          {showSubdivisionFilter && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  {subdivisionLabel}: {activeSubdivision ?? 'All'} ▾
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSubdivisionFilter(null)}>
                  All
                </DropdownMenuItem>
                {subdivisionValues.map((value) => (
                  <DropdownMenuItem key={value} onClick={() => setSubdivisionFilter(value)}>
                    {value}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowBilgeDialog(true)} title="Publish (p)">
            Publish
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowFtpDialog(true)} title="Upload via FTP (f)">
            Upload via FTP
          </Button>
          {isSingleFleet ? (
            <Button size="sm" onClick={() => exportFleetHtml(repos, seriesId, fleets[0]?.name ?? '')} title="Export HTML (x)">
              Export HTML
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">Export HTML ▾</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {fleets.map((fleet) => (
                  <DropdownMenuItem key={fleet.id} onClick={() => exportFleetHtml(repos, seriesId, fleet.name)}>
                    {fleet.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {fleetResults.map(({ fleet, standings, rejections }) => {
        const hasDiscards = standings.some((s) => s.netPoints !== s.totalPoints);
        // Filter rows for prize-giving but keep the full-fleet rank on each row.
        const visibleStandings = activeSubdivision
          ? standings.filter((s) => (s.competitor.subdivision?.trim() ?? '') === activeSubdivision)
          : standings;
        // Under an active filter, hide fleets that have nobody in this subdivision.
        if (activeSubdivision && visibleStandings.length === 0) return null;
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
              standings={visibleStandings}
              races={races}
              hasDiscards={hasDiscards}
              enabledFields={enabledFields}
              primaryLabel={series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL}
              subdivisionLabel={subdivisionLabel}
            />
          </div>
        );
      })}

      <BilgePublishDialog
        series={series}
        fleets={fleets}
        open={showBilgeDialog}
        onClose={() => setShowBilgeDialog(false)}
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

