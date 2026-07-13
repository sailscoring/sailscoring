/**
 * HalSail capture → archive ingest document (ADR-010, #283). One HalSail page
 * is one (class, series) — one fleet's table plus its per-race detail — so a
 * document is built from one page (the DBSC shape: each class's series is its
 * own Sail Scoring series).
 *
 * HalSail's "Name" column is the *boat*; "Owner" is the person. The
 * competitor's primary name is the owner where recorded (DBSC results are
 * owner-primary), falling back to the boat name.
 */

import { normalizePersonName } from '@/lib/competitor-identity-match';

import { archiveSeriesDocSchema, type ArchiveSeriesDoc } from './format';
import { competitorIdFor, fleetIdFor } from './ids';
import type { HalsailPage } from './halsail-html';
import type { AsPublishedRaceTable } from './types';

export interface HalsailDocInput {
  seriesId: string;
  name: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  eventUrl?: string;
  publishedSlug: string;
  /** The single fleet's display name (the HalSail class), e.g. "Cruisers 3
   *  Master". */
  fleetName: string;
  /** Pinned public sub-path for the fleet page. */
  subPath: string;
  page: HalsailPage;
}

/** Cell index by column key, tolerant of absent columns. */
function indexOf(columns: Array<{ key: string }>, key: string): number {
  return columns.findIndex((c) => c.key === key);
}

export function buildHalsailArchiveDoc(input: HalsailDocInput): ArchiveSeriesDoc {
  const overall = input.page.overall;
  if (!overall) {
    throw new Error(`no overall results table for ${input.name}`);
  }
  const fleetId = fleetIdFor(input.seriesId, input.fleetName);

  const sailIdx = indexOf(overall.leadColumns, 'sail-number');
  const boatIdx = indexOf(overall.leadColumns, 'name');
  const ownerIdx = indexOf(overall.leadColumns, 'owner');
  const clubIdx = indexOf(overall.leadColumns, 'club');

  const ordinals = new Map<string, number>();
  const competitors: ArchiveSeriesDoc['competitors'] = [];
  const rows = overall.rows.map((row) => {
    const sailNumber = sailIdx === -1 ? '' : (row.leadCells[sailIdx] ?? '');
    const boatName = boatIdx === -1 ? '' : (row.leadCells[boatIdx] ?? '');
    const owner = ownerIdx === -1 ? '' : (row.leadCells[ownerIdx] ?? '');
    const club = clubIdx === -1 ? '' : (row.leadCells[clubIdx] ?? '');
    const name = owner || boatName;
    const nameKey = normalizePersonName(name).full || boatName.toLowerCase();
    const baseKey = `${input.fleetName}/${sailNumber}/${nameKey}`;
    const ordinal = (ordinals.get(baseKey) ?? 0) + 1;
    ordinals.set(baseKey, ordinal);
    const competitorId = competitorIdFor(
      input.seriesId,
      ordinal === 1 ? baseKey : `${baseKey}/${ordinal}`,
    );
    competitors.push({
      id: competitorId,
      fleetIds: [fleetId],
      sailNumber,
      name,
      ...(club ? { club } : {}),
      ...(boatName ? { boatName } : {}),
      ...(owner ? { owner } : {}),
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

  const raceTables: AsPublishedRaceTable[] = input.page.races.map((race) => ({
    label: race.label,
    ...(race.date ? { date: race.date } : {}),
    ...(race.caption ? { caption: race.caption } : {}),
    columns: race.columns,
    rows: race.rows.map((cells) => ({ cells })),
  }));

  const doc: ArchiveSeriesDoc = {
    formatVersion: 1,
    series: {
      id: input.seriesId,
      name: input.name,
      ...(input.venue ? { venue: input.venue } : {}),
      ...(input.startDate ? { startDate: input.startDate } : {}),
      ...(input.endDate ? { endDate: input.endDate } : {}),
      ...(input.eventUrl ? { eventUrl: input.eventUrl } : {}),
      source: 'halsail',
      publishedSlug: input.publishedSlug,
    },
    fleets: [
      {
        id: fleetId,
        name: input.fleetName,
        subPath: input.subPath,
        results: {
          ...(overall.caption ? { caption: overall.caption } : {}),
          leadColumns: overall.leadColumns,
          raceHeaders: overall.raceHeaders.map((label, i) => ({
            label: overall.raceDates[i] ? `${label} ${overall.raceDates[i]}` : label,
          })),
          summaryColumns: overall.summaryColumns,
          rows,
          ...(raceTables.length > 0 ? { raceTables } : {}),
        },
      },
    ],
    competitors,
  };
  return archiveSeriesDocSchema.parse(doc);
}
