/**
 * Scoring code definitions (Option B from docs/design/scoring-codes.md).
 *
 * Every result code — including all standard RRS codes — is modelled as a
 * ScoringCodeDefinition record. The scoring engine reads these properties at
 * runtime rather than branching on code strings.
 *
 * Built-in definitions ship as a static asset (this file), described the way
 * RRS A5 words them: DNF scores the place after the boats entered (A5.2) or
 * the boats that came to the starting area (A5.3), and DNS, OCS, NSC, RET,
 * DSQ, DNE, UFD and BFD score the same as DNF. A series may change some of
 * them and add codes of its own (`SeriesScoringCode`); `buildCodeTable`
 * merges the two into the table the engine scores a series with.
 */

import type { DnfScoring, PlaceBase, Series, SeriesCodeRule, SeriesScoringCode } from './types';
import { highPointOf, highPointPlacePoints, type HighPointScoring } from './high-point';

export type { PlaceBase, SeriesCodeRule, SeriesScoringCode };

export type PointsMethod =
  // Position-replacing: the place `plus` beyond a count of boats. DNF's own
  // base is the series' A5 rule (`follows A5`, resolved by buildCodeTable).
  | { type: 'place_after'; base: PlaceBase; plus: number }
  // Position-replacing: whatever another code scores.
  | { type: 'same_as'; code: string }
  // Position-replacing: a fixed number of points.
  | { type: 'fixed_points'; points: number }
  // Additive penalty (applied on top of finish place; A6.2: other scores unchanged).
  // Formula (rule 44.3(c)): min(place + roundToTenth(pct/100 × dnfScore), dnfScore)
  // penaltyOverride on Finish overrides defaultPct for SCP — unless the SCP is
  // stated in points (Finish.penaltyInPoints), which scores as additive_stated.
  | { type: 'additive_percentage'; defaultPct: number }
  // Discretionary Points Increase: min(place + override, dnfScore)
  // Finish.penaltyOverride is the stated points to add.
  | { type: 'additive_stated' }
  // A series' own additive code: min(place + points, dnfScore).
  | { type: 'additive_points'; points: number }
  // Redress (RDG): score replaced by A9 average — computed dynamically in calculateStandings.
  | { type: 'redress' };

/** Whether a code replaces the boat's result, adds to her finishing place,
 *  or is redress. The kind also settles RRS A6.2: a code that adds leaves
 *  every other boat's score unchanged. */
export type CodeKind = 'replace' | 'add' | 'redress';

export interface ScoringCodeDefinition {
  code: string;
  name: string;
  builtIn: boolean;
  kind: CodeKind;
  pointsMethod: PointsMethod;
  /** Whether the score for this code can be selected as a discard. */
  discardable: boolean;
  /**
   * RRS A6.2: when true, other boats' scores are not recalculated when this
   * code is applied (two boats may share the same score).
   */
  otherScoresUnchanged: boolean;
  /** Whether a boat scored with this code came to the starting area (RRS
   *  A5.3's count). Only DNC says no. */
  cameToStart: boolean;
  /** A replacing code's points are never more than DNF's. */
  capAtDnf?: boolean;
  /** High point: whether a boat scored with this code is one of the n boats
   *  in the race. Set by `buildCodeTable`; low point never reads it. */
  countsInFleetSize?: boolean;
  /** DNF's base is the series' A5 rule rather than a fixed count. */
  followsA5?: boolean;
  /** The description a series gives its own code, printed under the results. */
  description?: string;
}

const replacing = (
  code: string,
  name: string,
  pointsMethod: PointsMethod,
  extra: Partial<ScoringCodeDefinition> = {},
): ScoringCodeDefinition => ({
  code,
  name,
  builtIn: true,
  kind: 'replace',
  pointsMethod,
  discardable: true,
  otherScoresUnchanged: false,
  cameToStart: true,
  ...extra,
});

const AS_DNF: PointsMethod = { type: 'same_as', code: 'DNF' };

