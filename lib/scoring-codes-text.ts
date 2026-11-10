// How a series' scoring codes read: the rows of the Scoring codes dialog,
// a short rule for its table, and the sentence that restates a rule in full —
// the sentence a scorer checks against the sailing instructions, and the one
// published pages print under the results. Pure, so the dialog, the renderer
// and the tests share one wording.

import { BUILT_IN_CODES, buildCodeTable, CHANGEABLE_BUILT_IN_CODES, getCodeDefinition, highPointCodeDefinition } from './scoring-codes';
import { highPointPlacePoints, type HighPointScoring } from './high-point';
import { weightedRacePoints } from './race-scoring-options';
import type { DnfScoring, PlaceBase, SeriesCodeRule, SeriesScoringCode } from './types';

// A high-point series (`hp`) states its codes against the high-point
// defaults rather than the RRS's: "the place after the last boat" in place
// of a count + 1, and whether each code counts toward the fleet size. Every
// function here takes it as an optional last argument; absent is low point.

/** Where a row of the table stands against the RRS. */
export type CodeStatus = 'rrs' | 'changed' | 'series';

export interface CodeRow {
  code: string;
  /** The RRS name, or the series' description of its own code. */
  name: string;
  /** The code as the series scores it, in the stored shape. */
  scored: SeriesScoringCode;
  status: CodeStatus;
  /** For a built-in: the code as the RRS scores it under the series' A5 rule. */
  rrs?: SeriesScoringCode;
}

/** A built-in code as the RRS scores it, written as a series code: DNF on
 *  the series' A5 base, DNS to BFD as DNF, DNC on the boats entered, ZFP at
 *  rule 30.2's 20%. In high point, as the formula's defaults score it, with
 *  whether it counts toward the fleet size. */
export function rrsCode(code: string, dnfScoring: DnfScoring, hp?: HighPointScoring): SeriesScoringCode {
  const def = hp ? highPointCodeDefinition(code, hp) : getCodeDefinition(code);
  if (!def) throw new Error(`not a built-in code: ${code}`);
  const m = def.pointsMethod;
  let rule: SeriesCodeRule;
  if (m.type === 'fixed_points') {
    rule = { type: 'fixedPoints', points: m.points };
  } else if (def.followsA5) {
    rule = { type: 'placeAfter', base: dnfScoring === 'seriesEntries' ? 'entries' : 'startingArea', plus: 1 };
  } else if (m.type === 'place_after') {
    rule = { type: 'placeAfter', base: m.base, plus: m.plus };
  } else if (m.type === 'same_as') {
    rule = { type: 'sameAs', code: m.code };
  } else if (m.type === 'additive_percentage') {
    rule = { type: 'addPercent', percent: m.defaultPct };
  } else {
    throw new Error(`${code} is decided for each boat`);
  }
  return {
    code,
    kind: def.kind === 'add' ? 'add' : 'replace',
    rule,
    discardable: def.discardable,
    ...(hp && def.kind !== 'add' ? { countsInFleetSize: def.countsInFleetSize ?? true } : {}),
  };
}

/** Whether two codes score alike: same rule, cap and discardability, and in
 *  high point the same answer on the fleet size — `b` being the default a
 *  change is measured against, whose answer an unstated one takes. */
export function sameScoring(a: SeriesScoringCode, b: SeriesScoringCode): boolean {
  return JSON.stringify(a.rule) === JSON.stringify(b.rule)
    && !!a.capAtDnf === !!b.capAtDnf
    && a.discardable === b.discardable
    && (a.countsInFleetSize ?? b.countsInFleetSize) === b.countsInFleetSize;
}

/** The order the RRS codes are listed in: DNF first, since the others score
 *  as it does; then the codes scored as DNF; DNC last. */
const REPLACE_ORDER = ['DNF', 'DNS', 'OCS', 'NSC', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'DNC'];

/**
 * The rows of the Scoring codes dialog: the changeable built-ins as the series
 * scores them, each marked RRS or changed, then the series' own codes, codes
 * that replace the result before codes that add to it.
 */
export function codeRows(
  dnfScoring: DnfScoring,
  scoringCodes: readonly SeriesScoringCode[] = [],
  hp?: HighPointScoring,
): { replace: CodeRow[]; add: CodeRow[] } {
  const byCode = new Map(scoringCodes.map((c) => [c.code, c]));
  const builtIn = (code: string): CodeRow => {
    const rrs = rrsCode(code, dnfScoring, hp);
    const own = byCode.get(code);
    return {
      code,
      name: getCodeDefinition(code)!.name,
      scored: own ?? rrs,
      status: own && !sameScoring(own, rrs) ? 'changed' : 'rrs',
      rrs,
    };
  };
  const own = (sc: SeriesScoringCode): CodeRow => ({ code: sc.code, name: sc.description ?? sc.code, scored: sc, status: 'series' });
  const isBuiltIn = (code: string) => CHANGEABLE_BUILT_IN_CODES.includes(code);
  return {
    replace: [
      ...REPLACE_ORDER.map(builtIn),
      ...scoringCodes.filter((c) => !isBuiltIn(c.code) && c.kind === 'replace').map(own),
    ],
    add: [
      builtIn('ZFP'),
      ...scoringCodes.filter((c) => !isBuiltIn(c.code) && c.kind === 'add').map(own),
    ],
  };
}

