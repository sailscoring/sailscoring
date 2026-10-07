/**
 * The publish-time summary of a publication (`PublicationSummary`): the
 * counts and dates its public indexes show — the workspace `index.json`, the
 * `/p/` directory — without opening its pages or its data file.
 *
 * Counted from the same data the pages were rendered from, at the moment of
 * publishing, so a series edited since never leaks into the public indexes.
 */

import type { ArchiveSeriesDoc } from './archive-kit/format';
import type { AsPublishedFleetResults } from './archive-kit/types';
import type { PublicSeriesExport } from './public-export';
import type { SeriesSnapshot } from './series-snapshot';
import type { PublicationSummary } from './types';

const ISO_DAY = /^(\d{4}-\d{2}-\d{2})/;

/** The earliest and latest of some dates, each cut to its `YYYY-MM-DD` day;
 *  anything that doesn't start with one is ignored. */
function dateRange(
  dates: (string | null | undefined)[],
): { first: string | null; last: string | null } {
  const days = dates
    .map((d) => ISO_DAY.exec(d ?? '')?.[1])
    .filter((d): d is string => d !== undefined)
    .sort();
  return { first: days[0] ?? null, last: days.at(-1) ?? null };
}

/**
 * The summary of a scored series' publication. `snapshot` is what the pages
 * were built from — unsailed races already dropped. `splitFleet` marks a
 * split-fleet championship, whose round-owned fleets are left out of the
 * fleet list.
 */
export function summariseSnapshot(
  snapshot: Pick<SeriesSnapshot, 'races' | 'competitors' | 'fleets'>,
  splitFleet: boolean,
): PublicationSummary {
  const { first, last } = dateRange(snapshot.races.map((r) => r.date));
  return {
    firstRaceDate: first,
    lastRaceDate: last,
    races: snapshot.races.length,
    boats: snapshot.competitors.length,
    fleets: [...snapshot.fleets]
      .filter((f) => !f.splitRoundId)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((f) => ({ name: f.name, scoringSystem: f.scoringSystem })),
    ...(splitFleet ? { splitFleet: true } : {}),
  };
}

/**
 * The summary of a publication from its published data file — the public
 * export the pages were rendered beside, built from the same snapshot. What
 * the backfill reads for a row published before summaries were stored: it is
 * the publication's own record of what it held. A championship's round fleets
 * (the ones a split created, which carry a colour) are left out.
 */
export function summarisePublicExport(
  exp: Pick<PublicSeriesExport, 'races' | 'competitors' | 'fleets' | 'splitFleets'>,
): PublicationSummary {
  const { first, last } = dateRange(exp.races.map((r) => r.date));
  return {
    firstRaceDate: first,
    lastRaceDate: last,
    races: exp.races.length,
    boats: exp.competitors.length,
    fleets: [...exp.fleets]
      .filter((f) => !f.color)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((f) => ({ name: f.label ?? f.name, scoringSystem: f.scoringSystem })),
    ...(exp.splitFleets ? { splitFleet: true } : {}),
  };
}

/**
 * The summary of an as-published archive series (ADR-010). An archive keeps
 * each fleet's table as it was published, so races are the widest fleet's
 * race columns (or race tables, for a race-results-only page), and the dates
 * come from those columns' headers — the series' own dates only where the
 * headers carry none and the archive knows the day. Display-only tables
 * repeat boats a structural one already holds, so they count for nothing.
 */
export function summariseArchive(input: {
  fleets: { name: string; displayOnly?: boolean; results: AsPublishedFleetResults }[];
  boats: number;
  startDate?: string | null;
  endDate?: string | null;
}): PublicationSummary {
  const structural = input.fleets.filter((f) => !f.displayOnly);
  const races = Math.max(
    0,
    ...structural.map((f) =>
      Math.max(f.results.raceHeaders.length, f.results.raceTables?.length ?? 0),
    ),
  );
  let { first, last } = dateRange(
    structural.flatMap((f) => [
      ...f.results.raceHeaders.map((h) => h.date),
      ...(f.results.raceTables ?? []).map((t) => t.date),
    ]),
  );
  if (first === null) {
    ({ first, last } = dateRange([input.startDate, input.endDate]));
  }
  return {
    firstRaceDate: first,
    lastRaceDate: last,
    races,
    boats: input.boats,
    fleets: structural.map((f) => ({ name: f.name })),
    asPublished: true,
  };
}

/** {@link summariseArchive} over an ingest document. */
export function summariseArchiveDoc(doc: ArchiveSeriesDoc): PublicationSummary {
  return summariseArchive({
    fleets: doc.fleets,
    boats: doc.competitors.length,
    startDate: doc.series.startDate,
    endDate: doc.series.endDate,
  });
}
