/**
 * Per-race finish sheet CSV parser.
 *
 * CSV columns (header-mapped; user may override):
 *   sailNumber   required — boat's sail number
 *   finishTime   optional — "HH:MM:SS", "H:MM:SS", or "HHMMSS"
 *   resultCode   optional — DNF, DSQ, OCS, RET, DNE, UFD, BFD, DNS, NSC, DNC
 *
 * Row order is crossing order (ADR-007). Row produces one of:
 *   - a finisher: sortOrder = rank among finishers (1-based by row order); finishTime may be set
 *   - a coded non-finisher: sortOrder = null, resultCode set
 *
 * Rows with neither finishTime nor resultCode are rejected.
 * Unknown sail numbers produce unresolved-crossing finishes (competitorId=null,
 * unknownSailNumber=<raw>) — the race editor UI already supports these.
 *
 * v1 scope intentionally excludes ties, penalties (ZFP/SCP/DPI),
 * redress (RDG), equal-position sortOrder overrides, and startPresent.
 * Those are rare and can be set in the editor after import.
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
    coded: number;
    unresolved: number;  // finishers with an unknown sail number
  };
}

export interface Candidate {
  id: string;
  sailNumber: string;
  fleetIds: string[];
}

export interface ParseFinishSheetInput {
  rows: string[][];                            // data rows (header row excluded)
  columnMap: FinishSheetColumnMap;
  /** Candidates eligible to be finishers in this race. Caller filters to
   *  competitors in the race's fleets; matching is case-insensitive on sail number. */
  candidates: Candidate[];
}

const CODE_SET = new Set<string>(BUILT_IN_CODES.map((c) => c.code));

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
    redressExcludeRaces: null,
    redressIncludeRaces: null,
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

  const sailMap = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const key = c.sailNumber.toUpperCase();
    const arr = sailMap.get(key);
    if (arr) arr.push(c);
    else sailMap.set(key, [c]);
  }

  const errors: FinishSheetRowError[] = [];
  const warnings: FinishSheetRowError[] = [];
  const finishes: Omit<Finish, 'id' | 'raceId'>[] = [];
  const usedCompetitorIds = new Set<string>();

  let finisherCount = 0;
  let codedCount = 0;
  let unresolvedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const csvRowNumber = i + 2; // +1 for header, +1 for 1-based

    const rawSail = cols.sail >= 0 ? (row[cols.sail]?.trim() ?? '') : '';
    const rawTime = cols.time >= 0 ? (row[cols.time]?.trim() ?? '') : '';
    const rawCode = cols.code >= 0 ? (row[cols.code]?.trim() ?? '') : '';

    if (!rawSail) {
      errors.push({ rowIndex: csvRowNumber, reason: 'missing sail number' });
      continue;
    }

    // Decide finisher vs coded. A row with both a time and a code is treated as coded
    // (the code wins) — the scorer was probably recording why a finish time shouldn't
    // count. But warn, since that's ambiguous.
    const hasTime = rawTime.length > 0;
    const hasCode = rawCode.length > 0;

    if (!hasTime && !hasCode) {
      errors.push({
        rowIndex: csvRowNumber,
        reason: 'row has neither finish time nor result code',
      });
      continue;
    }

    let normalizedTime: string | null = null;
    if (hasTime) {
      normalizedTime = normalizeTimeInput(rawTime);
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

    // Resolve sail number → competitor
    const normSail = rawSail.toUpperCase();
    const matches = sailMap.get(normSail) ?? [];
    // Filter out sail numbers already used in this sheet (dedupe — keep first)
    const available = matches.filter((c) => !usedCompetitorIds.has(c.id));

    if (matches.length > 0 && available.length === 0) {
      errors.push({ rowIndex: csvRowNumber, reason: `sail ${rawSail} already used earlier in this sheet` });
      continue;
    }
    if (available.length > 1) {
      errors.push({
        rowIndex: csvRowNumber,
        reason: `sail ${rawSail} is ambiguous — multiple competitors share this number`,
      });
      continue;
    }

    const competitor = available[0];
    const resolved = competitor !== undefined;

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
      });
      codedCount++;
    } else {
      // Finisher
      finisherCount++;
      const sortOrder = finisherCount;
      if (resolved) {
        usedCompetitorIds.add(competitor.id);
        finishes.push({
          ...blankFinish(),
          competitorId: competitor.id,
          sortOrder,
          resultCode: null,
          ...(normalizedTime ? { finishTime: normalizedTime } : {}),
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
      coded: codedCount,
      unresolved: unresolvedCount,
    },
  };
}
