/**
 * Sailwave capture → archive ingest document (ADR-010, #283). Turns parsed
 * summary sections (`sailwave-html.ts`) into an `ArchiveSeriesDoc`: fleet
 * tables verbatim, competitors extracted from the well-known Sailwave column
 * classes (sail number, helm, club, nationality, age, sex), every id minted
 * deterministically so re-generation updates in place.
 *
 * Generator-side only; the archive repos drive this from their own config.
 */

import { normalizePersonName } from '@/lib/competitor-identity-match';

import { isPiiKey } from './blw-scrub';
import { archiveSeriesDocSchema, type ArchiveSeriesDoc, raceTableRowRank } from './format';
import { competitorIdFor, fleetIdFor } from './ids';
import {
  parseRankLabel,
  type SailwaveColumn,
  type SailwaveRaceSection,
  type SailwaveSummaryRow,
  type SailwaveSummarySection,
} from './sailwave-html';
import type { AsPublishedRaceTable } from './types';

/** One fleet of the series being built: a parsed summary section plus its
 *  pinned public sub-path, and optionally the race sections that follow it.
 *  `subPath` is omitted when the fleet publishes only as a section of a
 *  combined page (see `combinedPages`). */
export interface SailwaveFleetInput {
  name: string;
  subPath?: string;
  summary: SailwaveSummarySection;
  races?: SailwaveRaceSection[];
  /** Publish the race tables alone — a single-race event (#347). The summary
   *  rows are still built: the identity spine reads them. */
  detail?: 'races';
  /** This fleet's summary was synthesised from its race tables by
   *  `summaryFromRaceTables` — the source published a race result and no
   *  standings at all. Its race-table rows are the very lines the competitor
   *  rows were built from, so they carry the competitor link; a fleet whose
   *  standings came from a summary table leaves that link unset, where it
   *  would be a fresh guess rather than a fact. */
  rowsFromRaceTables?: true;
  /** This table is a second presentation of racing another fleet already
   *  accounts for (#363) — the Gold/Silver/Bronze split of a result also
   *  published as one overall standing. Its rows reuse the structural fleets'
   *  competitor rows rather than minting their own, so a sailor is one
   *  competitor with one place however many times the club published them. */
  displayOnly?: true;
}

/** A combined page grouping several of the series' fleets (by name) as
 *  sections of one published page (#321). */
export interface SailwaveCombinedPageInput {
  subPath: string;
  name: string;
  fleetNames: string[];
}

export interface SailwaveDocInput {
  seriesId: string;
  /** Which engine published the capture; 'sailwave' unless the generator
   *  autodetected a Sail100 page. */
  source?: 'sailwave' | 'sail100';
  name: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  eventUrl?: string;
  venueUrl?: string;
  venueLogoUrl?: string;
  eventLogoUrl?: string;
  /** Initial category filing on first ingest (e.g. the season year). */
  category?: string;
  publishedSlug: string;
  /** Pinned season for the published slug's folder (ADR-011). */
  season?: string;
  /** Pinned display labels for interior folders under the slug (ADR-011). */
  folders?: Array<{ path: string; label: string }>;
  fleets: SailwaveFleetInput[];
  /** Combined pages; the named fleets publish only as their sections. */
  combinedPages?: SailwaveCombinedPageInput[];
}

/** Sailwave colgroup classes → competitor fields. Everything else stays a
 *  display cell only. */
const FIELD_BY_KEY: Record<string, 'sailNumber' | 'name' | 'club' | 'nationality' | 'gender' | 'age' | 'boatName' | 'boatClass' | 'crewName' | 'helm' | 'owner'> = {
  sailno: 'sailNumber',
  helmname: 'name',
  crewname: 'crewName',
  club: 'club',
  nat: 'nationality',
  helmagegroup: 'age',
  helmage: 'age',
  helmsex: 'gender',
  boat: 'boatName',
  boatname: 'boatName',
  class: 'boatClass',
  design: 'boatClass',
  owner: 'owner',
  // Sail100 pages derive keys from header labels rather than colgroup
  // classes (see sail100-html.ts).
  'sail-no': 'sailNumber',
  altsailno: 'sailNumber',
  helm: 'name',
  'm-f': 'gender',
  'prize-age': 'age',
  country: 'nationality',
};

interface ExtractedCompetitor {
  sailNumber: string;
  name: string;
  club?: string;
  nationality?: string;
  gender?: 'M' | 'F';
  age?: number;
  boatName?: string;
  boatClass?: string;
  crewName?: string;
  helm?: string;
  owner?: string;
}