export const BUILT_IN_CODES: readonly ScoringCodeDefinition[] = [
  replacing('DNC', 'Did Not Come to start area', { type: 'place_after', base: 'entries', plus: 1 }, { cameToStart: false }),
  replacing('DNS', 'Did Not Start', AS_DNF),
  replacing('OCS', 'On Course Side', AS_DNF),
  replacing('NSC', 'Did Not Sail the Course', AS_DNF),
  // A5.2: the place after the boats entered; A5.3: after the boats that came
  // to the starting area. buildCodeTable picks the base from the series.
  replacing('DNF', 'Did Not Finish', { type: 'place_after', base: 'entries', plus: 1 }, { followsA5: true }),
  replacing('RET', 'Retired', AS_DNF),
  replacing('DSQ', 'Disqualified', AS_DNF),
  replacing('DNE', 'Disqualification Not Excludable', AS_DNF, { discardable: false }),
  replacing('UFD', 'U Flag Disqualification', AS_DNF),
  // Rule 30.4: a black-flagged boat was in the triangle in the last minute
  // before her start, so she came to the starting area and scores as DNF, the
  // same as DSQ/UFD. A plain BFD is an ordinary disqualification and IS
  // discardable. The only non-discardable variant is the niche case of a boat
  // that sailed a restart after being black-flagged (scored DNE); that is not
  // modelled here.
  replacing('BFD', 'Black Flag Disqualification', AS_DNF),
  // ── Additive penalty codes (Phase 2) ───────────────────────────────────────
  {
    code: 'ZFP',
    name: 'Z Flag Penalty',
    builtIn: true,
    kind: 'add',
    // Rule 30.2 (Z Flag Rule): 20% of the DNF score added to finish place (formula per 44.3(c)).
    // Applied automatically — no hearing required. No penaltyOverride (percentage is fixed by rule).
    pointsMethod: { type: 'additive_percentage', defaultPct: 20 },
    discardable: true,
    otherScoresUnchanged: true,   // A6.2: other boats keep their scores
    cameToStart: true,
  },
  {
    code: 'SCP',
    name: 'Scoring Penalty',
    builtIn: true,
    kind: 'add',
    // Rule 44.3(c): the points stated in the NoR or SIs, else 20% of DNF.
    // Finish.penaltyOverride can specify a different %, or — with
    // Finish.penaltyInPoints — the stated points (see penaltyPointsMethod).
    pointsMethod: { type: 'additive_percentage', defaultPct: 20 },
    discardable: true,
    otherScoresUnchanged: true,
    cameToStart: true,
  },
  {
    code: 'DPI',
    name: 'Discretionary Points Increase',
    builtIn: true,
    kind: 'add',
    // PC-specified points added; Finish.penaltyOverride is the stated amount.
    pointsMethod: { type: 'additive_stated' },
    discardable: true,
    otherScoresUnchanged: true,
    cameToStart: true,
  },
  // ── Redress (Phase 3) ──────────────────────────────────────────────────────
  {
    code: 'RDG',
    name: 'Redress Given',
    builtIn: true,
    kind: 'redress',
    // Score is replaced by an A9 average calculated dynamically by calculateStandings().
    // The placeholder score assigned by calculateRaceScores() is always overwritten.
    pointsMethod: { type: 'redress' },
    discardable: true,
    otherScoresUnchanged: false,
    cameToStart: true,
  },
];

const BUILT_IN_MAP = new Map(BUILT_IN_CODES.map((d) => [d.code, d]));

/** The built-in codes a series may change: those whose points the rules fix
 *  and a sailing instruction may change. SCP, DPI and RDG are decided for
 *  each boat when they are applied. */
export const CHANGEABLE_BUILT_IN_CODES: readonly string[] = [
  'DNC', 'DNS', 'OCS', 'NSC', 'DNF', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'ZFP',
];

function methodOf(rule: SeriesCodeRule): PointsMethod {
  switch (rule.type) {
    case 'placeAfter': return { type: 'place_after', base: rule.base, plus: rule.plus };
    case 'sameAs': return { type: 'same_as', code: rule.code };
    case 'fixedPoints': return { type: 'fixed_points', points: rule.points };
    case 'addPoints': return { type: 'additive_points', points: rule.points };
    case 'addPercent': return { type: 'additive_percentage', defaultPct: rule.percent };
  }
}

