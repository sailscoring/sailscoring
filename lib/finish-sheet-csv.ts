/**
 * Per-race finish sheet parser. Rows come from a CSV or an .xlsx worksheet
 * (via lib/import-table) — by this point both are plain strings.
 *
 * Columns (header-mapped; user may override):
 *   sailNumber   required — boat's sail number
 *   finishTime   optional — "HH:MM:SS", "H:MM:SS", or "HHMMSS"; also accepts
 *                a bare fraction of a day ("0.438…"), which is how a
 *                spreadsheet time cell with an unrecognised custom format
 *                reaches us
 *   resultCode   optional — DNF, DSQ, OCS, RET, DNE, UFD, BFD, DNS, NSC, DNC
 *
 * Row order is crossing order (ADR-007). Row produces one of:
 *   - a finisher: sortOrder = rank among finishers (1-based by row order); finishTime may be set
 *   - a coded non-finisher: sortOrder = null, resultCode set
 *
 * Rows with neither finishTime nor resultCode are plain finishers ranked by
 * row position — a place-only sheet is how scratch racing is normally
 * recorded, since crossing order alone scores the race. Entirely blank rows
 * (trailing empty lines) are skipped without an error.
 * Unknown sail numbers produce unresolved-crossing finishes (competitorId=null,
 * unknownSailNumber=<raw>) — the race editor UI already supports these.
 *
 * Matching mirrors keyboard finish entry's tier order: exact registered sail
 * number first, then exact alternative sail number, then exact bow number for
 * rows that would otherwise be unresolved. It stops there — the unique-prefix
 * tiers the keyboard path offers are a typing convenience with a scorer
 * watching each suggestion, and an imported sheet carries whole numbers with
 * nobody reading the rows one at a time.
 *
 * The format intentionally excludes ties, penalties (ZFP/SCP/DPI), redress
 * (RDG), equal-position sortOrder overrides, and startPresent. Those are
 * rare and are set in the editor — and on a re-import, the ones already
 * stored are carried across rather than cleared (see `carryAcrossImport`
 * in lib/finish-entry.ts).
 */

import type { Finish, ResultCode } from './types';
import { BUILT_IN_CODES } from './scoring-codes';
import { normalizeTimeInput } from './time-parse';

export type FinishSheetField = 'sailNumber' | 'finishTime' | 'resultCode' | 'ignore';

export type FinishSheetColumnMap = Record<number, FinishSheetField>;

export interface FinishSheetRowError {
  rowIndex: number;  // 1-based CSV row number (including header = row 1)
  reason: string;
}

export interface ParseFinishSheetResult {
  /** Finish records, assembled in crossing order. Caller assigns IDs. */
  finishes: Omit<Finish, 'id' | 'raceId'>[];
  /** Rows that could not be imported (missing data, invalid code, etc.). */
  errors: FinishSheetRowError[];
  /** Rows imported but needing attention (unresolved sail numbers). */
  warnings: FinishSheetRowError[];
  /** Summary counts for the preview dialog. */
  summary: {
    finishers: number;
    untimed: number;     // finishers with no finish time (place-only rows)
    coded: number;
    unresolved: number;  // finishers with an unknown sail number
    /** Rows resolved via an alternative or bow number, not the registered sail number. */
    matchedOnBow: number;
  };
}

export interface Candidate {
  id: string;
  sailNumber: string;
  /** 3-letter national-letters code ("IRL"). When present, the qualified
   *  forms of the sail number ("IRL 224529", "IRL224529") resolve to this
   *  boat too — that is how championship sheets and RaceSense exports write
   *  sail numbers. */
  nationality?: string;
  bowNumber?: string;
  alternativeSailNumbers?: string[];
  fleetIds: string[];
}

/**
 * Every string that names this boat's registered sail number: the number as
 * entered, plus the nationality-qualified forms when the boat carries
 * national letters. All are first-tier — a qualified number is the registered
 * number written in full, not an alternative — so a match on any of them is
 * silent. Callers comparing sail numbers themselves should compare against
 * all of these, case-insensitively.
 */
export function sailNumberKeys(c: Candidate): string[] {
  const sail = c.sailNumber.trim();
  const nationality = c.nationality?.trim() ?? '';
  if (!sail || !nationality) return [sail];
  return [sail, `${nationality} ${sail}`, `${nationality}${sail}`];
}