function extractCompetitor(
  section: SailwaveSummarySection,
  row: SailwaveSummaryRow,
): ExtractedCompetitor {
  const out: ExtractedCompetitor = { sailNumber: '', name: '' };
  section.leadColumns.forEach((col, i) => {
    const field = FIELD_BY_KEY[col.key];
    const value = (row.leadCells[i] ?? '').trim();
    if (!field || !value) return;
    if (field === 'age') {
      if (/^\d{1,3}$/.test(value)) out.age = Number.parseInt(value, 10);
      return;
    }
    if (field === 'gender') {
      if (value === 'M' || value === 'F') out.gender = value;
      return;
    }
    if (field === 'nationality') {
      out.nationality = value.slice(0, 10);
      return;
    }
    out[field] = value;
  });
  return out;
}

/** A blank helm field gets a placeholder so competitor listings sort it to the
 *  end rather than the top; the matcher ignores these names. */
function placeholderName(sailNumber: string, name: string): string {
  if (name.trim()) return name;
  return sailNumber ? `Unknown Competitor (${sailNumber})` : 'Unknown Competitor';
}

/** What a competitor row is keyed by — sail number and normalised name, the
 *  pair both the duplicate ordinal and the display-only join read. */
function identityKeyFor(sailNumber: string, name: string): string {
  const resolved = placeholderName(sailNumber, name);
  return `${sailNumber}|${normalizePersonName(resolved).full}`;
}

/** The same key read off a raw table line, through the column classes the
 *  competitor extraction already trusts — so a race-table line resolves to the
 *  competitor its summary row minted. */
function rowIdentityKey(columns: SailwaveColumn[], cells: string[]): string {
  let sailNumber = '';
  let name = '';
  columns.forEach((col, i) => {
    const value = (cells[i] ?? '').trim();
    if (!value) return;
    const field = FIELD_BY_KEY[col.key];
    if (field === 'sailNumber' && !sailNumber) sailNumber = value;
    if (field === 'name' && !name) name = value;
  });
  return identityKeyFor(sailNumber, name);
}

/** The rank column of a race table: Sailwave's `rank` colgroup class, else a
 *  leading column whose heading says so. The class is the reliable signal —
 *  HYC's older captures head the same column "Pl". */
function rankColumnIndex(columns: SailwaveColumn[]): number {
  const byKey = columns.findIndex((col) => col.key === 'rank');
  if (byKey !== -1) return byKey;
  return columns.findIndex((col) => /^(?:rank|place|pl|pos)\b/i.test(col.label.trim()));
}

/**
 * Build a summary section out of a page's race tables (#355) — the structural
 * rows a race-only capture has no summary table to state. HYC published many
 * of its one-off events (the Gibney Classic, the Lambay Races,
 * Howth-to-Drogheda) as a race result and nothing else; the page *is* the
 * table, so nothing is dropped and no fidelity question arises. The rows the
 * identity spine, the rankings and the career arcs read come from the race
 * lines themselves.
 *
 * Every such capture leads its race table with the boat's place, its sail
 * number and its helm, which is all the competitor extraction needs. The
 * section it yields carries no race or summary columns: there is no series to
 * summarise, and the fleet publishes at `detail: 'races'`.
 *
 * Ranks are claimed only from a page publishing a **single** race table. Two
 * races and no standings state no place between them, and inventing one would
 * feed a career arc a position the club never published — those rows rank
 * nowhere. A table whose columns differ from the first's is left out of the
 * rows entirely rather than misaligned into them (it still publishes: the race
 * tables are what the page renders); `skipped` names those for the caller to
 * report. Returns null when there is nothing to build from.
 */