/** The counts a race's code points are worked out from, for one fleet. */
export interface RaceCounts {
  /** Boats entered — the A5.2 base. */
  entries: number;
  /** Boats that came to the starting area — the A5.3 base. */
  startingArea: number;
  /** Boats that finished (took a place). */
  finishers: number;
  /** High point's n: the boats with a result that counts toward the fleet
   *  size — finishers and the codes marked to count. Absent, the entries. */
  fleetSize?: number;
}

/**
 * The codes a series scores with: the built-ins under its A5 rule, its
 * changes to them, and its own codes. Built once per scoring run.
 */
export interface ScoringCodeTable {
  /** The series' A5 rule, which DNF's base follows unless DNF is changed. */
  readonly dnfScoring: DnfScoring;
  /** The series' changes and own codes, as stored. */
  readonly seriesCodes: readonly SeriesScoringCode[];
  /** How the series scores high point; absent for low point. Every part of
   *  the engine that compares points reads its direction from here. */
  readonly highPoint?: HighPointScoring;
  definition(code: string): ScoringCodeDefinition | undefined;
  /** Points for a replacing code in a race, or undefined for a code that
   *  adds, a redress code or an unknown one. */
  replacePoints(code: string, counts: RaceCounts): number | undefined;
  /** What DNF scores in the race: the cap for additive penalties and for
   *  codes capped at DNF. */
  dnfPoints(counts: RaceCounts): number;
  /** Whether a boat scored with the code came to the starting area. */
  cameToStart(code: string): boolean;
  /** High point: whether a boat scored with the code is one of the n boats
   *  in the race. */
  countsInFleetSize(code: string): boolean;
  /** What a boat with no score in a race scores: the place after the
   *  entries in low point, nothing in high point. */
  missingPoints(counts: RaceCounts): number;
  /** Whether a score with the code may be discarded. */
  discardable(code: string): boolean;
}

/** How deep "the same as" may chain before it is taken for a loop. */
const MAX_SAME_AS_DEPTH = 16;

/**
 * Merge the built-ins, the series' A5 rule and the series' own codes into
 * the table the engine scores with. A series code with a built-in's name
 * changes that code's points and discardability, keeping its kind, name and
 * came-to-start answer; any other is a code of the series' own.
 */
