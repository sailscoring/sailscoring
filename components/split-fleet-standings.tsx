'use client';

/**
 * The championship standings table (#328): the combined qualifying table with
 * its provisional cut line, the tiered Gold/Silver/... tables after the split,
 * fleet-tinted race cells, and the legend that reads them.
 *
 * Shared by the two places a championship's standings are looked at — the
 * scorer's Split Fleets page, which owns the workflow around them, and the
 * spectator viewer, which opens a published data file and has no workflow at
 * all (#496). Every affordance the scorer needs is an optional prop, so the
 * viewer renders the same table with none of them.
 *
 * Every stage word comes from `splitFleetWords(config)`: sailing instructions
 * use two vocabularies that share terms for different stages, so writing
 * "qualifying series" or "medal race" into a string here makes the table wrong
 * for half its users.
 */

import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import {
  capitaliseStage,
  fleetColorById,
  provisionalCutIndexes,
  qualifyingRaceCount,
  roundsForStage,
  resolveVocabulary,
  stageRaceLabel,
  type CellScore,
  type SeriesStage,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
  type SplitStandingRow,
} from '@/lib/split-fleets';
import type { CompetitorFieldKey, Fleet } from '@/lib/types';
import { worldSailingProfileUrl } from '@/lib/world-sailing';

/** The stage words this series uses (see `Vocabulary`), plus the two forms
 *  its callers need: `title` for a heading, and each stage's own nouns. */
export function splitFleetWords(config: SplitFleetConfig) {
  const vocab = resolveVocabulary(config);
  return {
    /** Stages 1 and 2 together. */
    series: vocab.seriesName,
    qualifying: vocab.stages.qualifying,
    final: vocab.stages.final,
    medal: vocab.stages.medal,
    title: (stage: SeriesStage) => capitaliseStage(vocab.stages[stage].name),
  };
}

/** A race's label as the notice board writes it, per the series' numbering. */
export function splitFleetRaceLabel(
  data: SplitFleetData,
  stage: SeriesStage,
  n: number,
): string {
  return stageRaceLabel(data.config, stage, n, qualifyingRaceCount(data));
}

export interface FleetMeta {
  label: string;
  color: string;
}

/** fleetId → label/colour, resolved from the fleets, rounds and config. */
export function buildFleetMeta(
  data: SplitFleetData,
  fleets: Fleet[],
): Map<string, FleetMeta> {
  const byId = new Map(fleets.map((f) => [f.id, f]));
  const colors = fleetColorById({ ...data, fleets });
  const meta = new Map<string, FleetMeta>();
  for (const round of data.rounds) {
    round.fleetIds.forEach((fid, i) => {
      const labels =
        round.stage === 'qualifying'
          ? data.config.qualifyingFleets.map((f) => f.label)
          : round.stage === 'final'
            ? data.config.finalFleets.map((f) => f.label)
            : [capitaliseStage(splitFleetWords(data.config).medal.name), 'Last race'];
      meta.set(fid, {
        label: byId.get(fid)?.name ?? labels[i] ?? '?',
        color: colors.get(fid) ?? '#94a3b8',
      });
    });
  }
  return meta;
}

/** The bare fleet marker: a small flat-colour dot, bordered so pale fleet
 *  colours hold up against the cell tint behind it. */
export function FleetDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mr-1 inline-block h-1.5 w-1.5 rounded-full border border-foreground/30 align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

export function FleetChip({ meta, count }: { meta: FleetMeta; count?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{ borderColor: meta.color }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
      {count !== undefined && <span className="text-muted-foreground">{count}</span>}
    </span>
  );
}

