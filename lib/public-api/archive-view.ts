/**
 * What an as-published archive's pages show, for the published view
 * (ADR-010, ADR-015): each fleet's tables as the source printed them. The
 * archive holds display text and the ranks the source stated, never points,
 * so that is what the API serves.
 */

import type { AsPublishedFleetResults } from '../archive-kit/types';
import type { ArchiveSection, PageView } from './published-view';

export function archiveSection(
  fleetName: string,
  results: AsPublishedFleetResults,
  competitorById: ReadonlyMap<string, { sailNumber: string; name: string }>,
): ArchiveSection {
  return {
    fleetName,
    ...(results.caption ? { caption: results.caption } : {}),
    leadColumns: results.leadColumns.map((c) => c.label),
    races: results.raceHeaders.map((h) => ({ label: h.label, date: h.date ?? null })),
    summaryColumns: results.summaryColumns.map((c) => c.label),
    rows: results.rows.map((row) => {
      const c = competitorById.get(row.competitorId);
      return {
        competitorId: row.competitorId,
        rank: row.rank,
        rankLabel: row.rankLabel,
        competitor: { sailNumber: c?.sailNumber ?? '', names: c?.name ? [c.name] : [] },
        leadCells: row.leadCells,
        raceCells: row.raceCells,
        summaryCells: row.summaryCells,
      };
    }),
    raceTables: (results.raceTables ?? []).map((t) => ({
      label: t.label,
      date: t.date ?? null,
      ...(t.caption ? { caption: t.caption } : {}),
      columns: t.columns.map((c) => c.label),
      rows: t.rows.map((r) => ({
        ...(r.competitorId ? { competitorId: r.competitorId } : {}),
        ...(r.rank != null ? { rank: r.rank } : {}),
        cells: r.cells,
      })),
    })),
  };
}

export function archivePageView(sections: ArchiveSection[]): PageView {
  return { kind: 'archive', sections };
}
