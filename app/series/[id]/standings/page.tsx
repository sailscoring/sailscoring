'use client';

import { use, useState } from 'react';
import { useRepos } from '@/lib/repos';
import { useSeries } from '@/hooks/use-series';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useRacesBySeries } from '@/hooks/use-races';
import { useFinishesBySeries } from '@/hooks/use-finishes';
import { useRaceStartsByRaces } from '@/hooks/use-race-starts';
import { getDiscardCount, calculateFleetStandings } from '@/lib/scoring';
import type { ScoringRejection } from '@/lib/types';
import { AlertTriangle } from 'lucide-react';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABEL_TEXT,
  isFieldDisabledByPrimary,
} from '@/lib/competitor-fields';
import { exportFleetHtml } from '@/lib/results-export';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BilgePublishDialog } from '@/components/bilge-publish-dialog';
import { FtpUploadDialog } from '@/components/ftp-upload-dialog';
import type { Standing, DiscardThreshold, CompetitorFieldKey, PrimaryPersonLabel, Competitor } from '@/lib/types';



export default function StandingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const repos = useRepos();
  const [showFtpDialog, setShowFtpDialog] = useState(false);
  const [showBilgeDialog, setShowBilgeDialog] = useState(false);

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
              enabledFields={series.enabledCompetitorFields ?? defaultEnabledCompetitorFields()}
              primaryLabel={series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL}
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

function ScoringRejectionsWarning({ rejections, competitors }: { rejections: ScoringRejection[]; competitors: Competitor[] }) {
  const competitorById = new Map(competitors.map((c) => [c.id, c]));
  if (rejections.length === 0) return null;

  function nameOf(r: ScoringRejection): string {
    const c = competitorById.get(r.competitorId);
    return c ? `${c.sailNumber} (${c.name})` : r.competitorId;
  }

  const noRating = rejections.filter((r) => r.reason === 'no_rating');
  const noStartingTcf = rejections.filter((r) => r.reason === 'no_starting_tcf');

  const messages: string[] = [];
  if (noRating.length > 0) {
    messages.push(`${noRating.length} competitor${noRating.length === 1 ? ' lacks' : 's lack'} a rating and cannot be scored: ${noRating.map(nameOf).join(', ')}`);
  }
  if (noStartingTcf.length > 0) {
    messages.push(`${noStartingTcf.length} competitor${noStartingTcf.length === 1 ? ' lacks' : 's lack'} a starting TCF for NHC scoring: ${noStartingTcf.map(nameOf).join(', ')}`);
  }
  if (messages.length === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{messages.join(' · ')}</span>
    </div>
  );
}