export function buildCodeTable(
  dnfScoring: DnfScoring = 'seriesEntries',
  seriesCodes: readonly SeriesScoringCode[] = [],
  highPoint?: HighPointScoring,
): ScoringCodeTable {
  const defs = new Map<string, ScoringCodeDefinition>();
  const builtIns = highPoint ? highPointBuiltIns(highPoint) : BUILT_IN_CODES;
  const builtInMap = new Map(builtIns.map((d) => [d.code, d]));
  for (const def of builtIns) {
    if (def.followsA5) {
      defs.set(def.code, {
        ...def,
        pointsMethod: { type: 'place_after', base: dnfScoring === 'seriesEntries' ? 'entries' : 'startingArea', plus: 1 },
      });
    } else {
      defs.set(def.code, def);
    }
  }
  const ownCodes: ScoringCodeDefinition[] = [];
  for (const sc of seriesCodes) {
    const builtIn = builtInMap.get(sc.code);
    if (builtIn) {
      defs.set(sc.code, {
        ...builtIn,
        followsA5: false,
        pointsMethod: methodOf(sc.rule),
        discardable: sc.discardable,
        capAtDnf: sc.capAtDnf,
        countsInFleetSize: sc.countsInFleetSize ?? builtIn.countsInFleetSize,
      });
    } else {
      const def: ScoringCodeDefinition = {
        code: sc.code,
        name: sc.description ?? sc.code,
        description: sc.description,
        builtIn: false,
        kind: sc.kind,
        pointsMethod: methodOf(sc.rule),
        discardable: sc.discardable,
        otherScoresUnchanged: sc.kind === 'add',
        cameToStart: true,
        capAtDnf: sc.capAtDnf,
        countsInFleetSize: sc.countsInFleetSize,
      };
      defs.set(sc.code, def);
      ownCodes.push(def);
    }
  }
  // A series code that scores the same as another takes that code's answer
  // to whether the boat came to the starting area: one scored as DNC did not.
  // In high point it takes the answer to whether she counts toward the fleet
  // size the same way, unless the series says; any other code of its own
  // counts.
  for (const def of ownCodes) {
    let target = def;
    for (let depth = 0; depth < MAX_SAME_AS_DEPTH && target.pointsMethod.type === 'same_as'; depth++) {
      const next = defs.get(target.pointsMethod.code);
      if (!next) break;
      target = next;
    }
    def.cameToStart = target.cameToStart;
    if (def.countsInFleetSize === undefined) def.countsInFleetSize = target.countsInFleetSize ?? true;
  }

  const rawPoints = (code: string, counts: RaceCounts, depth: number): number | undefined => {
    const def = defs.get(code);
    if (!def || def.kind !== 'replace' || depth > MAX_SAME_AS_DEPTH) return undefined;
    let points: number | undefined;
    const m = def.pointsMethod;
    if (m.type === 'place_after') {
      // High point: the place after the last of the n boats in the race (or
      // further back), scored by the formula; the base counts only in low
      // point.
      if (highPoint) {
        const n = counts.fleetSize ?? counts.entries;
        points = highPointPlacePoints(highPoint, n + m.plus, n);
      } else {
        points = counts[m.base] + m.plus;
      }
    }
    else if (m.type === 'fixed_points') points = m.points;
    else if (m.type === 'same_as') points = rawPoints(m.code, counts, depth + 1);
    if (points === undefined) return undefined;
    // Capping at DNF is a low-point notion: a code never scores worse than a
    // retirement. High point has no such rule to apply.
    if (def.capAtDnf && code !== 'DNF' && !highPoint) {
      const dnf = rawPoints('DNF', counts, depth + 1);
      if (dnf !== undefined) points = Math.min(points, dnf);
    }
    return points;
  };

  const missingPoints = (counts: RaceCounts): number => (highPoint ? 0 : counts.entries + 1);

  return {
    dnfScoring,
    seriesCodes,
    ...(highPoint ? { highPoint } : {}),
    definition: (code) => defs.get(code),
    replacePoints: (code, counts) => rawPoints(code, counts, 0),
    // Unreachable fallback: DNF is always a replacing built-in, and a loop
    // through "the same as" is refused when the series' codes are saved.
    dnfPoints: (counts) => rawPoints('DNF', counts, 0) ?? missingPoints(counts),
    cameToStart: (code) => defs.get(code)?.cameToStart ?? true,
    countsInFleetSize: (code) => defs.get(code)?.countsInFleetSize ?? true,
    discardable: (code) => defs.get(code)?.discardable ?? true,
    missingPoints,
  };
}

/**
 * The built-in codes as a high-point series scores them before it changes
 * any. "The place after the last" is the formula one place beyond the n
 * boats in the race: 0 under boats beaten (1 with the point for coming to
 * the start), CHIPS3(n + 1, n) under CHIPS3.
 *
 * - Boats beaten: DNC scores 0 and is not one of the n; every other code
 *   scores the place after the last and is, as DNF is (Bray SC's results).
 * - CHIPS3 follows Chipstead's definition: a retirement scores the place
 *   after the last; a boat that did not start, or was disqualified (OCS
 *   included), scores 0. A boat that did not start is not one of the n.
 *
 * Redress is never one of the n: no boat beat her. The additive penalties
 * count, being finishers, though a high-point series can't apply them yet.
 */