export function summaryFromRaceTables(
  races: SailwaveRaceSection[],
): { summary: SailwaveSummarySection; skipped: string[] } | null {
  const tables = races.filter((race) => race.rows.length > 0);
  const first = tables[0];
  if (!first) return null;

  const shapeOf = (columns: SailwaveColumn[]) =>
    columns.map((col) => col.key).join('|');
  const rankIdx = rankColumnIndex(first.columns);
  const leadIdxs = first.columns
    .map((_, i) => i)
    .filter((i) => i !== rankIdx);
  const ranked = tables.length === 1;

  const skipped: string[] = [];
  const rows: SailwaveSummaryRow[] = [];
  const seen = new Set<string>();
  for (const table of tables) {
    if (shapeOf(table.columns) !== shapeOf(first.columns)) {
      skipped.push(table.title);
      continue;
    }
    for (const cells of table.rows) {
      // One row per boat, however many of the page's races it sailed.
      const key = rowIdentityKey(table.columns, cells);
      if (seen.has(key)) continue;
      seen.add(key);
      const rankLabel = rankIdx === -1 ? '' : (cells[rankIdx] ?? '').trim();
      rows.push({
        rankLabel: ranked ? rankLabel : '',
        rank: ranked ? parseRankLabel(rankLabel) : null,
        leadCells: leadIdxs.map((i) => cells[i] ?? ''),
        raceCells: [],
        summaryCells: [],
      });
    }
  }

  return {
    summary: {
      title: null,
      caption: null,
      leadColumns: leadIdxs.map((i) => first.columns[i]),
      raceHeaders: [],
      summaryColumns: [],
      rows,
    },
    skipped,
  };
}

/**
 * Build one series' ingest document from its parsed Sailwave sections.
 * Competitor ids derive from (fleet, sail, normalised name) with a
 * deterministic ordinal for exact duplicates, so re-generation is stable and
 * the identity links hanging off the rows survive.
 *
 * A `displayOnly` fleet (#363) instead joins to the competitor rows the
 * structural fleets already minted, matched on sail number and normalised
 * name — so the second presentation of a result adds tables, not sailors.
 * Structural fleets are therefore built first, whatever order they are
 * configured in; the document keeps the configured order.
 */
