'use client';

import { useState, type ReactNode } from 'react';
import { penaltyAmountText } from '@/lib/scoring-codes';
import { ChevronDown } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  stripedRowClass,
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
  formatClubs,
} from '@/lib/competitor-fields';
import type {
  CompetitorFieldKey,
  CustomField,
  Fleet,
  MultiPersonFieldKey,
  PrimaryPersonLabel,
  RaceDiscardPolicy,
  ResultsColumn,
  Standing,
  SubdivisionAxis,
} from '@/lib/types';
import {
  customFieldId,
  scoringColumnShown,
  scoringColumnTitle,
  subdivisionAxisId,
  tableColumns,
  type CompetitorColumnKey,
} from '@/lib/results-columns';
import { lookupCode } from '@/lib/nationality';
import {
  formatMultiplier,
  hasScoringOptions,
  raceMultiplier,
  racePolicy,
  scoringOptionsLegend,
} from '@/lib/race-scoring-options';
import { ordinal } from '@/lib/ordinal';
import { standingsRating, standingsRatingLabel } from '@/lib/competitor-ratings';
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
  /** The series' custom fields; one column each. */
  customFields?: CustomField[];
  /** The series' own results columns. When set the table shows its
   *  standings columns — order, titles and all — so the app shows what will
   *  be published; absent, the app's own automatic layout. */
  resultsColumns?: ResultsColumn[];
  /** Fleet display name, used in the race-column exclusion menu. */
  fleetName?: string;
  /** The fleet the table scores, when it is a real one: a fixed-handicap
   *  fleet's table shows each boat's rating, as the published page does. */
  ratingFleet?: Fleet;
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
  customFields,
  resultsColumns,
  fleetName,
  ratingFleet,
  excludedRaceIds,
  onToggleExclude,
  onExcludeCompetitor,
  excludeCompetitorLabel,
  includedByOverride,
  onClearInclude,
}: FleetStandingsTableProps) {
  const columns = standingsColumns({
    standings,
    enabledFields,
    primaryLabel,
    multiPersonFields,
    subdivisionAxes,
    customFields: customFields ?? [],
    resultsColumns,
  });
  const visibleAxes = columns
    .map((c) => subdivisionAxisId(c.key))
    .flatMap((id) => subdivisionAxes.filter((a) => a.id === id));
  const showTotal = scoringColumnShown({ resultsColumns }, 'total');
  const showNett = hasDiscards && scoringColumnShown({ resultsColumns }, 'nett');
  const ratingLabel = ratingFleet && scoringColumnShown({ resultsColumns }, 'boatRating')
    ? standingsRatingLabel(ratingFleet)
    : null;
  const ratingTitle = scoringColumnTitle(resultsColumns, 'boatRating');
  const ratingOf = (s: Standing) => (ratingFleet ? standingsRating(s.competitor, ratingFleet) : null);
  const totalTitle = scoringColumnTitle(resultsColumns, 'total');
  const nettTitle = scoringColumnTitle(resultsColumns, 'nett');
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
    { id: 'club', compare: (a, b) => compareText(formatClubs(a.competitor.clubs), formatClubs(b.competitor.clubs)) },
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
    { id: 'bowNumber', compare: (a, b) => compareSailNumbers(a.competitor.bowNumber ?? '', b.competitor.bowNumber ?? '') },
    { id: 'entryNumber', compare: (a, b) => compareSailNumbers(a.competitor.entryNumber ?? '', b.competitor.entryNumber ?? '') },
    { id: 'tallyNumber', compare: (a, b) => compareText(a.competitor.tallyNumber, b.competitor.tallyNumber) },
    { id: 'worldSailingId', compare: (a, b) => compareText(a.competitor.worldSailingId, b.competitor.worldSailingId) },
    { id: 'country', compare: (a, b) => compareText(countryName(a.competitor.nationality), countryName(b.competitor.nationality)) },
    ...(customFields ?? []).map(
      (field): SortableColumn<Standing> => ({
        id: `field:${field.id}`,
        compare: (a, b) => compareText(a.competitor.customFields?.[field.id], b.competitor.customFields?.[field.id]),
      }),
    ),
    { id: 'boatRating', compare: (a, b) => compareNumeric(ratingOf(a)?.value, ratingOf(b)?.value) },
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
          {columns.map((column) => (
            <SortableTableHead
              key={column.key}
              columnId={column.sortId}
              sortKeys={sortKeys}
              onSort={handleSort}
              className={cn(headClass, column.headClass)}
            >
              {column.header}
            </SortableTableHead>
          ))}
          {ratingLabel !== null && (
            <SortableTableHead columnId="boatRating" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'justify-end')}>
              {ratingTitle ? titleLines(ratingTitle) : ratingLabel}
            </SortableTableHead>
          )}
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
            const isNotScored = standings.some((s) => s.raceNotScored?.[i]);
            const isAuto = isColumnExcluded && !isManual && !isNotScored;
            // Series-wide identity: within a sub-series R6 might be Race 13.
            const overallNumber = race.overallNumber ?? race.raceNumber;
            const raceTitle = race.name ? `${race.name} (Race ${overallNumber})` : `Race ${overallNumber}`;
            const dateLabel = formatRaceDate(race.date);
            const reason = isManual
              ? 'excluded from this fleet'
              : isNotScored
                ? 'not scored yet — waiting for its course'
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
          {showTotal && (
            <SortableTableHead columnId="total" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'w-20 justify-center')}>{totalTitle ? titleLines(totalTitle) : 'Total'}</SortableTableHead>
          )}
          {showNett && (
            <SortableTableHead columnId="nett" sortKeys={sortKeys} onSort={handleSort} className={cn(headClass, 'w-20 justify-center')}>{nettTitle ? titleLines(nettTitle) : 'Nett'}</SortableTableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {displayStandings.map((standing, index) => (
          <StandingRow
            key={standing.competitor.id}
            index={index}
            standing={standing}
            races={races}
            raceCount={races.length}
            showTotal={showTotal}
            showNett={showNett}
            columns={columns}
            rating={ratingLabel !== null ? (ratingOf(standing)?.display ?? '') : null}
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
  /** Position in the table, for alternate-row shading. */
  index: number;
  standing: Standing;
  races: FleetStandingsTableProps['races'];
  raceCount: number;
  showTotal: boolean;
  showNett: boolean;
  columns: StandingsColumn[];
  /** The boat's rating as printed, or null when the table has no Rating
   *  column. */
  rating: string | null;
  onExcludeCompetitor?: (competitorId: string) => void;
  excludeCompetitorLabel?: string;
  includedByOverride?: ReadonlySet<string>;
  onClearInclude?: (competitorId: string) => void;
}

function StandingRow({
  index,
  standing,
  races,
  raceCount,
  showTotal,
  showNett,
  columns,
  rating,
  onExcludeCompetitor,
  excludeCompetitorLabel,
  includedByOverride,
  onClearInclude,
}: StandingRowProps) {
  const { rank, competitor, racePoints, raceRanks, raceCodes, racePenaltyCodes, racePenaltyOverrides, raceRedressFlags, totalPoints, netPoints, raceDiscards, raceNonDiscardable, raceExcluded } = standing;

  const isFirst = rank === 1;
  const pinnedIn = includedByOverride?.has(competitor.id) ?? false;
  // The sail number opens the entry's menu for an editor.
  const sailCell = (
      <>
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
      </>
  );

  return (
    <TableRow
      className={cn(
        isFirst ? 'bg-primary/[0.06] font-medium' : stripedRowClass(index),
      )}
    >
      {columns.map((column) => (
        <StandingsCell
          key={column.key}
          rank={rank}
          column={column}
          standing={standing}
          sailCell={sailCell}
        />
      ))}
      {rating !== null && <TableCell className="text-right font-mono tabular-nums">{rating}</TableCell>}
      {racePoints.map((points, i) => {
        const isDiscard = raceDiscards[i] ?? false;
        const isNonDiscardable = raceNonDiscardable[i] ?? false;
        const isExcluded = raceExcluded?.[i] ?? false;
        const isNotScored = standing.raceNotScored?.[i] ?? false;
        const code = raceCodes[i];
        const penaltyCode = racePenaltyCodes?.[i] ?? null;
        const penaltyOverride = racePenaltyOverrides?.[i] ?? null;
        const isRedress = raceRedressFlags?.[i] ?? false;
        // Medal-badge the top-three finishers of each race, mirroring the
        // overall Rank column (and the HTML export's td.rank1/2/3). Only clean,
        // non-discarded finishes qualify — coded/penalty/redress cells keep
        // their existing treatment, and discards keep their brackets.
        const raceRank = raceRanks?.[i] ?? null;
        const showRaceMedal =
          raceRank !== null && raceRank <= 3 && !isDiscard;
        const penaltyLabel = penaltyCode
          ? penaltyOverride !== null
            ? `${penaltyCode}(${penaltyAmountText(penaltyCode, penaltyOverride, standing.racePenaltyInPoints?.[i])})`
            : penaltyCode
          : null;
        if (isExcluded) {
          return (
            <TableCell
              key={i}
              className="text-center text-muted-foreground"
              title={
                isNotScored
                  ? 'Not scored yet — this race is waiting for the course its scoring option corrects over'
                  : 'No finishers in this race — excluded from scoring'
              }
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
        const scoreText = isRedress ? (
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
            {points} {code}
          </span>
        ) : penaltyLabel !== null ? (
          <span className="text-xs text-amber-600 dark:text-amber-400" title={`${penaltyCode} penalty applied`}>
            {points} {penaltyLabel}
          </span>
        ) : showRaceMedal ? (
          <RankBadge rank={raceRank} label={points} />
        ) : (
          points
        );
        // A discarded score reads in brackets, as it does on the published
        // page and in Sailwave — struck-through digits are hard to read, which
        // is the whole point of a column of scores. The brackets go round the
        // whole cell, so a discarded coded result reads "(5 DNF)".
        return (
          <TableCell
            key={i}
            title={weightNote}
            className={cn(
              'text-center tabular-nums',
              isDiscard && 'text-muted-foreground bg-muted/50',
            )}
          >
            {isDiscard ? <>({scoreText})</> : scoreText}
          </TableCell>
        );
      })}
      {/* Pad with dashes for races not yet sailed */}
      {Array.from({ length: raceCount - racePoints.length }).map((_, i) => (
        <TableCell key={`empty-${i}`} className="text-center text-muted-foreground">
          —
        </TableCell>
      ))}
      {showTotal && (
        <TableCell
          className={cn(
            'text-center tabular-nums',
            showNett ? 'font-semibold' : 'font-bold text-primary',
          )}
        >
          {totalPoints}
        </TableCell>
      )}
      {showNett && (
        <TableCell className="text-center font-bold text-primary tabular-nums">
          {netPoints}
        </TableCell>
      )}
    </TableRow>
  );
}

/** One competitor column of the in-app standings table. */
interface StandingsColumn {
  key: CompetitorColumnKey;
  /** The sort column it sorts by. */
  sortId: string;
  header: ReactNode;
  headClass?: string;
  pairCrew?: boolean;
  joinNames?: boolean;
  joinCrew?: boolean;
}

/** A title's lines, one above the other. */
function titleLines(title: string): ReactNode {
  const lines = title.split('\n');
  return lines.length === 1 ? title : lines.map((line, i) => <div key={i}>{line}</div>);
}

function countryName(code: string | undefined): string {
  return code ? lookupCode(code)?.name ?? code : '';
}

/** The sort column a competitor column sorts by. */
function sortIdOf(key: CompetitorColumnKey): string {
  const axisId = subdivisionAxisId(key);
  if (axisId != null) return `axis-${axisId}`;
  return key === 'crewName' ? 'crew' : key;
}

const COLUMN_HEAD_CLASS: Partial<Record<CompetitorColumnKey, string>> = {
  rank: 'w-12 justify-center',
  sailNumber: 'w-20',
};

/**
 * The competitor columns of the in-app standings table. A series with its own
 * columns gets them as they publish, so the app shows what the page will.
 * Otherwise the app's long-standing layout: every switched-on field, shown
 * whether or not a boat has a value, with the codes and short headings a
 * working table wants ("Sail no.", "Nat").
 */
function standingsColumns(opts: {
  standings: Standing[];
  enabledFields: CompetitorFieldKey[];
  primaryLabel: PrimaryPersonLabel;
  multiPersonFields?: MultiPersonFieldKey[];
  subdivisionAxes: SubdivisionAxis[];
  customFields: CustomField[];
  resultsColumns?: ResultsColumn[];
}): StandingsColumn[] {
  const { enabledFields, primaryLabel, multiPersonFields, subdivisionAxes, customFields, resultsColumns } = opts;
  if (resultsColumns) {
    const rows = opts.standings.map(({ competitor: c }) => ({
      bowNumber: c.bowNumber,
      entryNumber: c.entryNumber,
      tallyNumber: c.tallyNumber,
      boatName: c.boatName,
      boatClass: c.boatClass,
      helmRole: c.helms,
      owner: c.owners,
      crewNames: c.crewNames,
      clubs: c.clubs,
      nationality: c.nationality,
      worldSailingId: c.worldSailingId,
      subdivisions: c.subdivisions,
      gender: c.gender,
      age: c.age,
      customFields: c.customFields,
    }));
    return tableColumns(
      { enabledCompetitorFields: enabledFields, primaryPersonLabel: primaryLabel, multiPersonFields, subdivisionAxes, customFields, resultsColumns },
      'standings',
      rows,
    ).map((column) => ({
      ...column,
      sortId: sortIdOf(column.key),
      header: titleLines(column.header),
      headClass: COLUMN_HEAD_CLASS[column.key],
    }));
  }
  const on = (k: CompetitorFieldKey) => enabledFields.includes(k);
  const keys: [CompetitorColumnKey, ReactNode][] = [
    ['rank', 'Rank'],
    ['sailNumber', 'Sail no.'],
  ];
  if (on('boatName')) keys.push(['boatName', 'Boat']);
  if (on('boatClass')) keys.push(['boatClass', 'Class']);
  keys.push(['primary', primaryPersonHeader(primaryLabel, multiPersonFields)]);
  if (on('helm') && !isFieldDisabledByPrimary('helm', primaryLabel)) keys.push(['helm', personFieldHeader('helm', multiPersonFields)]);
  if (on('owner') && !isFieldDisabledByPrimary('owner', primaryLabel)) keys.push(['owner', personFieldHeader('owner', multiPersonFields)]);
  if (on('crewName')) keys.push(['crewName', personFieldHeader('crewName', multiPersonFields)]);
  if (on('club')) keys.push(['club', 'Club']);
  // Code-only in the live UI — flags are reserved for HTML exports so the
  // standings page doesn't pull the ~2.5 MB flag dataset into its bundle.
  if (on('nationality')) keys.push(['nationality', 'Nat']);
  if (on('subdivision')) {
    for (const axis of subdivisionAxes) keys.push([`subdivision:${axis.id}`, subdivisionAxisLabel(axis)]);
  }
  if (on('age')) keys.push(['age', 'Age']);
  if (on('gender')) keys.push(['gender', 'Gender']);
  for (const field of customFields) keys.push([`field:${field.id}`, field.label]);
  return keys.map(([key, header]) => ({ key, sortId: sortIdOf(key), header, headClass: COLUMN_HEAD_CLASS[key] }));
}

/** A list of names: one per line, or on one line joined with " & ". */
function nameList(names: string[] | undefined, join?: boolean): ReactNode {
  const list = (names ?? []).filter((n) => n.trim());
  if (join) return list.join(' & ');
  return list.map((n, i) => <div key={i}>{n}</div>);
}

/** One competitor column's cell. */
function StandingsCell({
  column,
  standing,
  rank,
  sailCell,
}: {
  column: StandingsColumn;
  standing: Standing;
  rank: number;
  sailCell: ReactNode;
}) {
  const { competitor } = standing;
  const axisId = subdivisionAxisId(column.key);
  if (axisId != null) return <TableCell>{competitor.subdivisions?.[axisId] ?? ''}</TableCell>;
  const fieldId = customFieldId(column.key);
  if (fieldId != null) return <TableCell>{competitor.customFields?.[fieldId] ?? ''}</TableCell>;
  switch (column.key) {
    case 'rank':
      return (
        <TableCell className="text-center">
          <RankBadge rank={rank} />
        </TableCell>
      );
    case 'sailNumber':
      return <TableCell className="font-mono">{sailCell}</TableCell>;
    case 'bowNumber':
      return <TableCell className="font-mono">{competitor.bowNumber ?? ''}</TableCell>;
    case 'entryNumber':
      return <TableCell className="font-mono">{competitor.entryNumber ?? ''}</TableCell>;
    case 'tallyNumber':
      return <TableCell className="font-mono">{competitor.tallyNumber ?? ''}</TableCell>;
    case 'boatName':
      return <TableCell>{competitor.boatName ?? ''}</TableCell>;
    case 'boatClass':
      return <TableCell>{competitor.boatClass ?? ''}</TableCell>;
    case 'primary': {
      // With an ID on file and no WS ID column, the name links to the World
      // Sailing bio instead.
      const names = competitor.names.filter((n) => n.trim());
      const shown = column.joinNames ? [names.join(' & ')] : names;
      return (
        <TableCell>
          {shown.map((n, i) => (
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
          {column.pairCrew && (
            <div className="text-muted-foreground">{nameList(competitor.crewNames, column.joinCrew)}</div>
          )}
        </TableCell>
      );
    }
    case 'helm':
      return <TableCell>{nameList(competitor.helms, column.joinNames)}</TableCell>;
    case 'owner':
      return <TableCell>{nameList(competitor.owners, column.joinNames)}</TableCell>;
    case 'crewName':
      return <TableCell>{nameList(competitor.crewNames, column.joinNames)}</TableCell>;
    case 'club':
      return <TableCell className="text-muted-foreground">{competitor.clubs.map((c, i) => <div key={i}>{c}</div>)}</TableCell>;
    case 'nationality':
      return <TableCell className="font-mono">{competitor.nationality ?? ''}</TableCell>;
    case 'country':
      return <TableCell>{countryName(competitor.nationality)}</TableCell>;
    case 'worldSailingId':
      return (
        <TableCell className="font-mono">
          {competitor.worldSailingId ? (
            <a
              href={worldSailingProfileUrl(competitor.worldSailingId)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {competitor.worldSailingId}
            </a>
          ) : (
            ''
          )}
        </TableCell>
      );
    case 'age':
      return <TableCell className="tabular-nums">{competitor.age ?? ''}</TableCell>;
    case 'gender':
      return <TableCell>{competitor.gender}</TableCell>;
    case 'fleet':
      return <TableCell />;
  }
  return <TableCell />;
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
