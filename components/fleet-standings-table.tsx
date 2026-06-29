import type { ReactNode } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  PRIMARY_PERSON_LABEL_TEXT,
  isFieldDisabledByPrimary,
  subdivisionAxisLabel,
} from '@/lib/competitor-fields';
import type {
  CompetitorFieldKey,
  PrimaryPersonLabel,
  Standing,
  SubdivisionAxis,
} from '@/lib/types';

export interface FleetStandingsTableProps {
  standings: Standing[];
  races: { id: string; raceNumber: number }[];
  hasDiscards: boolean;
  enabledFields: CompetitorFieldKey[];
  primaryLabel: PrimaryPersonLabel;
  /** Configured subdivision axes; one prize-giving column each. */
  subdivisionAxes: SubdivisionAxis[];
}

export function FleetStandingsTable({
  standings,
  races,
  hasDiscards,
  enabledFields,
  primaryLabel,
  subdivisionAxes,
}: FleetStandingsTableProps) {
  const showBoat = enabledFields.includes('boatName');
  const showClass = enabledFields.includes('boatClass');
  const showHelm = enabledFields.includes('helm') && !isFieldDisabledByPrimary('helm', primaryLabel);
  const showOwner = enabledFields.includes('owner') && !isFieldDisabledByPrimary('owner', primaryLabel);
  const showCrew = enabledFields.includes('crewName');
  const showClub = enabledFields.includes('club');
  // Code-only in the live UI — flags are reserved for HTML exports so the
  // standings page doesn't pull the ~2.5 MB flag dataset into its bundle.
  const showNationality = enabledFields.includes('nationality');
  const visibleAxes = enabledFields.includes('subdivision') ? subdivisionAxes : [];
  const showAge = enabledFields.includes('age');
  const showGender = enabledFields.includes('gender');
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
    <Table>
      <TableHeader>
        <TableRow className="bg-primary hover:bg-primary [&>th]:text-primary-foreground [&>th]:font-semibold">
          <TableHead className="w-12 text-center">Rank</TableHead>
          <TableHead className="w-20">Sail no.</TableHead>
          {showBoat && <TableHead>Boat</TableHead>}
          {showClass && <TableHead>Class</TableHead>}
          <TableHead>{PRIMARY_PERSON_LABEL_TEXT[primaryLabel]}</TableHead>
          {showHelm && <TableHead>Helm</TableHead>}
          {showOwner && <TableHead>Owner</TableHead>}
          {showCrew && <TableHead>Crew</TableHead>}
          {showClub && <TableHead>Club</TableHead>}
          {showNationality && <TableHead>Nat</TableHead>}
          {visibleAxes.map((axis) => (
            <TableHead key={axis.id}>{subdivisionAxisLabel(axis)}</TableHead>
          ))}
          {showAge && <TableHead>Age</TableHead>}
          {showGender && <TableHead>Gender</TableHead>}
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
            showNationality={showNationality}
            subdivisionAxes={visibleAxes}
            showAge={showAge}
            showGender={showGender}
          />
        ))}
      </TableBody>
    </Table>
    </div>
  );
}

