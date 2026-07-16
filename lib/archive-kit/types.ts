/**
 * As-published archives (ADR-010, #283) — the stored-results shapes.
 *
 * An as-published series carries its results exactly as originally published
 * by whatever engine scored it: structure only where the app needs it (the
 * series rank per row, optionally a per-race rank), display strings
 * everywhere else. Nothing here is ever an input to computation beyond
 * ordering by the ranks it already carries — that contract is the whole
 * point of the regime.
 *
 * Pure types, no imports: shared by the DB schema (`as_published_results`
 * rows are one `AsPublishedFleetResults` per fleet), the ingest format, the
 * public renderer, and the capture parsers. Everything under
 * `lib/archive-kit/` is kept coherent and dependency-light for a future
 * spin-out to `sailscoring/archive-kit`.
 */

/** One table column heading (lead columns before the races, or summary
 *  columns after them — Total / Nett / Elapsed / Corrected / …). */
export interface AsPublishedColumn {
  /** Stable key from the source (e.g. Sailwave's colgroup class); used for
   *  targeted styling, never for computation. */
  key: string;
  label: string;
}

/** One race column heading. */
export interface AsPublishedRaceHeader {
  label: string;
  /** ISO date where the source publishes one. */
  date?: string;
}

/** One race cell, as published. `text` is verbatim (e.g. "5", "(47.0 DNC)",
 *  "1:23:45"); `discard` marks the cells the source showed as discarded;
 *  `rank` is a structured per-race rank where the source states one
 *  unambiguously — optional, display-only data otherwise. */
export interface AsPublishedRaceCell {
  text: string;
  discard?: boolean;
  rank?: number;
}

/** One competitor's row in a fleet's published table. */
export interface AsPublishedRow {
  /** The `competitors` row this line belongs to — the identity spine hangs
   *  off that row exactly as it does for a full-fidelity series. */
  competitorId: string;
  /** Structured series rank — the one number place-consuming features
   *  (career-arc positions, rankings) read. Null when the source ranks the
   *  row not at all (e.g. a DNQ line). */
  rank: number | null;
  /** The rank as published (`"1st"`, `"2="`, `"5"`), for faithful display. */
  rankLabel: string;
  /** Aligned with the fleet's `leadColumns`. */
  leadCells: string[];
  /** Aligned with the fleet's `raceHeaders`. */
  raceCells: AsPublishedRaceCell[];
  /** Aligned with the fleet's `summaryColumns`. */
  summaryCells: string[];
}

/** One row of a per-race detail table — all display strings; `rank` only
 *  where the source states one. */
export interface AsPublishedRaceTableRow {
  /** Linked competitor, where the generator could resolve one (lets a future
   *  surface highlight a sailor's line); purely optional. */
  competitorId?: string;
  rank?: number;
  cells: string[];
}

/** A per-race detail table, as published — where handicap sources carry
 *  elapsed time, handicap, and corrected time per boat. Everything is a
 *  display string: captured, never used to compute. */
export interface AsPublishedRaceTable {
  label: string;
  date?: string;
  caption?: string;
  columns: AsPublishedColumn[];
  rows: AsPublishedRaceTableRow[];
}

/** One fleet's published results — the unit stored per (series, fleet) in
 *  `as_published_results`: the summary standings table, plus optional
 *  per-race detail tables below it. */
export interface AsPublishedFleetResults {
  /** The source's caption line, e.g.
   *  "Sailed: 6, Discards: 1, To count: 5, Entries: 46, Scoring system:
   *  Appendix A". Display-only context. */
  caption?: string;
  leadColumns: AsPublishedColumn[];
  raceHeaders: AsPublishedRaceHeader[];
  summaryColumns: AsPublishedColumn[];
  rows: AsPublishedRow[];
  /** Per-race detail tables, in published order. Optional — scratch sources
   *  often carry everything in the summary cells. */
  raceTables?: AsPublishedRaceTable[];
}

/** One sailor's row in a published season ranking. The subject is a
 *  cross-series identity (referenced by its manifest slug), not a per-series
 *  competitor — a season ranking outlives any one series and can predate
 *  every imported one (ranking-only sailors get manifest entries with no
 *  series rows). A null identity is display-only: the row renders, but
 *  feeds no career arc. */
export interface AsPublishedRankingRow {
  identity: string | null;
  /** Structured rank — what the career arc reads. Null when the source
   *  lists the row unranked. */
  rank: number | null;
  /** The rank as published ("1st", "2="), for faithful display. */
  rankLabel: string;
  /** The sailor's name as printed — the display fallback for rows with no
   *  identity, and the arc's cross-check. */
  name: string;
  leadCells: string[];
  /** Aligned with the table's `eventHeaders` — one column per event, the
   *  ranking analogue of a series table's race columns. */
  eventCells: AsPublishedRaceCell[];
  summaryCells: string[];
}

/** A published season ranking's table — stored whole in
 *  `as_published_rankings.table`, same vocabulary as a fleet's results with
 *  event columns in place of races. */
export interface AsPublishedRankingTable {
  caption?: string;
  leadColumns: AsPublishedColumn[];
  eventHeaders: AsPublishedRaceHeader[];
  summaryColumns: AsPublishedColumn[];
  rows: AsPublishedRankingRow[];
}

/** Provenance of a published ranking — rendered in the public footer. */
export interface AsPublishedRankingSource {
  url?: string;
  capturedAt?: string;
  note?: string;
}