export function buildSailwaveArchiveDoc(
  input: SailwaveDocInput,
): ArchiveSeriesDoc {
  const competitors: ArchiveSeriesDoc['competitors'] = [];
  /** Structural competitor rows by (sail, normalised name) — what a
   *  display-only fleet's rows join to. First occurrence wins, so the join is
   *  stable when a boat is scored in more than one structural fleet. */
  const structuralByIdentity = new Map<
    string,
    ArchiveSeriesDoc['competitors'][number]
  >();

  const buildFleet = (fleet: SailwaveFleetInput) => {
    const fleetId = fleetIdFor(input.seriesId, fleet.name);
    const ordinals = new Map<string, number>();

    // Several old captures published columns we must not re-publish — dates
    // of birth and addresses appear on a handful of Sail100-era pages. Drop
    // those columns (and their cells) outright; "as published" yields to the
    // same PII line the .blw scrub draws, and age still stays.
    const keepIdx = fleet.summary.leadColumns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => !isPiiKey(c.key) && !isPiiKey(c.label))
      .map(({ i }) => i);
    const summary = {
      ...fleet.summary,
      leadColumns: keepIdx.map((i) => fleet.summary.leadColumns[i]),
      rows: fleet.summary.rows.map((row) => ({
        ...row,
        leadCells: keepIdx.map((i) => row.leadCells[i]),
      })),
    };

    /** This fleet's competitor ids by identity, for the race-table link
     *  below. First occurrence wins, as the display-only join does. */
    const idByIdentity = new Map<string, string>();

    const rows = summary.rows.map((row) => {
      const extracted = extractCompetitor(summary, row);
      extracted.name = placeholderName(extracted.sailNumber, extracted.name);
      const nameKey = normalizePersonName(extracted.name).full;
      const identityKey = identityKeyFor(extracted.sailNumber, extracted.name);
      // A second presentation joins to the boat the structural tables already
      // carry; only a boat that appears in no structural table mints a row of
      // its own, and it ranks in no structural table so it earns no place.
      const shared = fleet.displayOnly
        ? structuralByIdentity.get(identityKey)
        : undefined;
      let competitorId: string;
      if (shared) {
        competitorId = shared.id;
        if (!shared.fleetIds.includes(fleetId)) shared.fleetIds.push(fleetId);
      } else {
        const baseKey = `${fleet.name}/${extracted.sailNumber}/${nameKey}`;
        const ordinal = (ordinals.get(baseKey) ?? 0) + 1;
        ordinals.set(baseKey, ordinal);
        competitorId = competitorIdFor(
          input.seriesId,
          ordinal === 1 ? baseKey : `${baseKey}/${ordinal}`,
        );
        const competitor = {
          id: competitorId,
          fleetIds: [fleetId],
          sailNumber: extracted.sailNumber,
          name: extracted.name,
          ...(extracted.club ? { club: extracted.club } : {}),
          ...(extracted.nationality ? { nationality: extracted.nationality } : {}),
          ...(extracted.gender ? { gender: extracted.gender } : {}),
          ...(extracted.age !== undefined ? { age: extracted.age } : {}),
          ...(extracted.boatName ? { boatName: extracted.boatName } : {}),
          ...(extracted.boatClass ? { boatClass: extracted.boatClass } : {}),
          ...(extracted.crewName ? { crewName: extracted.crewName } : {}),
          ...(extracted.helm ? { helm: extracted.helm } : {}),
          ...(extracted.owner ? { owner: extracted.owner } : {}),
        };
        competitors.push(competitor);
        if (!fleet.displayOnly && !structuralByIdentity.has(identityKey)) {
          structuralByIdentity.set(identityKey, competitor);
        }
      }
      if (!idByIdentity.has(identityKey)) idByIdentity.set(identityKey, competitorId);
      return {
        competitorId,
        rank: row.rank,
        rankLabel: row.rankLabel,
        leadCells: row.leadCells,
        raceCells: row.raceCells.map((c) => ({
          text: c.text,
          ...(c.discard ? { discard: true } : {}),
          // The source's podium colouring (rank1/2/3 cell classes) rides in
          // the structured per-race rank slot.
          ...(c.podium ? { rank: c.podium } : {}),
        })),
        summaryCells: row.summaryCells,
      };
    });

    const raceTables: AsPublishedRaceTable[] = (fleet.races ?? []).map(
      (race) => ({
        label: race.title,
        ...(race.caption ? { caption: race.caption } : {}),
        columns: race.columns,
        rows: race.rows.map((cells) => {
          const rank = raceTableRowRank(race.columns, cells);
          // A synthesised fleet's competitors were built from these very
          // lines, so the link back is a fact rather than a re-match.
          const competitorId = fleet.rowsFromRaceTables
            ? idByIdentity.get(rowIdentityKey(race.columns, cells))
            : undefined;
          return {
            cells,
            ...(competitorId ? { competitorId } : {}),
            ...(rank !== undefined ? { rank } : {}),
          };
        }),
      }),
    );

    return {
      id: fleetId,
      name: fleet.name,
      ...(fleet.subPath ? { subPath: fleet.subPath } : {}),
      ...(fleet.displayOnly ? { displayOnly: true as const } : {}),
      results: {
        ...(summary.caption ? { caption: summary.caption } : {}),
        ...(fleet.detail ? { detail: fleet.detail } : {}),
        leadColumns: summary.leadColumns,
        raceHeaders: summary.raceHeaders.map((label) => ({ label })),
        summaryColumns: summary.summaryColumns,
        rows,
        ...(raceTables.length > 0 ? { raceTables } : {}),
      },
    };
  };

  // Structural fleets first so the display-only ones have rows to join to;
  // the document keeps the configured fleet order, which is page order.
  const builtByName = new Map<string, ReturnType<typeof buildFleet>>();
  for (const fleet of input.fleets) {
    if (!fleet.displayOnly) builtByName.set(fleet.name, buildFleet(fleet));
  }
  for (const fleet of input.fleets) {
    if (fleet.displayOnly) builtByName.set(fleet.name, buildFleet(fleet));
  }
  const fleets = input.fleets.map((f) => builtByName.get(f.name)!);

  const doc: ArchiveSeriesDoc = {
    formatVersion: 1,
    series: {
      id: input.seriesId,
      name: input.name,
      ...(input.venue ? { venue: input.venue } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.eventUrl ? { eventUrl: input.eventUrl } : {}),
      ...(input.venueUrl ? { venueUrl: input.venueUrl } : {}),
      ...(input.venueLogoUrl ? { venueLogoUrl: input.venueLogoUrl } : {}),
      ...(input.eventLogoUrl ? { eventLogoUrl: input.eventLogoUrl } : {}),
      source: input.source ?? 'sailwave',
      ...(input.category ? { category: input.category } : {}),
      publishedSlug: input.publishedSlug,
      ...(input.season ? { season: input.season } : {}),
      ...(input.folders?.length ? { folders: input.folders } : {}),
    },
    fleets,
    ...(input.combinedPages && input.combinedPages.length > 0
      ? {
          combinedPages: input.combinedPages.map((page) => ({
            subPath: page.subPath,
            name: page.name,
            fleetIds: page.fleetNames.map((name) =>
              fleetIdFor(input.seriesId, name),
            ),
          })),
        }
      : {}),
    competitors,
  };
  // Validate on the way out: a generator bug should fail generation, not the
  // later ingest.
  return archiveSeriesDocSchema.parse(doc);
}
