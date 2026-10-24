/**
 * What a split-fleet championship's pages show, for the published view: the
 * Championship page's ranking and the Race results page's races.
 *
 * Read off the championship engine the pages render from
 * (`splitFleetStandings`), not off the HTML, so the API ranks and scores
 * exactly as the pages do. The ranking is the championship's own order, with
 * each boat's fleet once the fleet has split. The repêchage and cut-from
 * tables the page prints beside it are its own presentation and stay on the
 * page; their races are in the race results.
 */

import {
  assembleSplitFleetData,
  repechageTableRows,
  splitFleetStandings,
  stageRaceLabel,
  type CellScore,
  type SplitStandingRow,
} from '../split-fleets';
import { STAGE_ORDER, type SplitFleetRenderInput } from '../split-fleets-render';
import type { PrimaryPersonLabel } from '../types';
import type { ChampionshipRaceFleet, CompetitorDisplay, PageView } from './published-view';

function displayOf(input: SplitFleetRenderInput, primaryPersonLabel?: PrimaryPersonLabel): CompetitorDisplay {
  return {
    enabledCompetitorFields: input.enabledCompetitorFields ?? [],
    ...(primaryPersonLabel ? { primaryPersonLabel } : {}),
  };
}

export function championshipStandingsView(
  input: SplitFleetRenderInput,
  primaryPersonLabel?: PrimaryPersonLabel,
): Extract<PageView, { kind: 'championship' }> {
  const data = assembleSplitFleetData(input);
  const rows = splitFleetStandings(data);
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const raceById = new Map(data.races.map((r) => [r.id, r]));

  const columnKey = (c: CellScore) => `${c.stage}:${c.stageRaceNumber}`;
  const columnsByKey = new Map<string, { stage: CellScore['stage']; n: number; raceIds: Set<string> }>();
  for (const row of rows) {
    for (const c of row.cells) {
      const key = columnKey(c);
      const col = columnsByKey.get(key) ?? { stage: c.stage, n: c.stageRaceNumber, raceIds: new Set<string>() };
      col.raceIds.add(c.raceId);
      columnsByKey.set(key, col);
    }
  }
  const columns = [...columnsByKey.entries()]
    .sort(([, a], [, b]) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || a.n - b.n)
    .map(([key, col]) => {
      // A stage race several fleets sail is one column of several races, so
      // it has no single race number; a race one fleet sails alone does.
      const races = [...col.raceIds].map((id) => raceById.get(id)).filter((r) => r !== undefined);
      const dates = new Set(races.map((r) => r.date));
      return {
        key,
        label: stageRaceLabel(data.config, col.stage, col.n),
        race: races.length === 1 ? races[0]!.raceNumber : null,
        date: dates.size === 1 ? [...dates][0]! : null,
        name: races.length === 1 ? (races[0]!.name ?? null) : null,
      };
    });

  const fleetOf = (row: SplitStandingRow): string | undefined => {
    const id = row.finalFleetId ?? row.rankedInFleetId;
    return id ? fleetName.get(id) : undefined;
  };

  return {
    kind: 'championship',
    columns,
    display: displayOf(input, primaryPersonLabel),
    rows: rows.map((row) => {
      const fleet = fleetOf(row);
      return {
        competitorId: row.competitor.id,
        rank: row.unranked ? null : row.rank,
        ...(fleet ? { fleet } : {}),
        cells: columns.map((col) => {
          const c = row.cells.find((x) => columnKey(x) === col.key);
          return c
            ? { column: col.key, points: c.points, code: c.code, discarded: c.discarded, counts: c.counts }
            : null;
        }),
        total: row.unranked ? null : row.total,
        net: row.unranked ? null : row.net,
        competitor: row.competitor,
      };
    }),
  };
}

export function championshipRacesView(
  input: SplitFleetRenderInput,
  primaryPersonLabel?: PrimaryPersonLabel,
): Extract<PageView, { kind: 'championship-races' }> {
  const data = assembleSplitFleetData(input);
  const rows = [
    ...splitFleetStandings(data),
    ...repechageTableRows(data).flatMap((t) => t.rows),
  ];
  const fleetName = new Map(data.fleets.map((f) => [f.id, f.name]));
  const raceById = new Map(data.races.map((r) => [r.id, r]));
  const byRaceFleet = new Map<string, ChampionshipRaceFleet>();
  const seen = new Set<string>();
  for (const row of rows) {
    for (const c of row.cells) {
      // A carried score is not a race result, and a boat appearing in two
      // tables is one result.
      if (c.carriedTransform) continue;
      const once = `${c.raceId}\u0000${c.fleetId}\u0000${row.competitor.id}`;
      if (seen.has(once)) continue;
      seen.add(once);
      const race = raceById.get(c.raceId);
      if (!race) continue;
      const key = `${c.raceId}\u0000${c.fleetId}`;
      let entry = byRaceFleet.get(key);
      if (!entry) {
        const start = data.raceStarts.find((s) => s.raceId === c.raceId && s.fleetIds.includes(c.fleetId));
        entry = {
          race: race.raceNumber,
          name: race.name ?? null,
          date: race.date || null,
          fleetName: fleetName.get(c.fleetId) ?? '',
          label: stageRaceLabel(data.config, c.stage, c.stageRaceNumber),
          startTime: start?.startTime ?? null,
          results: [],
        };
        byRaceFleet.set(key, entry);
      }
      entry.results.push({
        competitorId: row.competitor.id,
        competitor: row.competitor,
        points: c.points,
        code: c.code,
      });
    }
  }
  return {
    kind: 'championship-races',
    display: displayOf(input, primaryPersonLabel),
    races: [...byRaceFleet.values()].sort((a, b) => a.race - b.race || a.fleetName.localeCompare(b.fleetName)),
  };
}
