/**
 * HACK: a workaround for one tool's spreadsheet, not a general rule.
 *
 * HalSail's class export heads its boat-name column plain `Name`, which the
 * competitor importer reads as the primary (person) name, as it should for
 * most sheets. In a HalSail export it is the boat. Recognising the export by
 * the reload instructions HalSail puts above its headings lets the importer
 * propose Boat name instead.
 *
 * Kept apart from the column detection so it is easy to drop if HalSail
 * changes its layout, or once the mapping can be told what a sheet came from.
 */

import type { ColumnMap } from '@/lib/csv-import';

/** The first line of HalSail's reload instructions. */
const HALSAIL_INSTRUCTIONS = /reloading this spreadsheet into halsail/i;

/** Whether the lines above a sheet's headings are HalSail's reload
 *  instructions. */
export function isHalsailExport(preamble: readonly string[][]): boolean {
  return preamble.some((row) => row.some((cell) => HALSAIL_INSTRUCTIONS.test(cell)));
}

/**
 * Map a HalSail export's `Name` column to Boat name.
 *
 * Only when another column can be the primary name — an Owner or Helm
 * column, which the importer then proposes as the primary. Without one, the
 * boat name stays the primary: a competitor needs a name column, and a boat
 * listed under its own name imports better than one the mapping refuses.
 */
export function halsailColumnMap(headers: readonly string[], columnMap: ColumnMap): ColumnMap {
  const targets = Object.values(columnMap);
  if (targets.includes('boatName')) return columnMap;
  if (!targets.includes('owner') && !targets.includes('helm')) return columnMap;
  const col = headers.findIndex((h, i) => h.trim().toLowerCase() === 'name' && columnMap[i] === 'primary');
  if (col < 0) return columnMap;
  return { ...columnMap, [col]: 'boatName' };
}