function FleetStandingsTable({
  standings,
  races,
  hasDiscards,
  enabledFields,
  primaryLabel,
}: {
  standings: Standing[];
  races: { id: string; raceNumber: number }[];
  hasDiscards: boolean;
  enabledFields: CompetitorFieldKey[];
  primaryLabel: PrimaryPersonLabel;
}) {
  const showBoat = enabledFields.includes('boatName');
  const showClass = enabledFields.includes('boatClass');
  const showHelm = enabledFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel);
  const showOwner = enabledFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel);
  const showCrew = enabledFields.includes('crewName');
  const showClub = enabledFields.includes('club');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12 text-center">Rank</TableHead>
          <TableHead className="w-20">Sail no.</TableHead>
          {showBoat && <TableHead>Boat</TableHead>}
          {showClass && <TableHead>Class</TableHead>}
          <TableHead>{PRIMARY_PERSON_LABEL_TEXT[primaryLabel]}</TableHead>
          {showHelm && <TableHead>Helm</TableHead>}
          {showOwner && <TableHead>Owner</TableHead>}
          {showCrew && <TableHead>Crew</TableHead>}
          {showClub && <TableHead>Club</TableHead>}
          {races.map((race) => (
            <TableHead key={race.id} className="w-16 text-center">
              R{race.raceNumber}
            </TableHead>
          ))}
          <TableHead className="w-20 text-center font-semibold">Total</TableHead>
          {hasDiscards && (
            <TableHead className="w-20 text-center font-semibold">Nett</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {standings.map((standing) => (
          <StandingRow
            key={standing.competitor.id}
            standing={standing}
            raceCount={races.length}
            hasDiscards={hasDiscards}
            showBoat={showBoat}
            showClass={showClass}
            showHelm={showHelm}
            showOwner={showOwner}
            showCrew={showCrew}
            showClub={showClub}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function StandingRow({
  standing,
  raceCount,
  hasDiscards,
  showBoat,
  showClass,
  showHelm,
  showOwner,
  showCrew,
  showClub,
}: {
  standing: Standing;
  raceCount: number;
  hasDiscards: boolean;
  showBoat: boolean;
  showClass: boolean;
  showHelm: boolean;
  showOwner: boolean;
  showCrew: boolean;
  showClub: boolean;
}) {
  const { rank, competitor, racePoints, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable } = standing;

  // Highlight rank 1 row
  const isFirst = rank === 1;

  return (
    <TableRow className={cn(isFirst && 'bg-accent/40')}>
      <TableCell className="text-center">
        {rank === 1 ? (
          <Badge variant="default" className="text-xs">
            1st
          </Badge>
        ) : (
          <span className="text-sm">{rank}</span>
        )}
      </TableCell>
      <TableCell className="font-mono">{competitor.sailNumber}</TableCell>
      {showBoat && <TableCell>{competitor.boatName ?? ''}</TableCell>}
      {showClass && <TableCell>{competitor.boatClass ?? ''}</TableCell>}
      <TableCell>{competitor.name}</TableCell>
      {showHelm && <TableCell>{competitor.helm ?? ''}</TableCell>}
      {showOwner && <TableCell>{competitor.owner ?? ''}</TableCell>}
      {showCrew && <TableCell>{competitor.crewName ?? ''}</TableCell>}
      {showClub && <TableCell className="text-muted-foreground">{competitor.club}</TableCell>}
      {racePoints.map((points, i) => {
        const isDiscard = raceDiscards[i] ?? false;
        const isNonDiscardable = raceNonDiscardable[i] ?? false;
        const code = raceCodes[i];
        const penaltyCode = racePenaltyCodes?.[i] ?? null;
        const penaltyOverride = racePenaltyOverrides?.[i] ?? null;
        const isRedress = raceRedressFlags?.[i] ?? false;
        const penaltyLabel = penaltyCode
          ? penaltyOverride !== null
            ? penaltyCode === 'DPI'
              ? `${penaltyCode}(${penaltyOverride}pts)`
              : `${penaltyCode}(${penaltyOverride}%)`
            : penaltyCode
          : null;
        return (
          <TableCell
            key={i}
            className={cn(
              'text-center tabular-nums',
              isDiscard && 'line-through text-muted-foreground',
            )}
          >
            {isRedress ? (
              <span className="text-xs text-amber-600 dark:text-amber-400">
                RDG({points})
              </span>
            ) : code !== null ? (
              <span
                className={cn(
                  'text-xs',
                  isNonDiscardable
                    ? 'text-destructive font-semibold'
                    : !isDiscard && 'text-muted-foreground',
                )}
                title={isNonDiscardable ? `${code} — cannot be discarded` : undefined}
              >
                {points}
                <span className="ml-0.5">({code})</span>
              </span>
            ) : penaltyLabel !== null ? (
              <span className="text-xs text-amber-600 dark:text-amber-400" title={`${penaltyCode} penalty applied`}>
                {points}
                <span className="ml-0.5">({penaltyLabel})</span>
              </span>
            ) : (
              points
            )}
          </TableCell>
        );
      })}
      {/* Pad with dashes for races not yet sailed */}
      {Array.from({ length: raceCount - racePoints.length }).map((_, i) => (
        <TableCell key={`empty-${i}`} className="text-center text-muted-foreground">
          —
        </TableCell>
      ))}
      <TableCell className="text-center font-semibold tabular-nums">
        {totalPoints}
      </TableCell>
      {hasDiscards && (
        <TableCell className="text-center font-semibold tabular-nums">
          {netPoints}
        </TableCell>
      )}
    </TableRow>
  );
}
