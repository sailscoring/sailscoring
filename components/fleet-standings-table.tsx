'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SortableTableHead } from '@/components/sortable-table-head';
import {
  comparatorFor,
  compareNumeric,
  compareText,
  sortDirectionFor,
  sortPositionFor,
  toggleSortKey,
  type SortableColumn,
  type SortDirection,
  type SortKey,
} from '@/lib/table-sort';
import { compareSailNumbers } from '@/lib/sail-number-sort';
import { cn } from '@/lib/utils';
import {
  isFieldDisabledByPrimary,
  personFieldHeader,
  primaryPersonHeader,
  subdivisionAxisLabel,
} from '@/lib/competitor-fields';
import type {
  CompetitorFieldKey,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  RaceDiscardPolicy,
  Standing,
  SubdivisionAxis,
} from '@/lib/types';
import {
  formatMultiplier,
  hasScoringOptions,
  raceMultiplier,
  racePolicy,
  scoringOptionsLegend,
} from '@/lib/race-scoring-options';
import { ordinal } from '@/lib/ordinal';
import { worldSailingProfileUrl } from '@/lib/world-sailing';

export interface FleetStandingsTableProps {
  standings: Standing[];
  // Column headers show `raceNumber` (block-local within a sub-series). The
  // exclusion menu/tooltip name the underlying race by `overallNumber` (its
  // series-wide number; defaults to raceNumber) plus `date`/`name`, so a scorer
  // knows "Series B R6" is really "Race 13" before acting on it.
  races: {
    id: string;
    raceNumber: number;
    overallNumber?: number;
    date?: string;
    name?: string | null;
    // Per-race scoring options (#342). Marked in the column header and named
    // in the legend under the table — the cells carry weighted scores, so
    // without the marks the arithmetic would have to be inferred.
    discardPolicy?: RaceDiscardPolicy;
    pointsMultiplier?: number;
  }[];
  hasDiscards: boolean;
  enabledFields: CompetitorFieldKey[];
  primaryLabel: PrimaryPersonLabel;
  /** Person fields opened to multiple names (#316); their headers read
   *  plural. [] = all single. */
  multiPersonFields?: MultiPersonFieldKey[];
  /** Configured subdivision axes; one prize-giving column each. */
  subdivisionAxes: SubdivisionAxis[];
  /** Fleet display name, used in the race-column exclusion menu. */
  fleetName?: string;
  /** Races *manually* struck from this fleet's scoring (`raceFleetExclusions`).
   *  Distinct from the automatic "no entrants" exclusion, which is derived from
   *  the standings themselves. */
  excludedRaceIds?: Set<string>;
  /** Editor-only. When present, each race column header becomes a menu to
   *  strike/restore that race for this fleet. Omitted on read-only and export
   *  renders, so the affordance never appears there. */
  onToggleExclude?: (raceId: string) => void;
  /** Editor-only. When present, each row's sail number becomes a menu that
   *  drops the boat from the active scope — the series, or the sub-series on
   *  screen — as a non-entrant. Omitted on read-only and export renders. */
  onExcludeCompetitor?: (competitorId: string) => void;
  /** The wording for that action, naming the scope: "Exclude from this
   *  sub-series" or "Exclude from the series". */
  excludeCompetitorLabel?: string;
  /** Boats on this table only because a sub-series override keeps them there;
   *  their menu also offers to drop the pin and let the rule decide. */
  includedByOverride?: ReadonlySet<string>;
  onClearInclude?: (competitorId: string) => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** ISO "YYYY-MM-DD" → "24 Jul 2025" without timezone drift. */
function formatRaceDate(iso?: string): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return null;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function FleetStandingsTable({
  standings,
  races,
  hasDiscards,
  enabledFields,
  primaryLabel,
  multiPersonFields,
  subdivisionAxes,
  fleetName,
  excludedRaceIds,
  onToggleExclude,
  onExcludeCompetitor,
  excludeCompetitorLabel,
  includedByOverride,
  onClearInclude,
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
  // Named in words under the table: a column marked "×2" or "*" has to say
  // what it does, or the standings don't add up for anyone checking by hand.
  const optionNotes = races
    .filter((r) => hasScoringOptions(r))
    .map((r) => scoringOptionsLegend(r, `R${r.raceNumber}`))
    .filter(Boolean);

  // Sorting is view state over the rank order the engine produced — the Rank
  // column keeps showing the series rank, so a re-sorted table still reads
  // correctly, and clearing the sort restores the ranking. Race columns join
  // in through their header menu, since their header click opens the menu.
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);
  const joinNames = (ns: string[] | undefined) =>
    (ns ?? []).filter((n) => n.trim()).join(' ');
  const sortColumns: SortableColumn<Standing>[] = [
    { id: 'rank', compare: (a, b) => compareNumeric(a.rank, b.rank) },
    {
      id: 'sailNumber',
      compare: (a, b) => compareSailNumbers(a.competitor.sailNumber, b.competitor.sailNumber),
    },
    { id: 'boatName', compare: (a, b) => compareText(a.competitor.boatName, b.competitor.boatName) },
    { id: 'boatClass', compare: (a, b) => compareText(a.competitor.boatClass, b.competitor.boatClass) },
    { id: 'primary', compare: (a, b) => compareText(joinNames(a.competitor.names), joinNames(b.competitor.names)) },
    { id: 'helm', compare: (a, b) => compareText(joinNames(a.competitor.helms), joinNames(b.competitor.helms)) },
    { id: 'owner', compare: (a, b) => compareText(joinNames(a.competitor.owners), joinNames(b.competitor.owners)) },
    { id: 'crew', compare: (a, b) => compareText(joinNames(a.competitor.crewNames), joinNames(b.competitor.crewNames)) },
    { id: 'club', compare: (a, b) => compareText(a.competitor.club, b.competitor.club) },
    { id: 'nationality', compare: (a, b) => compareText(a.competitor.nationality, b.competitor.nationality) },
    ...visibleAxes.map(
      (axis): SortableColumn<Standing> => ({
        id: `axis-${axis.id}`,
        compare: (a, b) =>
          compareText(a.competitor.subdivisions?.[axis.id], b.competitor.subdivisions?.[axis.id]),
      }),
    ),
    { id: 'age', compare: (a, b) => compareNumeric(a.competitor.age, b.competitor.age) },
    { id: 'gender', compare: (a, b) => compareText(a.competitor.gender, b.competitor.gender) },
    // A race column compares points, with excluded cells blank — past every
    // real score, like any other blank.
    ...races.map(
      (race, i): SortableColumn<Standing> => ({
        id: `race-${race.id}`,
        compare: (a, b) =>
          compareNumeric(
            a.raceExcluded?.[i] ? null : a.racePoints[i],
            b.raceExcluded?.[i] ? null : b.racePoints[i],
          ),
      }),
    ),
    { id: 'total', compare: (a, b) => compareNumeric(a.totalPoints, b.totalPoints) },
    { id: 'nett', compare: (a, b) => compareNumeric(a.netPoints, b.netPoints) },
  ];
  const comparator = comparatorFor(sortKeys, sortColumns);
  const displayStandings = comparator ? [...standings].sort(comparator) : standings;
  const handleSort = (columnId: string, additive: boolean) =>
    setSortKeys((keys) => toggleSortKey(keys, columnId, additive));
  // Menu-driven, so it replaces the stack; picking the active direction again
  // clears it — the menu's equivalent of the header's third click.
  const sortRace = (columnId: string, dir: SortDirection) =>
    setSortKeys((keys) =>
      sortDirectionFor(keys, columnId) === dir ? [] : [{ columnId, dir }],
    );
  // The header row paints itself primary; the sort buttons must keep that
  // colour on hover rather than fall back to the default header treatment.
  const headClass = 'font-semibold hover:text-primary-foreground/80';

  return (
    <>
    <div className="overflow-x-auto rounded-lg border bg-card">
    <Table>
      <TableHeader>
        <TableRow className="bg-primary hover:bg-primary [&>th]:text-primary-foreground [&>th]:font-semibold">
          <SortableTableHead columnId="rank" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'w-12 justify-center')}>Rank</SortableTableHead>
          <SortableTableHead columnId="sailNumber" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'w-20')}>Sail no.</SortableTableHead>
          {showBoat && <SortableTableHead columnId="boatName" sortKeys={sortKeys} onSort={handleSort} className={headClass}>Boat</SortableTableHead>}
          {showClass && <SortableTableHead columnId="boatClass" sortKeys={sortKeys} onSort={handleSort} className={headClass}>Class</SortableTableHead>}
          <SortableTableHead columnId="primary" sortKeys={sortKeys} onSort={handleSort} className={headClass}>{primaryPersonHeader(primaryLabel, multiPersonFields)}</SortableTableHead>
          {showHelm && <SortableTableHead columnId="helm" sortKeys={sortKeys} onSort={handleSort} className={headClass}>{personFieldHeader('helm', multiPersonFields)}</SortableTableHead>}
          {showOwner && <SortableTableHead columnId="owner" sortKeys={sortKeys} onSort={handleSort} className={headClass}>{personFieldHeader('owner', multiPersonFields)}</SortableTableHead>}
          {showCrew && <SortableTableHead columnId="crew" sortKeys={sortKeys} onSort={handleSort} className={headClass}>{personFieldHeader('crewName', multiPersonFields)}</SortableTableHead>}
          {showClub && <SortableTableHead columnId="club" sortKeys={sortKeys} onSort={handleSort} className={headClass}>Club</SortableTableHead>}
          {showNationality && <SortableTableHead columnId="nationality" sortKeys={sortKeys} onSort={handleSort} className={headClass}>Nat</SortableTableHead>}
          {visibleAxes.map((axis) => (
            <SortableTableHead key={axis.id} columnId={`axis-${axis.id}`} sortKeys={sortKeys} onSort={handleSort} className={headClass}>{subdivisionAxisLabel(axis)}</SortableTableHead>
          ))}
          {showAge && <SortableTableHead columnId="age" sortKeys={sortKeys} onSort={handleSort} className={headClass}>Age</SortableTableHead>}
          {showGender && <SortableTableHead columnId="gender" sortKeys={sortKeys} onSort={handleSort} className={headClass}>Gender</SortableTableHead>}
          {races.map((race, i) => {
            // "R4 ×2 *" — the weighting numerically, an asterisk for a race
            // whose discard behaviour differs. Both are spelled out in the
            // legend under the table.
            const multiplier = raceMultiplier(race);
            const label =
              `R${race.raceNumber}` +
              (multiplier !== 1 ? ` ${formatMultiplier(multiplier)}` : '') +
              (racePolicy(race) !== 'normal' ? ' *' : '');
            // Manual strike (raceFleetExclusions) vs the automatic "no entrants"
            // exclusion, which shows up in every standing's raceExcluded flag.
            const isManual = excludedRaceIds?.has(race.id) ?? false;
            const isColumnExcluded = isManual || standings.some((s) => s.raceExcluded?.[i]);
            const isAuto = isColumnExcluded && !isManual;
            // Series-wide identity: within a sub-series R6 might be Race 13.
            const overallNumber = race.overallNumber ?? race.raceNumber;
            const raceTitle = race.name ? `${race.name} (Race ${overallNumber})` : `Race ${overallNumber}`;
            const dateLabel = formatRaceDate(race.date);
            const reason = isManual
              ? 'excluded from this fleet'
              : isAuto
                ? 'no entrants — excluded automatically'
                : null;
            const optionsNote = scoringOptionsLegend(race, raceTitle);
            const headTitle =
              `${raceTitle}${dateLabel ? ` · ${dateLabel}` : ''}${reason ? ` — ${reason}` : ''}` +
              (optionsNote ? ` — ${optionsNote}` : '');
            // The header click is taken — it opens this menu — so the race
            // column's sort lives inside it, for every viewer; only the
            // exclusion toggle stays editor-only.
            const columnId = `race-${race.id}`;
            const dir = sortDirectionFor(sortKeys, columnId);
            const position = sortPositionFor(sortKeys, columnId);
            return (
              <TableHead
                key={race.id}
                className={cn('w-16 text-center', isColumnExcluded && 'line-through opacity-70')}
                aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger
                    title={headTitle}
                    className="mx-auto inline-flex items-center gap-0.5 outline-none hover:underline focus-visible:underline"
                  >
                    {label}
                    {dir && (
                      <span aria-hidden="true" className="opacity-80">
                        {dir === 'asc' ? '▲' : '▼'}
                        {position !== undefined && (
                          <span className="ml-0.5 text-[0.65rem] align-super">{position}</span>
                        )}
                      </span>
                    )}
                    <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center">
                    <DropdownMenuLabel className="font-normal">
                      <span className="font-semibold">{raceTitle}</span>
                      {dateLabel && (
                        <span className="block text-xs text-muted-foreground">{dateLabel}</span>
                      )}
                      {fleetName && (
                        <span className="block text-xs text-muted-foreground">{fleetName}</span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={dir === 'asc'}
                      onSelect={() => sortRace(columnId, 'asc')}
                    >
                      Sort low to high
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={dir === 'desc'}
                      onSelect={() => sortRace(columnId, 'desc')}
                    >
                      Sort high to low
                    </DropdownMenuCheckboxItem>
                    {onToggleExclude && (
                      <>
                        <DropdownMenuSeparator />
                        {isAuto ? (
                          <DropdownMenuItem disabled>No entrants — excluded automatically</DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => onToggleExclude(race.id)}>
                            {isManual ? 'Include in this fleet' : 'Exclude from this fleet'}
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableHead>
            );
          })}
          <SortableTableHead columnId="total" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'w-20 justify-center')}>Total</SortableTableHead>
          {hasDiscards && (
            <SortableTableHead columnId="nett" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'w-20 justify-center')}>Nett</SortableTableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {displayStandings.map((standing) => (
          <StandingRow
            key={standing.competitor.id}
            standing={standing}
            races={races}
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
            onExcludeCompetitor={onExcludeCompetitor}
            excludeCompetitorLabel={excludeCompetitorLabel}
            includedByOverride={includedByOverride}
            onClearInclude={onClearInclude}
          />
        ))}
      </TableBody>
    </Table>
    </div>
    {optionNotes.length > 0 && (
      <p className="text-xs text-muted-foreground" data-testid="race-options-legend">
        {optionNotes.join(' ')}
      </p>
    )}
    </>
  );
}

interface StandingRowProps {
  standing: Standing;
  races: FleetStandingsTableProps['races'];
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
  onExcludeCompetitor?: (competitorId: string) => void;
  excludeCompetitorLabel?: string;
  includedByOverride?: ReadonlySet<string>;
  onClearInclude?: (competitorId: string) => void;
}

function StandingRow({
  standing,
  races,
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
  onExcludeCompetitor,
  excludeCompetitorLabel,
  includedByOverride,
  onClearInclude,
}: StandingRowProps) {
  const { rank, competitor, racePoints, raceRanks, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable, raceExcluded } = standing;

  const isFirst = rank === 1;
  const pinnedIn = includedByOverride?.has(competitor.id) ?? false;

  return (
    <TableRow
      className={cn(
        isFirst ? 'bg-primary/[0.06] font-medium' : 'odd:bg-muted/30',
      )}
    >
      <TableCell className="text-center">
        <RankBadge rank={rank} />
      </TableCell>
      <TableCell className="font-mono">
        {onExcludeCompetitor ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              title={pinnedIn ? 'Kept on this table by an override' : 'Entry options'}
              className="inline-flex items-center gap-0.5 outline-none hover:underline focus-visible:underline"
            >
              {competitor.sailNumber}
              <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="font-normal">
                <span className="font-semibold">{competitor.sailNumber}</span>
                <span className="block text-xs text-muted-foreground">
                  {competitor.names.filter((n) => n.trim()).join(' & ')}
                  {pinnedIn ? ' · included by override' : ''}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {pinnedIn && onClearInclude && (
                <DropdownMenuItem onSelect={() => onClearInclude(competitor.id)}>
                  Stop including — let the rule decide
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => onExcludeCompetitor(competitor.id)}>
                {excludeCompetitorLabel ?? 'Exclude'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          competitor.sailNumber
        )}
      </TableCell>
      {showBoat && <TableCell>{competitor.boatName ?? ''}</TableCell>}
      {showClass && <TableCell>{competitor.boatClass ?? ''}</TableCell>}
      {/* No WS ID column on this table — with an ID on file, the name links
          to the World Sailing bio instead. */}
      <TableCell>
        {competitor.names.filter((n) => n.trim()).map((n, i) => (
          <div key={i}>
            {competitor.worldSailingId ? (
              <a
                href={worldSailingProfileUrl(competitor.worldSailingId)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {n}
              </a>
            ) : (
              n
            )}
          </div>
        ))}
      </TableCell>
      {showHelm && <TableCell>{(competitor.helms ?? []).map((n, i) => <div key={i}>{n}</div>)}</TableCell>}
      {showOwner && <TableCell>{(competitor.owners ?? []).map((n, i) => <div key={i}>{n}</div>)}</TableCell>}
      {showCrew && <TableCell>{(competitor.crewNames ?? []).map((n, i) => <div key={i}>{n}</div>)}</TableCell>}
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
        // A weighted cell shows the score that counts, so the cell says how it
        // got there: "1st × 2 = 2". Coded and redress cells have no place to
        // name, so they carry the multiplier alone.
        const multiplier = raceMultiplier(races[i] ?? {});
        const weightNote =
          multiplier === 1
            ? undefined
            : raceRank !== null
              ? `${ordinal(raceRank)} × ${multiplier} = ${points}`
              : `Counts ×${multiplier}`;
        return (
          <TableCell
            key={i}
            title={weightNote}
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
 * Shared with the cross-series ranking ladder, whose per-series place cells
 * medal the same way.
 */
export function RankBadge({ rank, label }: { rank: number; label?: ReactNode }) {
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