function highPointBuiltIns(hp: HighPointScoring): ScoringCodeDefinition[] {
  const ZERO: PointsMethod = { type: 'fixed_points', points: 0 };
  const zeroUnderChips3 = new Set(['DNS', 'OCS', 'NSC', 'DSQ', 'DNE', 'UFD', 'BFD']);
  return BUILT_IN_CODES.map((def) => {
    if (def.code === 'DNC') return { ...def, pointsMethod: ZERO, countsInFleetSize: false };
    if (def.code === 'DNF') {
      return { ...def, followsA5: false, pointsMethod: { type: 'place_after', base: 'entries', plus: 1 }, countsInFleetSize: true };
    }
    if (def.code === 'RDG') return { ...def, countsInFleetSize: false };
    if (hp.formula === 'chips3' && zeroUnderChips3.has(def.code)) {
      return { ...def, pointsMethod: ZERO, countsInFleetSize: def.code !== 'DNS' };
    }
    return { ...def, countsInFleetSize: true };
  });
}

/** The engine accepts a series' A5 rule alone (the built-ins under it), or a
 *  full table. */
export type CodeScoring = DnfScoring | ScoringCodeTable;

export function codeTableOf(scoring: CodeScoring | undefined): ScoringCodeTable {
  if (scoring === undefined) return buildCodeTable();
  return typeof scoring === 'string' ? buildCodeTable(scoring) : scoring;
}

/**
 * Look up a built-in scoring code definition, as the RRS defines it (DNF on
 * the A5.2 base). Scoring a series reads its table instead.
 */
export function getCodeDefinition(code: string): ScoringCodeDefinition | undefined {
  return BUILT_IN_MAP.get(code);
}

/** A built-in code as a high-point series scores it before changing it:
 *  its points and whether it counts toward the fleet size. */
export function highPointCodeDefinition(code: string, hp: HighPointScoring): ScoringCodeDefinition | undefined {
  return highPointBuiltIns(hp).find((d) => d.code === code);
}

/**
 * The points method a finish's additive penalty is scored by. An SCP stated
 * in points — rule 44.3(c)'s main form, "made worse by the number of points
 * stated in the notice of race or sailing instructions" — adds those points
 * as a DPI does; the percentage of DNF is only the fallback. Every other
 * penalty, ZFP included (its 20% is fixed by rule 30.2), is scored by its
 * code's own method.
 */
export function penaltyPointsMethod(
  finish: { penaltyCode: string | null; penaltyInPoints?: boolean },
  codes?: ScoringCodeTable,
): PointsMethod | undefined {
  if (!finish.penaltyCode) return undefined;
  if (finish.penaltyCode === 'SCP' && finish.penaltyInPoints) return { type: 'additive_stated' };
  return codeTableOf(codes).definition(finish.penaltyCode)?.pointsMethod;
}

/** Whether a finish's penalty is a stated number of points (a DPI, or an SCP
 *  stated in points) rather than a percentage of the DNF score. */
export function penaltyIsStatedPoints(
  finish: { penaltyCode: string | null; penaltyInPoints?: boolean },
): boolean {
  return penaltyPointsMethod(finish)?.type === 'additive_stated';
}

/** A penalty's stated amount with its unit: `2pts` for a DPI or an SCP stated
 *  in points, `30%` for an SCP percentage of the DNF score. */
export function penaltyAmountText(
  code: string,
  override: number,
  inPoints?: boolean,
): string {
  return penaltyIsStatedPoints({ penaltyCode: code, penaltyInPoints: inPoints })
    ? `${override}pts`
    : `${override}%`;
}

/** The table a series scores with: its A5 rule and its own codes. */
export function seriesCodeTable(series: {
  dnfScoring?: DnfScoring;
  scoringCodes?: readonly SeriesScoringCode[];
} & Partial<Pick<Series, 'pointsSystem' | 'highPointFormula' | 'pointForComingToStart'>>): ScoringCodeTable {
  return buildCodeTable(series.dnfScoring ?? 'seriesEntries', series.scoringCodes ?? [], highPointOf(series));
}

/** A problem with a series' scoring codes, worded for the scorer. `code` is
 *  the code it concerns. */
export interface SeriesCodeProblem {
  code: string;
  message: string;
}

/** Letters and digits, up to six: Sailwave's codes (`DPI1`, `RDGa`) fit. */
export const SERIES_CODE_PATTERN = /^[A-Za-z0-9]{1,6}$/;

