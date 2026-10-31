// How a series' scoring codes read: the rows of the Scoring codes dialog,
// a short rule for its table, and the sentence that restates a rule in full —
// the sentence a scorer checks against the sailing instructions, and the one
// published pages print under the results. Pure, so the dialog, the renderer
// and the tests share one wording.

import { BUILT_IN_CODES, CHANGEABLE_BUILT_IN_CODES, getCodeDefinition } from './scoring-codes';
import type { DnfScoring, PlaceBase, SeriesCodeRule, SeriesScoringCode } from './types';

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
 *  rule 30.2's 20%. */
export function rrsCode(code: string, dnfScoring: DnfScoring): SeriesScoringCode {
  const def = getCodeDefinition(code);
  if (!def) throw new Error(`not a built-in code: ${code}`);
  const m = def.pointsMethod;
  let rule: SeriesCodeRule;
  if (def.followsA5) {
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
  return { code, kind: def.kind === 'add' ? 'add' : 'replace', rule, discardable: def.discardable };
}

/** Whether two codes score alike: same rule, cap and discardability. */
export function sameScoring(a: SeriesScoringCode, b: SeriesScoringCode): boolean {
  return JSON.stringify(a.rule) === JSON.stringify(b.rule)
    && !!a.capAtDnf === !!b.capAtDnf
    && a.discardable === b.discardable;
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
): { replace: CodeRow[]; add: CodeRow[] } {
  const byCode = new Map(scoringCodes.map((c) => [c.code, c]));
  const builtIn = (code: string): CodeRow => {
    const rrs = rrsCode(code, dnfScoring);
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
): CodeRow[] {
  const { replace, add } = codeRows(dnfScoring, scoringCodes);
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
export function ruleShortText(sc: SeriesScoringCode): string {
  const r = sc.rule;
  let text: string;
  switch (r.type) {
    case 'placeAfter': text = `${BASE_SHORT[r.base]} + ${r.plus}`; break;
    case 'sameAs': text = `as ${r.code}`; break;
    case 'fixedPoints': text = points(r.points); break;
    case 'addPoints': text = points(r.points); break;
    case 'addPercent': text = `${r.percent}% of DNF`; break;
  }
  if (sc.kind === 'replace' && sc.capAtDnf && r.type !== 'sameAs') text += ', at most DNF';
  if (!sc.discardable) text += ' · not discardable';
  return text;
}

/**
 * A rule restated in full, for checking against the sailing instructions and
 * for printing under published results: "A boat scored TLE gets points for
 * the finishing place one more than the number of boats that finished in her
 * fleet, but never more than a DNF. It can be discarded."
 */
export function ruleSentence(sc: SeriesScoringCode): string {
  const r = sc.rule;
  const who = `A boat scored ${sc.code}`;
  let first: string;
  switch (r.type) {
    case 'placeAfter':
      first = `${who} gets points for the finishing place ${inWords(r.plus)} more than ${BASE_PROSE[r.base]}`;
      break;
    case 'sameAs':
      first = `${who} scores the same as ${r.code}`;
      break;
    case 'fixedPoints':
      first = `${who} scores ${points(r.points)}`;
      break;
    case 'addPoints':
      first = `${who} has ${points(r.points)} added to her score for the race`;
      break;
    case 'addPercent':
      first = `${who} has ${r.percent}% of the DNF score added to her score for the race, to the nearest tenth of a point`;
      break;
  }
  const cap = sc.kind === 'add'
    ? ', but is never scored worse than DNF'
    : sc.capAtDnf && r.type !== 'sameAs' ? ', but never more than a DNF' : '';
  const others = sc.kind === 'add' ? ' Other boats’ scores are unchanged.' : '';
  const discard = sc.discardable ? ' It can be discarded.' : ' It can’t be discarded.';
  return `${first}${cap}.${others}${discard}`;
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
): { added: string[]; changed: string[] } {
  const rows = codesDifferingFromRrs(dnfScoring, scoringCodes);
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
): ScoringCodeNote[] {
  return codesDifferingFromRrs(dnfScoring, scoringCodes).map((row) => ({
    code: row.code,
    name: row.name,
    sentence: ruleSentence(row.scored),
    ...(row.status === 'changed' && row.rrs ? { rrs: ruleShortText(row.rrs) } : {}),
  }));
}