/** The series' codes that differ from the RRS: its changes to built-ins that
 *  score differently, and its own codes. What a published page lists. */
export function codesDifferingFromRrs(
  dnfScoring: DnfScoring,
  scoringCodes: readonly SeriesScoringCode[] = [],
  hp?: HighPointScoring,
): CodeRow[] {
  const { replace, add } = codeRows(dnfScoring, scoringCodes, hp);
  return [...replace, ...add].filter((r) => r.status !== 'rrs');
}

const BASE_SHORT: Record<PlaceBase, string> = {
  entries: 'series entries',
  startingArea: 'came to the start',
  finishers: 'finishers',
};

const BASE_PROSE: Record<PlaceBase, string> = {
  entries: 'the number of boats entered in the series',
  startingArea: 'the number of boats that came to the starting area',
  finishers: 'the number of boats that finished in her fleet',
};

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const inWords = (n: number) => (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
const points = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

/** A rule as the dialog's table states it: `came to the start + 1`,
 *  `as DNF`, `finishers + 1, at most DNF`, `20% of DNF`, `2 points`. */
export function ruleShortText(sc: SeriesScoringCode, hp?: HighPointScoring): string {
  const r = sc.rule;
  let text: string;
  switch (r.type) {
    case 'placeAfter':
      text = hp ? afterTheLast(r.plus) : `${BASE_SHORT[r.base]} + ${r.plus}`;
      break;
    case 'sameAs': text = `as ${r.code}`; break;
    case 'fixedPoints': text = points(r.points); break;
    case 'addPoints': text = hp ? `${points(r.points)} off` : points(r.points); break;
    case 'addPercent': text = hp ? `${r.percent}% of ${afterTheLast(1)}` : `${r.percent}% of DNF`; break;
  }
  if (sc.kind === 'replace' && sc.capAtDnf && r.type !== 'sameAs' && !hp) text += ', at most DNF';
  if (hp && sc.kind === 'replace' && sc.countsInFleetSize === false) text += ' · not in the fleet size';
  if (!sc.discardable) text += ' · not discardable';
  return text;
}

/** "the place after the last", "the place two after the last". */
function afterTheLast(plus: number): string {
  return plus === 1 ? 'the place after the last' : `the place ${inWords(plus)} after the last`;
}

/**
 * A rule restated in full, for checking against the sailing instructions and
 * for printing under published results: "A boat scored TLE gets points for
 * the finishing place one more than the number of boats that finished in her
 * fleet, but never more than a DNF. It can be discarded."
 */
export function ruleSentence(sc: SeriesScoringCode, hp?: HighPointScoring): string {
  const r = sc.rule;
  const who = `A boat scored ${sc.code}`;
  let first: string;
  switch (r.type) {
    case 'placeAfter':
      first = hp
        ? `${who} scores the points for ${afterTheLast(r.plus)} boat in her fleet’s race`
        : `${who} gets points for the finishing place ${inWords(r.plus)} more than ${BASE_PROSE[r.base]}`;
      break;
    case 'sameAs':
      first = `${who} scores the same as ${r.code}`;
      break;
    case 'fixedPoints':
      first = `${who} scores ${points(r.points)}`;
      break;
    case 'addPoints':
      first = hp
        ? `${who} has ${points(r.points)} taken from her score for the race`
        : `${who} has ${points(r.points)} added to her score for the race`;
      break;
    case 'addPercent':
      // High point takes the percentage in places: in low point the DNF
      // score it is a share of is a place, the one after the last.
      first = hp
        ? `${who} is scored as if she had finished lower by ${r.percent}% of the place after the last boat in her fleet’s race, to the nearest tenth of a place`
        : `${who} has ${r.percent}% of the DNF score added to her score for the race, to the nearest tenth of a point`;
      break;
  }
  const cap = sc.kind === 'add'
    ? ', but is never scored worse than DNF'
    : sc.capAtDnf && r.type !== 'sameAs' && !hp ? ', but never more than a DNF' : '';
  const others = sc.kind === 'add' ? ' Other boats’ scores are unchanged.' : '';
  const fleet = !hp || sc.kind === 'add' ? ''
    : sc.countsInFleetSize === false
      ? ' She is not counted in the fleet size, so no boat beats her.'
      : ' She counts in the fleet size: every boat placed ahead of her beats her.';
  const discard = sc.discardable ? ' It can be discarded.' : ' It can’t be discarded.';
  return `${first}${cap}.${others}${fleet}${discard}`;
}

/** The RRS codes the dialog doesn't list, and why: their amounts are decided
 *  when they are applied. */
export const DECIDED_PER_BOAT = BUILT_IN_CODES
  .map((d) => d.code)
  .filter((c) => !CHANGEABLE_BUILT_IN_CODES.includes(c));

/** What a series has done to the RRS codes, for the Scoring card's summary:
 *  the codes it added, and the built-ins it scores differently. */
export function codesSummary(
  dnfScoring: DnfScoring,
  scoringCodes: readonly SeriesScoringCode[] = [],
  hp?: HighPointScoring,
): { added: string[]; changed: string[] } {
  const rows = codesDifferingFromRrs(dnfScoring, scoringCodes, hp);
  return {
    added: rows.filter((r) => r.status === 'series').map((r) => r.code),
    changed: rows.filter((r) => r.status === 'changed').map((r) => r.code),
  };
}

/** "TLE added, BFD changed" — empty when the series scores the RRS codes. */
export function codesSummaryText(summary: { added: string[]; changed: string[] }): string {
  const join = (codes: string[]) => codes.join(', ');
  return [
    summary.added.length ? `${join(summary.added)} added` : '',
    summary.changed.length ? `${join(summary.changed)} changed` : '',
  ].filter(Boolean).join(', ');
}

/** A scoring code that differs from the RRS, as a published page states it. */
export interface ScoringCodeNote {
  code: string;
  /** "Time limit expired (SI 16.1)" — the series' description of its own
   *  code, or the RRS name of a changed one. */
  name: string;
  /** The rule in full (`ruleSentence`). */
  sentence: string;
  /** For a changed built-in: how the RRS scores it. */
  rrs?: string;
}

/** The notes a published page carries for a series' codes: one for each code
 *  that differs from the RRS. Empty for a series scoring the RRS codes. */
export function scoringCodeNotes(
  dnfScoring: DnfScoring,
  scoringCodes: readonly SeriesScoringCode[] = [],
  hp?: HighPointScoring,
): ScoringCodeNote[] {
  return codesDifferingFromRrs(dnfScoring, scoringCodes, hp).map((row) => ({
    code: row.code,
    name: row.name,
    sentence: ruleSentence(row.scored, hp),
    ...(row.status === 'changed' && row.rrs ? { rrs: ruleShortText(row.rrs, hp) } : {}),
  }));
}

/** The fleet sizes the high-point preview shows. */
export const PREVIEW_FLEET_SIZES = [2, 5, 10, 20] as const;

/** What a high-point race scores at a few fleet sizes, every boat in it
 *  counted: the winner, the last boat when all finish, and a DNF as the
 *  series scores it. The Scoring card's check against the instructions. */
export function highPointPreview(
  dnfScoring: DnfScoring,
  scoringCodes: readonly SeriesScoringCode[],
  hp: HighPointScoring,
): { sizes: readonly number[]; first: number[]; last: number[]; dnf: number[] } {
  const table = buildCodeTable(dnfScoring, scoringCodes, hp);
  const at = (n: number) => ({ entries: n, startingArea: n, finishers: n, fleetSize: n });
  const tenth = (x: number) => weightedRacePoints(x, 1);
  return {
    sizes: PREVIEW_FLEET_SIZES,
    first: PREVIEW_FLEET_SIZES.map((n) => tenth(highPointPlacePoints(hp, 1, n))),
    last: PREVIEW_FLEET_SIZES.map((n) => tenth(highPointPlacePoints(hp, n, n))),
    dnf: PREVIEW_FLEET_SIZES.map((n) => tenth(table.replacePoints('DNF', at(n)) ?? 0)),
  };
}

/** What a code scores in a 10-boat race at weight 1, for the Scoring codes
 *  dialog's high-point table: "20.3". Null for a code that doesn't replace
 *  the result, or a draft that doesn't make a table. */
export function highPointCodePreview(
  code: SeriesScoringCode,
  dnfScoring: DnfScoring,
  scoringCodes: readonly SeriesScoringCode[],
  hp: HighPointScoring,
): number | null {
  if (code.kind !== 'replace') return null;
  const others = scoringCodes.filter((c) => c.code !== code.code);
  try {
    const points = buildCodeTable(dnfScoring, [...others, code], hp)
      .replacePoints(code.code, { entries: 10, startingArea: 10, finishers: 10, fleetSize: 10 });
    return points === undefined ? null : weightedRacePoints(points, 1);
  } catch {
    return null;
  }
}