const REPLACE_RULES: ReadonlySet<SeriesCodeRule['type']> = new Set(['placeAfter', 'sameAs', 'fixedPoints']);
const ADD_RULES: ReadonlySet<SeriesCodeRule['type']> = new Set(['addPoints', 'addPercent']);

/**
 * Everything wrong with a series' scoring codes, in the words the Scoring
 * codes dialog uses. Empty when the codes can be saved. Checked wherever
 * codes are written — the API, file and export import — so a stored table
 * always builds a well-formed `ScoringCodeTable`.
 */
export function seriesCodeProblems(codes: readonly SeriesScoringCode[]): SeriesCodeProblem[] {
  const problems: SeriesCodeProblem[] = [];
  const say = (code: string, message: string) => problems.push({ code, message });
  const builtInByFolded = new Map(BUILT_IN_CODES.map((d) => [d.code.toUpperCase(), d.code]));
  const seen = new Map<string, string>();
  const replacing = new Set<string>(BUILT_IN_CODES.filter((d) => d.kind === 'replace').map((d) => d.code));

  for (const sc of codes) {
    const { code } = sc;
    if (!code) {
      say(code, 'Code is required.');
      continue;
    }
    if (!SERIES_CODE_PATTERN.test(code)) {
      say(code, 'Enter a code of up to 6 letters or digits, e.g. TLE.');
      continue;
    }
    const folded = code.toUpperCase();
    const prior = seen.get(folded);
    if (prior !== undefined) {
      say(code, `This series already has a code ${prior}. Codes can’t differ only by case.`);
      continue;
    }
    seen.set(folded, code);

    const builtIn = BUILT_IN_MAP.get(code);
    const builtInFolded = builtInByFolded.get(folded);
    if (!builtIn && builtInFolded) {
      say(code, `${code} differs from the RRS code ${builtInFolded} only by case. Choose another code.`);
      continue;
    }
    if (builtIn) {
      if (!CHANGEABLE_BUILT_IN_CODES.includes(code)) {
        say(code, `${code} can’t be changed: its amount is decided for each boat when it is applied.`);
        continue;
      }
      if (sc.kind !== builtIn.kind) {
        say(code, `${code} ${builtIn.kind === 'add' ? 'adds to' : 'replaces'} the boat’s result; that can’t be changed.`);
        continue;
      }
      if (code === 'ZFP' && sc.rule.type !== 'addPercent') {
        say(code, 'ZFP’s penalty is a percentage of DNF.');
        continue;
      }
    } else if (!sc.description?.trim()) {
      say(code, 'Description is required.');
    }

    const rules = sc.kind === 'replace' ? REPLACE_RULES : ADD_RULES;
    if (!rules.has(sc.rule.type)) {
      say(code, `A code that ${sc.kind === 'replace' ? 'replaces the result' : 'adds points'} can’t use that rule.`);
      continue;
    }
    const r = sc.rule;
    if (r.type === 'placeAfter' && !(Number.isInteger(r.plus) && r.plus >= 1)) {
      say(code, 'Enter the places to add as a whole number, 1 or more.');
    } else if (r.type === 'fixedPoints' && !(Number.isFinite(r.points) && r.points >= 0)) {
      say(code, 'Enter the points as a number, e.g. 5.');
    } else if (r.type === 'addPoints' && !(Number.isFinite(r.points) && r.points > 0)) {
      say(code, 'Enter the points to add as a number above 0, e.g. 2.');
    } else if (r.type === 'addPercent' && !(Number.isFinite(r.percent) && r.percent > 0 && r.percent <= 100)) {
      say(code, 'Enter the percentage as a number from 1 to 100, e.g. 20.');
    }
    if (sc.kind === 'replace') replacing.add(code);
  }
  if (problems.length > 0) return problems;

  // "The same as" must name a code that replaces the result, and must not
  // come back round to itself.
  const byCode = new Map<string, SeriesCodeRule>(BUILT_IN_CODES.map((d) => [d.code, d.pointsMethod.type === 'same_as' ? { type: 'sameAs', code: d.pointsMethod.code } : { type: 'fixedPoints', points: 0 }]));
  for (const sc of codes) byCode.set(sc.code, sc.rule);
  for (const sc of codes) {
    if (sc.rule.type !== 'sameAs') continue;
    if (!replacing.has(sc.rule.code)) {
      say(sc.code, `${sc.code} can’t score the same as ${sc.rule.code || 'nothing'}: choose a code that replaces the result.`);
      continue;
    }
    // Follow "the same as" from here. A loop through this code is reported
    // against it; a loop further on is reported against the codes in it.
    const path = [sc.code];
    let next: string | null = sc.rule.code;
    while (next !== null && !path.includes(next)) {
      path.push(next);
      const rule = byCode.get(next);
      next = rule?.type === 'sameAs' ? rule.code : null;
    }
    if (next === sc.code) {
      say(
        sc.code,
        path.length === 1
          ? `${sc.code} can’t score the same as itself.`
          : `${sc.code} can’t score the same as ${path[1]}, which ${path.length === 2 ? 'scores the same as' : 'leads back to'} ${sc.code}.`,
      );
    }
  }
  return problems;
}