export function SplitFleetStandings({
  data,
  fleetMeta,
  standings,
  splitRound,
  enabledFields,
  onPreview,
  entryListPublishable,
  resultsStatus,
}: {
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  standings: SplitStandingRow[];
  splitRound: SplitRound | null;
  enabledFields: CompetitorFieldKey[];
  onPreview?: () => void;
  /** Whether the competitor list can be published. A split-fleet series has no
   *  Standings tab, so this section is the only place publishing is reachable
   *  — including before the first race, when the entry list is the sole page
   *  there is to publish. */
  entryListPublishable?: boolean;
  /** Results-lifecycle surface (the Standings tab is hidden on split-fleet
   *  series, so the chip + finalise affordance live here instead). */
  resultsStatus?: { isFinal: boolean; finalisedAt?: number; onMarkFinal?: () => void };
}) {
  const columns = useMemo(() => {
    const seen = new Map<string, { stage: SeriesStage; n: number }>();
    for (const row of standings) {
      for (const cell of row.cells) {
        seen.set(`${cell.stage}:${cell.stageRaceNumber}`, {
          stage: cell.stage,
          n: cell.stageRaceNumber,
        });
      }
    }
    const order: SeriesStage[] = ['qualifying', 'final', 'medal'];
    return [...seen.values()].sort(
      (a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || a.n - b.n,
    );
  }, [standings]);

  if (columns.length === 0) {
    return (
      <section className="bg-card border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Standings</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Standings appear once the first race is sailed.
          {entryListPublishable && ' The competitor list can be published now.'}
        </p>
        {entryListPublishable && onPreview && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onPreview}>Preview</Button>
          </div>
        )}
      </section>
    );
  }

  // Where the line falls if the series ended now. With a split coming it is
  // the band boundaries; where the fleet is never banded the only cut ever
  // made is into the deciding fleet, so it is drawn there instead — and
  // unlike a band boundary it decides who races again, so it is worth more
  // than a boundary marker. Both stop once the thing they predict has
  // happened: a committed round is a fact, not a projection.
  const medalCut = data.config.medal;
  const unbanded = data.config.split.kind === 'none';
  const medalRound = roundsForStage(data.rounds, 'medal')[0] ?? null;
  const medalRows = standings.filter((r) => r.medal);
  const restRows = standings.filter((r) => !r.medal);
  const cuts = unbanded
    ? medalCut && !medalRound && standings.length > medalCut.size
      ? [medalCut.size - 1]
      : []
    : splitRound
      ? []
      : provisionalCutIndexes(standings.length, data.config.finalFleets.length);
  // Every branch above yields a line only while no deciding fleet has been
  // drawn yet, so the line and the table below never disagree about which
  // rows they are counting.


  // Code-only in the live UI — flags are reserved for the published pages so
  // this view doesn't pull the flag dataset into the bundle.
  const showNationality =
    enabledFields.includes('nationality') &&
    standings.some((r) => r.competitor.nationality);

  // Crew stack under the helm in the name cell rather than taking a column of
  // their own — the race cells are the width this table is fighting for. Club
  // and class each take one. All three follow the Nat rule: enabling the field
  // is not enough, some boat has to have a value, or the table grows a dead
  // column.
  const showClass =
    enabledFields.includes('boatClass') &&
    standings.some((r) => r.competitor.boatClass?.trim());
  const showCrew =
    enabledFields.includes('crewName') &&
    standings.some((r) => r.competitor.crewNames?.some((n) => n.trim()));
  const showClub =
    enabledFields.includes('club') &&
    standings.some((r) => r.competitor.clubs?.some((n) => n.trim()));

  // Pre-split, the combined table carries a Fleet column with the current
  // round's assignment; after the split the per-fleet headings say it.
  const latestRound = splitRound
    ? null
    : ([...data.rounds].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null);
  const currentFleetOf = (row: SplitStandingRow): FleetMeta | null => {
    const fid = latestRound?.fleetIds.find((f) => row.competitor.fleetIds.includes(f));
    return fid ? (fleetMeta.get(fid) ?? null) : null;
  };

  // The legend: one chip per fleet that actually appears in the cells, deduped
  // by label (a later round's fleets reuse the labels under new ids).
  const cellFleetIds = new Set(standings.flatMap((r) => r.cells.map((c) => c.fleetId)));
  const legendLabels = new Set<string>();
  const legendFleets = [...fleetMeta.entries()].filter(
    ([fid, meta]) =>
      cellFleetIds.has(fid) && !legendLabels.has(meta.label) && !!legendLabels.add(meta.label),
  );

  const renderRows = (rows: SplitStandingRow[], withCuts: boolean) =>
    rows.map((row, i) => {
      const cellByKey = new Map(
        row.cells.map((c) => [`${c.stage}:${c.stageRaceNumber}`, c]),
      );
      return (
        <FragmentRow
          key={row.competitor.id}
          config={data.config}
          row={row}
          columns={columns}
          cellByKey={cellByKey}
          fleetMeta={fleetMeta}
          currentFleet={latestRound ? currentFleetOf(row) : undefined}
          showNationality={showNationality}
          showClass={showClass}
          showCrew={showCrew}
          showClub={showClub}
          cutAfter={withCuts && cuts.includes(i)}
          cutLabel={
            withCuts && cuts.includes(i)
              ? `${
                  unbanded
                    ? `${capitaliseStage(splitFleetWords(data.config).medal.fleetNoun)} cut`
                    : `${data.config.finalFleets[cuts.indexOf(i)]?.label} / ${data.config.finalFleets[cuts.indexOf(i) + 1]?.label} cut`
                } if the ${splitFleetWords(data.config).qualifying.name} ended now${
                  // A shared rank across the line: the ranking does not place
                  // this cut, and the line must not pretend it does.
                  rows[i + 1]?.rank === row.rank
                    ? ' — the boats either side are tied; the ranking does not decide this cut'
                    : ''
                }`
              : null
          }
        />
      );
    });

  return (
    <section className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Standings</h2>
          {resultsStatus && (
            <span
              className={
                resultsStatus.isFinal
                  ? 'inline-flex items-center rounded-full border border-green-600/40 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-400'
                  : 'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
              }
              title={
                resultsStatus.isFinal && resultsStatus.finalisedAt
                  ? `Final since ${new Date(resultsStatus.finalisedAt).toLocaleDateString()}`
                  : undefined
              }
              data-testid="results-status-chip"
            >
              {resultsStatus.isFinal ? 'Final results' : 'Provisional'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {resultsStatus?.onMarkFinal && (
            <Button variant="outline" size="sm" onClick={resultsStatus.onMarkFinal}>
              Mark as final
            </Button>
          )}
          {onPreview && (
            <Button variant="outline" size="sm" onClick={onPreview}>Preview</Button>
          )}
        </div>
      </div>
      {legendFleets.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Race cells are marked with the fleet the race was sailed in:
          {legendFleets.map(([fid, meta]) => (
            <FleetChip key={fid} meta={meta} />
          ))}
        </p>
      )}
      <div className="overflow-x-auto">
        {/* The deciding fleet is a table of its own, ahead of everything else
            — the published championship page has always laid it out this way,
            and the scorer's view has to agree with what it publishes. It is
            not presentation either: those boats rank above every other boat
            whatever the points say, so listed together with the rest their
            totals read as out of order. They sail races no other boat holds a
            column in, and where the boats who miss the cut race no more, the
            two groups are not even scored over the same number of races. */}
        {medalRows.length > 0 && (
          <div className="mb-6">
            <h3 className="mb-1 text-sm font-semibold">
              {capitaliseStage(splitFleetWords(data.config).medal.fleetNoun)}
            </h3>
            <StandingsTable data={data} columns={columns} showNationality={showNationality} showClass={showClass} showCrew={showCrew} showClub={showClub}>{renderRows(medalRows, false)}</StandingsTable>
            <p className="mt-1 text-xs text-muted-foreground">
              These boats are ranked ahead of every other boat in the event.
            </p>
          </div>
        )}
        {splitRound ? (
          splitRound.fleetIds.map((fid) => {
            const rows = restRows.filter((r) => r.finalFleetId === fid);
            const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
            if (rows.length === 0) return null;
            return (
              <div key={fid} className="mb-6">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <FleetChip meta={meta} /> fleet
                </h3>
                <StandingsTable data={data} columns={columns} showNationality={showNationality} showClass={showClass} showCrew={showCrew} showClub={showClub}>{renderRows(rows, false)}</StandingsTable>
              </div>
            );
          })
        ) : restRows.length > 0 ? (
          <StandingsTable data={data} columns={columns} showNationality={showNationality} showClass={showClass} showCrew={showCrew} showClub={showClub} showFleet={latestRound !== null}>{renderRows(restRows, true)}</StandingsTable>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        A {splitFleetWords(data.config).qualifying.raceNoun} counts only once every fleet has
        completed it (greyed cells don&rsquo;t count); discarded scores are in
        parentheses.
      </p>
    </section>
  );
}

function StandingsTable({
  data,
  columns,
  showNationality,
  showClass,
  showCrew,
  showClub,
  showFleet,
  children,
}: {
  data: SplitFleetData;
  columns: { stage: SeriesStage; n: number }[];
  showNationality: boolean;
  showClass: boolean;
  showCrew: boolean;
  showClub: boolean;
  showFleet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Rank</th>
          {showFleet && <th className="py-1 pr-2 font-medium">Fleet</th>}
          {showNationality && <th className="py-1 pr-2 font-medium">Nat</th>}
          <th className="py-1 pr-2 font-medium">Sail</th>
          {showClass && <th className="py-1 pr-2 font-medium">Class</th>}
          <th className="py-1 pr-2 font-medium">{showCrew ? 'Name / Crew' : 'Name'}</th>
          {showClub && <th className="py-1 pr-2 font-medium">Club</th>}
          {columns.map((c) => (
            <th key={`${c.stage}:${c.n}`} className="px-1.5 py-1 text-center font-medium">
              {splitFleetRaceLabel(data, c.stage, c.n)}
            </th>
          ))}
          <th className="px-1.5 py-1 text-right font-medium">Total</th>
          <th className="px-1.5 py-1 text-right font-medium">Nett</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function FragmentRow({
  config,
  row,
  columns,
  cellByKey,
  fleetMeta,
  currentFleet,
  showNationality,
  showClass,
  showCrew,
  showClub,
  cutAfter,
  cutLabel,
}: {
  config: SplitFleetConfig;
  row: SplitStandingRow;
  columns: { stage: SeriesStage; n: number }[];
  cellByKey: Map<string, CellScore>;
  fleetMeta: Map<string, FleetMeta>;
  /** The current round's assignment, shown as a Fleet column on the combined
   *  qualifying table. Undefined = no column (post-split, the section heading
   *  names the fleet instead). */
  currentFleet?: FleetMeta | null;
  showNationality: boolean;
  showClass: boolean;
  showCrew: boolean;
  showClub: boolean;
  cutAfter: boolean;
  cutLabel: string | null;
}) {
  const w = splitFleetWords(config);
  return (
    <>
      <tr className="border-t">
        <td className="py-1 pr-2">{row.rank}</td>
        {currentFleet !== undefined && (
          <td className="py-1 pr-2 whitespace-nowrap">
            {currentFleet && <FleetDot color={currentFleet.color} />}
            {currentFleet?.label ?? ''}
          </td>
        )}
        {showNationality && (
          <td className="py-1 pr-2 font-mono text-xs">{row.competitor.nationality ?? ''}</td>
        )}
        <td className="py-1 pr-2 whitespace-nowrap">{row.competitor.sailNumber}</td>
        {showClass && (
          <td className="py-1 pr-2 whitespace-nowrap">{row.competitor.boatClass ?? ''}</td>
        )}
        <td className="py-1 pr-2 whitespace-nowrap">
          {/* No WS ID column on this table — with an ID on file, the name
              links to the World Sailing bio instead. */}
          {row.competitor.worldSailingId ? (
            <a
              href={worldSailingProfileUrl(row.competitor.worldSailingId)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {row.competitor.names.join(' & ')}
            </a>
          ) : (
            row.competitor.names.join(' & ')
          )}
          {row.medal && (
            <span className="ml-1 rounded-full border border-amber-400 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              medal
            </span>
          )}
          {showCrew &&
            (row.competitor.crewNames ?? [])
              .filter((n) => n.trim())
              .map((n, i) => (
                <div key={i} className="text-xs text-muted-foreground">
                  {n}
                </div>
              ))}
        </td>
        {showClub && (
          <td className="py-1 pr-2 text-muted-foreground">
            {(row.competitor.clubs ?? [])
              .filter((c) => c.trim())
              .map((c, i) => (
                <div key={i}>{c}</div>
              ))}
          </td>
        )}
        {columns.map((c) => {
          const cell = cellByKey.get(`${c.stage}:${c.n}`);
          if (!cell) {
            return (
              <td key={`${c.stage}:${c.n}`} className="px-1.5 py-1 text-center text-muted-foreground">
                –
              </td>
            );
          }
          const meta = fleetMeta.get(cell.fleetId);
          const color = meta?.color ?? '#888';
          const text = `${cell.points}${cell.code ? ` ${cell.code}` : ''}`;
          const note = cell.counts
            ? cell.carriedRank
              ? `${capitaliseStage(w.qualifying.name)} position, carried into the ${w.final.name}`
              : cell.carriedTransform
                ? `${capitaliseStage(w.series)} score, compressed and carried into the ${w.medal.name}`
                : undefined
            : cell.carriedTransform
              ? `${capitaliseStage(w.series)} score, compressed — counts once a ${w.medal.raceNoun} is completed`
              : cell.superseded
                ? 'Replaced by the carried score'
                : cell.excludedAsExtra
                  ? `Excluded so every boat has the same number of ${w.qualifying.name} scores`
                  : 'Does not yet count — race incomplete across fleets';
          return (
            <td
              key={`${c.stage}:${c.n}`}
              className={`px-1.5 py-1 text-center text-xs whitespace-nowrap ${
                cell.counts ? '' : 'text-muted-foreground opacity-60'
              }`}
              style={{ backgroundColor: `${color}${cell.counts ? '2e' : '14'}` }}
              title={
                [meta ? `${meta.label} fleet` : null, note].filter(Boolean).join(' — ') ||
                undefined
              }
            >
              {meta && <FleetDot color={color} />}
              {cell.discarded ? `(${text})` : text}
            </td>
          );
        })}
        <td className="px-1.5 py-1 text-right">{row.total}</td>
        <td className="px-1.5 py-1 text-right font-semibold">{row.net}</td>
      </tr>
      {cutAfter && (
        <tr aria-hidden>
          <td
            colSpan={
              columns.length +
              5 +
              (showNationality ? 1 : 0) +
              (showClass ? 1 : 0) +
              (showClub ? 1 : 0) +
              (currentFleet !== undefined ? 1 : 0)
            }
            className="py-0"
          >
            <div className="my-0.5 border-t-2 border-dashed border-amber-400 text-center text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {cutLabel}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