interface StandingRowProps {
  standing: Standing;
  raceCount: number;
  hasDiscards: boolean;
  showBoat: boolean;
  showClass: boolean;
  showHelm: boolean;
  showOwner: boolean;
  showCrew: boolean;
  showClub: boolean;
  showNationality: boolean;
  subdivisionAxes: SubdivisionAxis[];
  showAge: boolean;
  showGender: boolean;
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
  showNationality,
  subdivisionAxes,
  showAge,
  showGender,
}: StandingRowProps) {
  const { rank, competitor, racePoints, raceRanks, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable, raceExcluded } = standing;

  const isFirst = rank === 1;

  return (
    <TableRow
      className={cn(
        isFirst ? 'bg-primary/[0.06] font-medium' : 'odd:bg-muted/30',
      )}
    >
      <TableCell className="text-center">
        <RankBadge rank={rank} />
      </TableCell>
      <TableCell className="font-mono">{competitor.sailNumber}</TableCell>
      {showBoat && <TableCell>{competitor.boatName ?? ''}</TableCell>}
      {showClass && <TableCell>{competitor.boatClass ?? ''}</TableCell>}
      <TableCell>{competitor.name}</TableCell>
      {showHelm && <TableCell>{competitor.helm ?? ''}</TableCell>}
      {showOwner && <TableCell>{competitor.owner ?? ''}</TableCell>}
      {showCrew && <TableCell>{competitor.crewName ?? ''}</TableCell>}
      {showClub && <TableCell className="text-muted-foreground">{competitor.club}</TableCell>}
      {showNationality && <TableCell className="font-mono">{competitor.nationality ?? ''}</TableCell>}
      {subdivisionAxes.map((axis) => (
        <TableCell key={axis.id}>{competitor.subdivisions?.[axis.id] ?? ''}</TableCell>
      ))}
      {showAge && <TableCell className="tabular-nums">{competitor.age ?? ''}</TableCell>}
      {showGender && <TableCell>{competitor.gender}</TableCell>}
      {racePoints.map((points, i) => {
        const isDiscard = raceDiscards[i] ?? false;
        const isNonDiscardable = raceNonDiscardable[i] ?? false;
        const isExcluded = raceExcluded?.[i] ?? false;
        const code = raceCodes[i];
        const penaltyCode = racePenaltyCodes?.[i] ?? null;
        const penaltyOverride = racePenaltyOverrides?.[i] ?? null;
        const isRedress = raceRedressFlags?.[i] ?? false;
        // Medal-badge the top-three finishers of each race, mirroring the
        // overall Rank column (and the HTML export's td.rank1/2/3). Only clean,
        // non-discarded finishes qualify — coded/penalty/redress cells keep
        // their existing treatment, and discards stay struck through.
        const raceRank = raceRanks?.[i] ?? null;
        const showRaceMedal =
          raceRank !== null && raceRank <= 3 && !isDiscard;
        const penaltyLabel = penaltyCode
          ? penaltyOverride !== null
            ? penaltyCode === 'DPI'
              ? `${penaltyCode}(${penaltyOverride}pts)`
              : `${penaltyCode}(${penaltyOverride}%)`
            : penaltyCode
          : null;
        if (isExcluded) {
          return (
            <TableCell
              key={i}
              className="text-center text-muted-foreground"
              title="No finishers in this race — excluded from scoring"
            >
              —
            </TableCell>
          );
        }
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
            ) : showRaceMedal ? (
              <RankBadge rank={raceRank} label={points} />
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
      <TableCell
        className={cn(
          'text-center tabular-nums',
          hasDiscards ? 'font-semibold' : 'font-bold text-primary',
        )}
      >
        {totalPoints}
      </TableCell>
      {hasDiscards && (
        <TableCell className="text-center font-bold text-primary tabular-nums">
          {netPoints}
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * Top-three ranks get a medal-coloured badge; the rest a plain number. The
 * colour is chosen from `rank`, while `label` controls what's shown inside —
 * the overall Rank column shows the rank itself, but per-race cells show the
 * race points (which equal the finishing place for clean finishers).
 */
function RankBadge({ rank, label }: { rank: number; label?: ReactNode }) {
  const content = label ?? rank;
  const medal =
    rank === 1
      ? 'bg-[#d4a72c] text-black'
      : rank === 2
        ? 'bg-[#9ca3af] text-black'
        : rank === 3
          ? 'bg-[#b07a48] text-white'
          : null;
  if (!medal) {
    return (
      <span className="text-sm tabular-nums text-muted-foreground">{content}</span>
    );
  }
  return (
    <span
      data-testid="podium-badge"
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums',
        medal,
      )}
    >
      {content}
    </span>
  );
}