export interface ParseFinishSheetInput {
  rows: string[][];                            // data rows (header row excluded)
  columnMap: FinishSheetColumnMap;
  /** Candidates eligible to be finishers in this race. Caller filters to
   *  competitors in the race's fleets; matching is case-insensitive on sail
   *  number (bare or nationality-qualified — see {@link sailNumberKeys}),
   *  falling back to bow number (see {@link parseFinishSheetCsv}). */
  candidates: Candidate[];
}

const CODE_SET = new Set<string>(BUILT_IN_CODES.map((c) => c.code));

/**
 * Excel stores times of day as fractions of a day; import-table renders
 * recognised time formats to "HH:MM:SS", but a cell with an exotic custom
 * format falls through as the raw serial ("0.4382523…" for 10:31:05).
 * Convert those; anything else is left for `normalizeTimeInput`.
 */
function fractionOfDayToTime(raw: string): string | null {
  if (!/^0?\.\d+$/.test(raw)) return null;
  const total = Math.round(parseFloat(raw) * 86400) % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

export function autoDetectFinishSheetField(header: string): FinishSheetField {
  const h = header.trim().toLowerCase();
  if (/sail\s*(number|no|#)?|^#$/.test(h) || h === 'sail') return 'sailNumber';
  if (/finish\s*time|^time$|\btime\b/.test(h)) return 'finishTime';
  if (/result\s*code|^code$|\bcode\b/.test(h)) return 'resultCode';
  return 'ignore';
}

function blankFinish(): Omit<Finish, 'id' | 'raceId' | 'competitorId' | 'sortOrder' | 'resultCode'> {
  return {
    tiedWithPrevious: false,
    startPresent: null,
    penaltyCode: null,
    penaltyOverride: null,
    redressMethod: null,
    redressExcludeRaceIds: null,
    redressIncludeRaceIds: null,
    redressIncludeAllLater: false,
    redressPoints: null,
  };
}

export function parseFinishSheetCsv(input: ParseFinishSheetInput): ParseFinishSheetResult {
  const { rows, columnMap, candidates } = input;

  // Build lookups
  const cols = {
    sail: -1,
    time: -1,
    code: -1,
  };
  for (const [colStr, field] of Object.entries(columnMap)) {
    const col = parseInt(colStr, 10);
    if (field === 'sailNumber') cols.sail = col;
    else if (field === 'finishTime') cols.time = col;
    else if (field === 'resultCode') cols.code = col;
  }

  const index = (keys: (c: Candidate) => string[]) => {
    const map = new Map<string, Candidate[]>();
    for (const c of candidates) {
      for (const raw of keys(c)) {
        const k = raw.trim().toUpperCase();
        if (!k) continue;
        const arr = map.get(k);
        if (arr) arr.push(c);
        else map.set(k, [c]);
      }
    }
    return map;
  };
  const sailMap = index(sailNumberKeys);
  // Tiers below the registered sail number, in the order they are tried.
  const fallbackTiers: { matchedOn: 'alternative' | 'bow'; map: Map<string, Candidate[]> }[] = [
    { matchedOn: 'alternative', map: index((c) => c.alternativeSailNumbers ?? []) },
    { matchedOn: 'bow', map: index((c) => (c.bowNumber ? [c.bowNumber] : [])) },
  ];

  const errors: FinishSheetRowError[] = [];
  const warnings: FinishSheetRowError[] = [];
  const finishes: Omit<Finish, 'id' | 'raceId'>[] = [];
  const usedCompetitorIds = new Set<string>();

  let finisherCount = 0;
  let untimedCount = 0;
  let codedCount = 0;
  let unresolvedCount = 0;
  let fallbackMatchCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvRowNumber = i + 2; // +1 for header, +1 for 1-based

    // An entirely blank row is not data — sheets routinely end with empty
    // lines. Skip it rather than reporting a missing sail number.
    if (row.every((cell) => !cell || cell.trim() === '')) continue;

    const rawSail = cols.sail >= 0 ? (row[cols.sail]?.trim() ?? '') : '';
    const rawTime = cols.time >= 0 ? (row[cols.time]?.trim() ?? '') : '';
    const rawCode = cols.code >= 0 ? (row[cols.code]?.trim() ?? '') : '';

    if (!rawSail) {
      errors.push({ rowIndex: csvRowNumber, reason: 'missing sail number' });
      continue;
    }

    // Decide finisher vs coded. A row with both a time and a code is treated as coded
    // (the code wins) — the scorer was probably recording why a finish time shouldn't
    // count. A row with neither is a plain finisher: its place comes from row order.
    const hasTime = rawTime.length > 0;
    const hasCode = rawCode.length > 0;

    let normalizedTime: string | null = null;
    if (hasTime) {
      normalizedTime = normalizeTimeInput(fractionOfDayToTime(rawTime) ?? rawTime);
      if (!normalizedTime) {
        errors.push({ rowIndex: csvRowNumber, reason: `invalid finish time "${rawTime}"` });
        continue;
      }
    }

    let code: ResultCode | null = null;
    if (hasCode) {
      const upper = rawCode.toUpperCase();
      if (!CODE_SET.has(upper)) {
        errors.push({ rowIndex: csvRowNumber, reason: `unknown result code "${rawCode}"` });
        continue;
      }
      code = upper as ResultCode;
    }

    // Resolve sail number → competitor. The fallback tiers sit strictly
    // underneath, as in keyboard finish entry: a value that is one boat's
    // registered sail number always resolves to that boat, and a lower tier
    // only rescues a row that would otherwise be unresolved.
    const normSail = rawSail.toUpperCase();
    const sailMatches = sailMap.get(normSail) ?? [];
    const fallback =
      sailMatches.length === 0
        ? fallbackTiers.find((t) => t.map.has(normSail))
        : undefined;
    const matches = fallback ? fallback.map.get(normSail)! : sailMatches;
    // Filter out sail numbers already used in this sheet (dedupe — keep first)
    const available = matches.filter((c) => !usedCompetitorIds.has(c.id));

    const idLabel = fallback?.matchedOn === 'bow' ? 'bow' : 'sail';

    if (matches.length > 0 && available.length === 0) {
      errors.push({ rowIndex: csvRowNumber, reason: `${idLabel} ${rawSail} already used earlier in this sheet` });
      continue;
    }
    if (available.length > 1) {
      errors.push({
        rowIndex: csvRowNumber,
        reason: `${idLabel} ${rawSail} is ambiguous — multiple competitors share this number`,
      });
      continue;
    }

    const competitor = available[0];
    const resolved = competitor !== undefined;

    // The committed row shows the registered sail number, so a row matched on
    // anything else needs saying: otherwise the imported sheet silently reads
    // back as a different number from the one the recorders wrote down.
    if (resolved && fallback) {
      fallbackMatchCount++;
      warnings.push({
        rowIndex: csvRowNumber,
        reason:
          fallback.matchedOn === 'bow'
            ? `${rawSail} matched the bow number of sail ${competitor.sailNumber}`
            : `${rawSail} is an alternative sail number of ${competitor.sailNumber}`,
      });
    }
    const provenance =
      resolved && fallback
        ? { matchedOn: fallback.matchedOn, enteredSailNumber: rawSail }
        : {};

    if (hasCode) {
      if (!resolved) {
        // An unresolved coded row is awkward (what does "DNF for an unknown boat" mean?).
        // The Finish model requires a competitorId for coded finishes, so skip with a warning.
        errors.push({
          rowIndex: csvRowNumber,
          reason: `sail ${rawSail} not registered — cannot assign code ${code}`,
        });
        continue;
      }
      usedCompetitorIds.add(competitor.id);
      finishes.push({
        ...blankFinish(),
        competitorId: competitor.id,
        sortOrder: null,
        resultCode: code,
        ...provenance,
      });
      codedCount++;
    } else {
      // Finisher
      finisherCount++;
      if (!normalizedTime) untimedCount++;
      const sortOrder = finisherCount;
      if (resolved) {
        usedCompetitorIds.add(competitor.id);
        finishes.push({
          ...blankFinish(),
          competitorId: competitor.id,
          sortOrder,
          resultCode: null,
          ...(normalizedTime ? { finishTime: normalizedTime } : {}),
          ...provenance,
        });
      } else {
        unresolvedCount++;
        warnings.push({
          rowIndex: csvRowNumber,
          reason: `sail ${rawSail} not registered — imported as unresolved crossing`,
        });
        finishes.push({
          ...blankFinish(),
          competitorId: null,
          unknownSailNumber: rawSail,
          sortOrder,
          resultCode: null,
          ...(normalizedTime ? { finishTime: normalizedTime } : {}),
        });
      }
    }
  }

  return {
    finishes,
    errors,
    warnings,
    summary: {
      finishers: finisherCount,
      untimed: untimedCount,
      coded: codedCount,
      unresolved: unresolvedCount,
      matchedOnBow: fallbackMatchCount,
    },
  };
}
