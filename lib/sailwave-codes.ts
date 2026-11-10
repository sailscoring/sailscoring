// Sailwave's scoring-code methods and our scoring-code rules, each way.
//
// A `.blw` file stores each code as `code|method|value|discardable|…`, with
// the method as Sailwave's terse stored label (`Boats in series +`,
// `Finishers +`, `Score like`, `Fixed penalty`, `Percentage penalty DNF`), not
// the wording its dialog shows. Only the methods a series code can hold are
// mapped; averages and points set by hand stay with RDG.

import type { SeriesCodeRule, SeriesScoringCode } from './types';

export const SAILWAVE_METHOD_SERIES_PLUS = 'Boats in series +';
export const SAILWAVE_METHOD_RACE_PLUS = 'Boats in race +';
export const SAILWAVE_METHOD_FINISHERS_PLUS = 'Finishers +';
export const SAILWAVE_METHOD_SCORE_LIKE = 'Score like';
export const SAILWAVE_METHOD_FIXED_PENALTY = 'Fixed penalty';
export const SAILWAVE_METHOD_PERCENTAGE_DNF = 'Percentage penalty DNF';

/** A Sailwave method and value as one of our rules, with the kind it implies
 *  — Sailwave's fixed and percentage penalties add to the finishing place;
 *  everything else replaces the result. Null for a method no series code can
 *  hold (an average, points set by hand) or a value that isn't a number. */
export function ruleFromSailwave(
  method: string,
  value: string,
): { kind: SeriesScoringCode['kind']; rule: SeriesCodeRule } | null {
  const m = method.trim();
  const v = value.trim();
  const n = Number(v);
  const whole = v !== '' && Number.isInteger(n) && n >= 1;
  const positive = v !== '' && Number.isFinite(n) && n > 0;
  switch (m) {
    case SAILWAVE_METHOD_SERIES_PLUS:
      return whole ? { kind: 'replace', rule: { type: 'placeAfter', base: 'entries', plus: n } } : null;
    case SAILWAVE_METHOD_RACE_PLUS:
      return whole ? { kind: 'replace', rule: { type: 'placeAfter', base: 'startingArea', plus: n } } : null;
    case SAILWAVE_METHOD_FINISHERS_PLUS:
      return whole ? { kind: 'replace', rule: { type: 'placeAfter', base: 'finishers', plus: n } } : null;
    case SAILWAVE_METHOD_SCORE_LIKE:
      return v ? { kind: 'replace', rule: { type: 'sameAs', code: v } } : null;
    case SAILWAVE_METHOD_FIXED_PENALTY:
      return positive ? { kind: 'add', rule: { type: 'addPoints', points: n } } : null;
    default:
      if (m.startsWith('Percentage penalty')) {
        return positive && n <= 100 ? { kind: 'add', rule: { type: 'addPercent', percent: n } } : null;
      }
      return null;
  }
}

/** One of our rules as Sailwave's method and value, or null where Sailwave
 *  has no method for it: a fixed number of points in place of the result,
 *  or a share of the boat's own points. */
export function ruleToSailwave(rule: SeriesCodeRule): [method: string, value: string] | null {
  switch (rule.type) {
    case 'placeAfter': {
      const method = rule.base === 'entries'
        ? SAILWAVE_METHOD_SERIES_PLUS
        : rule.base === 'startingArea' ? SAILWAVE_METHOD_RACE_PLUS : SAILWAVE_METHOD_FINISHERS_PLUS;
      return [method, String(rule.plus)];
    }
    case 'sameAs': return [SAILWAVE_METHOD_SCORE_LIKE, rule.code];
    case 'addPoints': return [SAILWAVE_METHOD_FIXED_PENALTY, String(rule.points)];
    case 'addPercent': return [SAILWAVE_METHOD_PERCENTAGE_DNF, String(rule.percent)];
    case 'fixedPoints': return null;
    case 'reducePercent': return null;
  }
}
