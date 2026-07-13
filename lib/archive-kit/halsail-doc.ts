/**
 * HalSail capture → archive ingest document (ADR-010, #283). The DBSC shape:
 * one as-published series per (class, dataset year), with each of the class's
 * HalSail series pages ("2024 Saturday Series A", "Saturday Overall", …) as a
 * fleet — mirroring how the HalSail site presents a class. Each page carries
 * its overall table plus per-race detail (Hcap / Finish / Elapsed /
 * Corrected), all preserved as display strings.
 *
 * HalSail's "Name" column is the *boat*; "Owner" is the person. The
 * competitor's primary name is the owner where recorded (DBSC results are
 * owner-primary), falling back to the boat name. A boat appearing in several
 * of the class's series folds to one competitor row spanning those fleets.
 */

import { normalizePersonName } from '@/lib/competitor-identity-match';

import { archiveSeriesDocSchema, type ArchiveSeriesDoc } from './format';
import { competitorIdFor, fleetIdFor } from './ids';
import type { HalsailPage } from './halsail-html';
import type { AsPublishedRaceTable } from './types';

export interface HalsailFleetInput {
  /** The fleet's display name — the HalSail series name. */
  name: string;
  /** Pinned public sub-path for the fleet page. */
  subPath: string;
  page: HalsailPage;
}

export interface HalsailDocInput {
  seriesId: string;
  name: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  eventUrl?: string;
  publishedSlug: string;
  fleets: HalsailFleetInput[];
}

/** Cell index by column key, tolerant of absent columns. */
function indexOf(columns: Array<{ key: string }>, key: string): number {
  return columns.findIndex((c) => c.key === key);
}

export function buildHalsailArchiveDoc(input: HalsailDocInput): ArchiveSeriesDoc {
  interface Pooled {
    id: string;
    fleetIds: string[];
    sailNumber: string;
    name: string;
    club?: string;
    boatName?: string;
    owner?: string;
  }
  // One competitor row per (sail, person) across the class's series-fleets.
  const pool = new Map<string, Pooled>();

  const fleets = input.fleets.map((fleet) => {
    const overall = fleet.page.overall;
    if (!overall) {
      throw new Error(`no overall results table for ${input.name} / ${fleet.name}`);
    }
    const fleetId = fleetIdFor(input.seriesId, fleet.name);

    const sailIdx = indexOf(overall.leadColumns, 'sail-number');
    const boatIdx = indexOf(overall.leadColumns, 'name');
    const ownerIdx = indexOf(overall.leadColumns, 'owner');
    const clubIdx = indexOf(overall.leadColumns, 'club');

    const seenThisFleet = new Map<string, number>();
    const rows = overall.rows.map((row) => {
      const sailNumber = sailIdx === -1 ? '' : (row.leadCells[sailIdx] ?? '');
      const boatName = boatIdx === -1 ? '' : (row.leadCells[boatIdx] ?? '');
      const owner = ownerIdx === -1 ? '' : (row.leadCells[ownerIdx] ?? '');
      const club = clubIdx === -1 ? '' : (row.leadCells[clubIdx] ?? '');
      const name = owner || boatName;
      const nameKey = normalizePersonName(name).full || boatName.toLowerCase();
      // The same (sail, person) twice in ONE table is two real rows (rare
      // placeholder cases); across tables it's the same boat.
      const baseKey = `${sailNumber}/${nameKey}`;
      const ordinal = (seenThisFleet.get(baseKey) ?? 0) + 1;
      seenThisFleet.set(baseKey, ordinal);
      const poolKey = ordinal === 1 ? baseKey : `${baseKey}/${ordinal}`;

      let pooled = pool.get(poolKey);
      if (!pooled) {
        pooled = {
          id: competitorIdFor(input.seriesId, poolKey),
          fleetIds: [],
          sailNumber,
          name,
          ...(club ? { club } : {}),
          ...(boatName ? { boatName } : {}),
          ...(owner ? { owner } : {}),
        };
        pool.set(poolKey, pooled);
      }
      if (!pooled.fleetIds.includes(fleetId)) pooled.fleetIds.push(fleetId);
      return {
        competitorId: pooled.id,
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

    const raceTables: AsPublishedRaceTable[] = fleet.page.races.map((race) => ({
      label: race.label,
      ...(race.date ? { date: race.date } : {}),
      ...(race.caption ? { caption: race.caption } : {}),
      columns: race.columns,
      rows: race.rows.map((cells) => ({ cells })),
    }));

    return {
      id: fleetId,
      name: fleet.name,
      subPath: fleet.subPath,
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
      source: 'halsail',
      publishedSlug: input.publishedSlug,
    },
    fleets,
    competitors: [...pool.values()],
  };
  return archiveSeriesDocSchema.parse(doc);
}
