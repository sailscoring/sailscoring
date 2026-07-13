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

import { archiveSeriesDocSchema, type ArchiveSeriesDoc } from './format';
import { competitorIdFor, fleetIdFor } from './ids';
import type {
  SailwaveRaceSection,
  SailwaveSummaryRow,
  SailwaveSummarySection,
} from './sailwave-html';
import type { AsPublishedRaceTable } from './types';

/** One fleet of the series being built: a parsed summary section plus its
 *  pinned public sub-path, and optionally the race sections that follow it. */
export interface SailwaveFleetInput {
  name: string;
  subPath: string;
  summary: SailwaveSummarySection;
  races?: SailwaveRaceSection[];
}

export interface SailwaveDocInput {
  seriesId: string;
  name: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  eventUrl?: string;
  venueUrl?: string;
  venueLogoUrl?: string;
  eventLogoUrl?: string;
  publishedSlug: string;
  fleets: SailwaveFleetInput[];
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

/**
 * Build one series' ingest document from its parsed Sailwave sections.
 * Competitor ids derive from (fleet, sail, normalised name) with a
 * deterministic ordinal for exact duplicates, so re-generation is stable and
 * the identity links hanging off the rows survive.
 */
export function buildSailwaveArchiveDoc(
  input: SailwaveDocInput,
): ArchiveSeriesDoc {
  const competitors: ArchiveSeriesDoc['competitors'] = [];

  const fleets = input.fleets.map((fleet) => {
    const fleetId = fleetIdFor(input.seriesId, fleet.name);
    const ordinals = new Map<string, number>();

    const rows = fleet.summary.rows.map((row) => {
      const extracted = extractCompetitor(fleet.summary, row);
      const nameKey = normalizePersonName(extracted.name).full;
      const baseKey = `${fleet.name}/${extracted.sailNumber}/${nameKey}`;
      const ordinal = (ordinals.get(baseKey) ?? 0) + 1;
      ordinals.set(baseKey, ordinal);
      const competitorId = competitorIdFor(
        input.seriesId,
        ordinal === 1 ? baseKey : `${baseKey}/${ordinal}`,
      );
      competitors.push({
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
      });
      return {
        competitorId,
        rank: row.rank,
        rankLabel: row.rankLabel,
        leadCells: row.leadCells,
        raceCells: row.raceCells.map((c) => ({
          text: c.text,
          ...(c.discard ? { discard: true } : {}),
        })),
        summaryCells: row.summaryCells,
      };
    });

    const raceTables: AsPublishedRaceTable[] = (fleet.races ?? []).map(
      (race) => ({
        label: race.title,
        ...(race.caption ? { caption: race.caption } : {}),
        columns: race.columns,
        rows: race.rows.map((cells) => ({ cells })),
      }),
    );

    return {
      id: fleetId,
      name: fleet.name,
      subPath: fleet.subPath,
      results: {
        ...(fleet.summary.caption ? { caption: fleet.summary.caption } : {}),
        leadColumns: fleet.summary.leadColumns,
        raceHeaders: fleet.summary.raceHeaders.map((label) => ({ label })),
        summaryColumns: fleet.summary.summaryColumns,
        rows,
        ...(raceTables.length > 0 ? { raceTables } : {}),
      },
    };
  });

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
      source: 'sailwave',
      publishedSlug: input.publishedSlug,
    },
    fleets,
    competitors,
  };
  // Validate on the way out: a generator bug should fail generation, not the
  // later ingest.
  return archiveSeriesDocSchema.parse(doc);
}