/** Whether a series scores DNC the same as DNF — DBSC SI A13.2's change to
 *  A5.3, under which a boat that did not come to the starting area is scored
 *  from the boats that came. */
export function dncScoredAsDnf(codes: readonly SeriesScoringCode[] | undefined): boolean {
  const dnc = codes?.find((c) => c.code === 'DNC');
  return dnc?.rule.type === 'sameAs' && dnc.rule.code === 'DNF';
}

/** Codes a finish can carry when the series' own codes are left out of it:
 *  whether a code is a built-in of the right kind can be told without the
 *  series. */
export function isBuiltInCodeFor(slot: 'result' | 'penalty', code: string): boolean {
  const def = BUILT_IN_MAP.get(code);
  if (!def) return false;
  return slot === 'penalty' ? def.kind === 'add' : def.kind !== 'add';
}

/**
 * Why a finish's codes can't be stored in a series, or null when they can: a
 * result code must be one of the series' codes that replaces the result (or
 * RDG, unless `recorded` — a recorder on the water records no redress), and
 * a penalty code one that adds to the finishing place.
 */
export function finishCodeProblem(
  finish: { resultCode?: string | null; penaltyCode?: string | null },
  codes: ScoringCodeTable,
  opts?: { recorded?: boolean },
): string | null {
  if (finish.resultCode) {
    const def = codes.definition(finish.resultCode);
    if (!def) return `${finish.resultCode} isn’t a code in this series.`;
    if (def.kind === 'add') return `${finish.resultCode} adds to a finishing place: give it as a penalty, not a result.`;
    if (opts?.recorded && def.kind === 'redress') return 'Redress is the protest committee’s, not the finish line’s.';
  }
  if (finish.penaltyCode) {
    const def = codes.definition(finish.penaltyCode);
    if (!def) return `${finish.penaltyCode} isn’t a code in this series.`;
    if (def.kind !== 'add') return `${finish.penaltyCode} replaces a result: it can’t be a penalty.`;
    if (codes.highPoint) return `${finish.penaltyCode} adds to a finishing place, which a high-point series can’t score yet.`;
  }
  return null;
}

/**
 * The result code a typed or imported string names, or null: an RRS code
 * that replaces the result (or RDG), or one of the series' own codes that
 * does. An exact match wins; failing that, the one code that matches
 * ignoring case — codes may be lower case (`RDGa`), but no two in a series
 * differ only by case, so the match is never ambiguous.
 */
export function resolveResultCode(
  raw: string,
  seriesCodes: readonly SeriesScoringCode[] = [],
): string | null {
  const text = raw.trim();
  if (!text) return null;
  const candidates = [
    ...BUILT_IN_CODES.filter((d) => d.kind !== 'add').map((d) => d.code),
    ...seriesCodes.filter((c) => c.kind === 'replace' && !BUILT_IN_MAP.has(c.code)).map((c) => c.code),
  ];
  if (candidates.includes(text)) return text;
  const folded = text.toUpperCase();
  return candidates.find((c) => c.toUpperCase() === folded) ?? null;
}
